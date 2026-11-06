const express = require("express");
const { MongoClient } = require("mongodb");
const path = require("path");
const { scrypt, randomBytes, timingSafeEqual, createHash } = require("crypto");
const { promisify } = require("util");

const scryptAsync = promisify(scrypt);

const PORT = process.env.PORT || 3000;
const COOKIE_NAME = "campus_session";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_KEY_LENGTH = 32;

const allowedEvents = [
    "Tech Fest 2026",
    "Cultural Fest 2026",
    "Web Development Workshop"
];

// scrypt is a slow password hash. The database stores the hash and salt,
// never the password the student typed.
async function hashPassword(password) {
    const salt = randomBytes(16);
    const hash = await scryptAsync(password, salt, PASSWORD_KEY_LENGTH);

    return {
        passwordSalt: salt.toString("hex"),
        passwordHash: hash.toString("hex")
    };
}

async function verifyPassword(password, saltHex, hashHex) {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = await scryptAsync(password, salt, PASSWORD_KEY_LENGTH);

    if (actual.length !== expected.length) {
        return false;
    }

    return timingSafeEqual(actual, expected);
}

function hashToken(token) {
    return createHash("sha256").update(token).digest("hex");
}

function validName(name) {
    return typeof name === "string" &&
        name.trim().length >= 2 &&
        name.trim().length <= 80;
}

function validEmail(email) {
    return typeof email === "string" &&
        email.trim().length <= 254 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function validPassword(password) {
    return typeof password === "string" &&
        password.length >= 8 &&
        password.length <= 64;
}

function readCookie(req, name) {
    const header = req.headers.cookie;

    if (!header || typeof header !== "string") {
        return "";
    }

    const cookies = header.split(";");

    for (let i = 0; i < cookies.length; i++) {
        const parts = cookies[i].trim().split("=");
        const key = parts.shift();
        const value = parts.join("=");

        if (key === name) {
            try {
                return decodeURIComponent(value);
            } catch (error) {
                return "";
            }
        }
    }

    return "";
}

// HttpOnly keeps the session token out of page scripts.
// SameSite=Lax blocks most cross-site form posts.
// Secure is added in production so the browser sends the cookie only on HTTPS.
function sessionCookieOptions() {
    return {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/"
    };
}

function setSessionCookie(res, token) {
    res.cookie(COOKIE_NAME, token, {
        ...sessionCookieOptions(),
        maxAge: SESSION_MAX_AGE_MS
    });
}

function clearSessionCookie(res) {
    res.clearCookie(COOKIE_NAME, sessionCookieOptions());
}

function studentView(student) {
    return {
        name: student.name,
        email: student.email
    };
}

function sendAuth(res, status, body) {
    res.set("Cache-Control", "no-store");
    return res.status(status).json(body);
}

async function prepareAuthCollections(db) {
    const students = db.collection("students");
    const sessions = db.collection("sessions");

    await students.createIndex({ email: 1 }, { unique: true });
    await sessions.createIndex({ tokenHash: 1 }, { unique: true });
    // MongoDB removes a session after its expiresAt time.
    await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

async function findStudentFromRequest(req, students, sessions) {
    const token = readCookie(req, COOKIE_NAME);

    if (!token || token.length > 200) {
        return null;
    }

    const session = await sessions.findOne({
        tokenHash: hashToken(token),
        expiresAt: { $gt: new Date() }
    });

    if (!session) {
        return null;
    }

    return students.findOne(
        { _id: session.studentId },
        { projection: { passwordHash: 0, passwordSalt: 0 } }
    );
}

async function createSession(req, res, sessions, studentId) {
    const oldToken = readCookie(req, COOKIE_NAME);

    if (oldToken && oldToken.length <= 200) {
        await sessions.deleteOne({ tokenHash: hashToken(oldToken) });
    }

    const token = randomBytes(32).toString("base64url");
    const now = new Date();

    await sessions.insertOne({
        tokenHash: hashToken(token),
        studentId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_MS)
    });

    setSessionCookie(res, token);
}

function createApp(db) {
    const registrations = db.collection("registrations");
    const students = db.collection("students");
    const sessions = db.collection("sessions");
    const serverApp = express();

    serverApp.use(express.json({ limit: "10kb" }));

    serverApp.get("/login", (req, res) => {
        res.sendFile(path.join(__dirname, "public", "login.html"));
    });

    serverApp.get("/signup", (req, res) => {
        res.sendFile(path.join(__dirname, "public", "signup.html"));
    });

    serverApp.post("/api/signup", async (req, res) => {
        try {
            const { name, email, password, confirmPassword } = req.body || {};

            if (!validName(name)) {
                return sendAuth(res, 400, {
                    message: "Enter a name between 2 and 80 characters."
                });
            }

            if (!validEmail(email)) {
                return sendAuth(res, 400, {
                    message: "Enter a valid email address."
                });
            }

            if (!validPassword(password)) {
                return sendAuth(res, 400, {
                    message: "Password must contain 8 to 64 characters."
                });
            }

            if (password !== confirmPassword) {
                return sendAuth(res, 400, {
                    message: "Passwords do not match."
                });
            }

            const hashed = await hashPassword(password);
            const account = {
                name: name.trim(),
                email: email.trim().toLowerCase(),
                passwordHash: hashed.passwordHash,
                passwordSalt: hashed.passwordSalt,
                createdAt: new Date()
            };

            const result = await students.insertOne(account);
            await createSession(req, res, sessions, result.insertedId);

            return sendAuth(res, 201, {
                message: "Account created.",
                student: studentView(account)
            });
        } catch (error) {
            if (error && error.code === 11000) {
                return sendAuth(res, 409, {
                    message: "An account with this email already exists."
                });
            }

            console.error("Signup error:", error);
            return sendAuth(res, 500, {
                message: "Server error. Please try again."
            });
        }
    });

    serverApp.post("/api/login", async (req, res) => {
        try {
            const { email, password } = req.body || {};

            if (!validEmail(email) || typeof password !== "string" || password.length < 1 || password.length > 64) {
                return sendAuth(res, 400, {
                    message: "Enter a valid email and password."
                });
            }

            const student = await students.findOne({
                email: email.trim().toLowerCase()
            });

            // Hash once when the email is unknown so a missing account
            // does not return faster than a wrong password.
            if (!student) {
                await hashPassword(password);
                return sendAuth(res, 401, {
                    message: "Email or password is incorrect."
                });
            }

            const matches = await verifyPassword(
                password,
                student.passwordSalt,
                student.passwordHash
            );

            if (!matches) {
                return sendAuth(res, 401, {
                    message: "Email or password is incorrect."
                });
            }

            await createSession(req, res, sessions, student._id);

            return sendAuth(res, 200, {
                message: "Login successful.",
                student: studentView(student)
            });
        } catch (error) {
            console.error("Login error:", error);
            return sendAuth(res, 500, {
                message: "Server error. Please try again."
            });
        }
    });

    serverApp.post("/api/logout", async (req, res) => {
        try {
            const token = readCookie(req, COOKIE_NAME);

            if (token && token.length <= 200) {
                await sessions.deleteOne({ tokenHash: hashToken(token) });
            }

            clearSessionCookie(res);

            return sendAuth(res, 200, {
                message: "Logged out."
            });
        } catch (error) {
            console.error("Logout error:", error);
            return sendAuth(res, 500, {
                message: "Server error. Please try again."
            });
        }
    });

    serverApp.get("/api/me", async (req, res) => {
        try {
            const student = await findStudentFromRequest(req, students, sessions);

            return sendAuth(res, 200, {
                student: student ? studentView(student) : null
            });
        } catch (error) {
            console.error("Session error:", error);
            return sendAuth(res, 500, {
                message: "Server error. Please try again."
            });
        }
    });

    serverApp.post("/api/register", async (req, res) => {
        try {
            const { name, email, phone, event } = req.body || {};

            if (!validName(name)) {
                return res.status(400).json({
                    message: "Enter a name between 2 and 80 characters."
                });
            }

            if (!validEmail(email)) {
                return res.status(400).json({
                    message: "Enter a valid email address."
                });
            }

            if (
                typeof phone !== "string" ||
                !/^[0-9]{10}$/.test(phone)
            ) {
                return res.status(400).json({
                    message: "Enter a valid 10-digit phone number."
                });
            }

            if (
                typeof event !== "string" ||
                !allowedEvents.includes(event)
            ) {
                return res.status(400).json({
                    message: "Select a valid event."
                });
            }

            const registration = {
                name: name.trim(),
                email: email.trim().toLowerCase(),
                phone,
                event,
                registeredAt: new Date()
            };

            const student = await findStudentFromRequest(req, students, sessions);

            if (student) {
                registration.studentEmail = student.email;
            }

            const result = await registrations.insertOne(registration);

            return res.status(201).json({
                message: "Registration successful!",
                registrationId: result.insertedId
            });
        } catch (error) {
            console.error("Registration error:", error);

            return res.status(500).json({
                message: "Server error. Please try again."
            });
        }
    });

    serverApp.use(express.static(path.join(__dirname, "public")));

    return serverApp;
}

async function startServer() {
    // On the hosting site, the database username and password are kept in
    // separate secret settings (MONGODB_USER and MONGODB_PASSWORD), so they
    // never appear in the code or in the connection link.
    const mongoUrl = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
    const clientOptions = {};

    if (process.env.MONGODB_USER && process.env.MONGODB_PASSWORD) {
        clientOptions.auth = {
            username: process.env.MONGODB_USER,
            password: process.env.MONGODB_PASSWORD
        };
    }

    const client = new MongoClient(mongoUrl, clientOptions);

    try {
        await client.connect();

        const db = client.db("CollegeEventDB");
        await prepareAuthCollections(db);
        const serverApp = createApp(db);

        serverApp.listen(PORT, () => {
            console.log(`Server running at http://localhost:${PORT}`);
            console.log("MongoDB connected successfully.");
        });
    } catch (error) {
        console.error("Unable to start the application:", error.message);
        await client.close().catch(() => {});
        process.exitCode = 1;
    }
}

if (require.main === module) {
    startServer();
}

module.exports = {
    createApp,
    prepareAuthCollections,
    hashPassword
};
