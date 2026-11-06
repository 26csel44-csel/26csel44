const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const { MongoClient } = require("mongodb");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { createApp, prepareAuthCollections, hashPassword } = require("../server");

// These tests start a temporary MongoDB and delete it afterward.
// They never read MONGODB_URI and they never use real student records.
const PASSWORD = "Test-pass-123";
const WRONG_PASSWORD = "wrong-pass-123";

let memoryServer;
let client;
let db;
let server;
let port;

function hashToken(token) {
    return createHash("sha256").update(token).digest("hex");
}

function request(pathname, options = {}) {
    const payload = options.body ? JSON.stringify(options.body) : null;

    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: "127.0.0.1",
                port,
                path: pathname,
                method: options.method || "GET",
                headers: {
                    ...(payload
                        ? {
                            "Content-Type": "application/json",
                            "Content-Length": Buffer.byteLength(payload)
                        }
                        : {}),
                    ...(options.cookie ? { Cookie: options.cookie } : {})
                }
            },
            (res) => {
                const chunks = [];
                res.on("data", (chunk) => chunks.push(chunk));
                res.on("end", () => {
                    const text = Buffer.concat(chunks).toString("utf8");
                    let data = text;

                    try {
                        data = text ? JSON.parse(text) : null;
                    } catch (error) {
                        data = text;
                    }

                    const header = res.headers["set-cookie"] || [];
                    resolve({
                        status: res.statusCode,
                        data,
                        text,
                        setCookie: Array.isArray(header) ? header : [header]
                    });
                });
            }
        );

        req.on("error", reject);

        if (payload) {
            req.write(payload);
        }

        req.end();
    });
}

function post(pathname, body, cookie) {
    return request(pathname, {
        method: "POST",
        body,
        cookie
    });
}

function sessionCookie(setCookie) {
    return setCookie.find((value) => value.startsWith("campus_session=")) || "";
}

function cookieHeader(setCookie) {
    const cookie = sessionCookie(setCookie);
    if (!cookie) {
        return "";
    }
    return cookie.split(";")[0];
}

function cookieToken(setCookie) {
    const header = cookieHeader(setCookie);
    if (!header) {
        return "";
    }
    return decodeURIComponent(header.slice("campus_session=".length));
}

test.describe("CampusConnect student accounts", { timeout: 120000, concurrency: false }, () => {
    test.before(async () => {
        memoryServer = await MongoMemoryServer.create();
        client = new MongoClient(memoryServer.getUri());
        await client.connect();
        db = client.db("campusconnect_auth_test");
        await prepareAuthCollections(db);

        const app = createApp(db);
        server = app.listen(0, "127.0.0.1");
        await new Promise((resolve) => server.once("listening", resolve));
        port = server.address().port;
    });

    test.after(async () => {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
        if (db) {
            await db.dropDatabase();
        }
        if (client) {
            await client.close();
        }
        if (memoryServer) {
            await memoryServer.stop();
        }
    });

    test("signup stores a hash, sets an HttpOnly cookie, and starts a session", async () => {
        const created = await post("/api/signup", {
            name: "Test Student",
            email: "Student.Login.Test@example.com",
            password: PASSWORD,
            confirmPassword: PASSWORD
        });

        assert.equal(created.status, 201);
        assert.equal(created.data.message, "Account created.");
        assert.equal(created.data.student.email, "student.login.test@example.com");
        assert.equal(JSON.stringify(created.data).includes(PASSWORD), false);
        assert.equal(JSON.stringify(created.data).includes("passwordHash"), false);

        const cookie = sessionCookie(created.setCookie);
        assert.match(cookie, /HttpOnly/i);
        assert.match(cookie, /SameSite=Lax/i);
        if (process.env.NODE_ENV === "production") {
            assert.match(cookie, /Secure/i);
        }

        const token = cookieToken(created.setCookie);
        const saved = await db.collection("students").findOne({
            email: "student.login.test@example.com"
        });
        const session = await db.collection("sessions").findOne({
            studentId: saved._id
        });

        assert.equal(Object.hasOwn(saved, "password"), false);
        assert.notEqual(saved.passwordHash, PASSWORD);
        assert.equal(saved.passwordHash.length, 64);
        assert.equal(saved.passwordSalt.length, 32);
        assert.equal(Object.hasOwn(session, "token"), false);
        assert.equal(session.tokenHash, hashToken(token));
        assert.notEqual(session.tokenHash, token);

        const me = await request("/api/me", { cookie: cookieHeader(created.setCookie) });
        assert.equal(me.status, 200);
        assert.equal(me.data.student.name, "Test Student");
        assert.equal(me.data.student.email, "student.login.test@example.com");
    });

    test("the same password gets a different salt each time", async () => {
        const first = await hashPassword(PASSWORD);
        const second = await hashPassword(PASSWORD);

        assert.notEqual(first.passwordSalt, second.passwordSalt);
        assert.notEqual(first.passwordHash, second.passwordHash);
    });

    test("signup rejects invalid fields and a duplicate email", async () => {
        const cases = [
            {
                body: {
                    name: "A",
                    email: "short.name@example.com",
                    password: PASSWORD,
                    confirmPassword: PASSWORD
                },
                message: "Enter a name between 2 and 80 characters."
            },
            {
                body: {
                    name: "Test Student",
                    email: "not-an-email",
                    password: PASSWORD,
                    confirmPassword: PASSWORD
                },
                message: "Enter a valid email address."
            },
            {
                body: {
                    name: "Test Student",
                    email: "short.pass@example.com",
                    password: "short",
                    confirmPassword: "short"
                },
                message: "Password must contain 8 to 64 characters."
            },
            {
                body: {
                    name: "Test Student",
                    email: "mismatch.pass@example.com",
                    password: PASSWORD,
                    confirmPassword: WRONG_PASSWORD
                },
                message: "Passwords do not match."
            }
        ];

        for (const item of cases) {
            const response = await post("/api/signup", item.body);
            assert.equal(response.status, 400);
            assert.equal(response.data.message, item.message);
            assert.equal(sessionCookie(response.setCookie), "");
        }

        const duplicate = await post("/api/signup", {
            name: "Second Student",
            email: "student.login.test@example.com",
            password: PASSWORD,
            confirmPassword: PASSWORD
        });

        assert.equal(duplicate.status, 409);
        assert.equal(duplicate.data.message, "An account with this email already exists.");
        assert.equal(await db.collection("students").countDocuments({
            email: "student.login.test@example.com"
        }), 1);
    });

    test("login rejects unknown and wrong passwords, then accepts the right one", async () => {
        const before = await db.collection("sessions").countDocuments();
        const unknown = await post("/api/login", {
            email: "missing.student@example.com",
            password: PASSWORD
        });
        const wrong = await post("/api/login", {
            email: "student.login.test@example.com",
            password: WRONG_PASSWORD
        });

        assert.equal(unknown.status, 401);
        assert.equal(wrong.status, 401);
        assert.equal(unknown.data.message, "Email or password is incorrect.");
        assert.equal(wrong.data.message, unknown.data.message);
        assert.equal(sessionCookie(unknown.setCookie), "");
        assert.equal(sessionCookie(wrong.setCookie), "");
        assert.equal(await db.collection("sessions").countDocuments(), before);

        const loggedIn = await post("/api/login", {
            email: "STUDENT.LOGIN.TEST@example.com",
            password: PASSWORD
        });

        assert.equal(loggedIn.status, 200);
        assert.equal(loggedIn.data.message, "Login successful.");
        assert.equal(loggedIn.data.student.name, "Test Student");
        assert.match(sessionCookie(loggedIn.setCookie), /HttpOnly/i);

        const me = await request("/api/me", {
            cookie: cookieHeader(loggedIn.setCookie)
        });
        assert.equal(me.data.student.email, "student.login.test@example.com");
    });

    test("logout deletes the server session and the old cookie stops working", async () => {
        const loggedIn = await post("/api/login", {
            email: "student.login.test@example.com",
            password: PASSWORD
        });
        const header = cookieHeader(loggedIn.setCookie);
        const loggedOut = await post("/api/logout", null, header);

        assert.equal(loggedOut.status, 200);
        assert.equal(loggedOut.data.message, "Logged out.");
        assert.match(sessionCookie(loggedOut.setCookie), /campus_session=/);

        const token = cookieToken(loggedIn.setCookie);
        assert.equal(await db.collection("sessions").countDocuments({
            tokenHash: hashToken(token)
        }), 0);

        const me = await request("/api/me", { cookie: header });
        assert.equal(me.status, 200);
        assert.equal(me.data.student, null);
    });

    test("an expired session is no longer signed in", async () => {
        const loggedIn = await post("/api/login", {
            email: "student.login.test@example.com",
            password: PASSWORD
        });
        const header = cookieHeader(loggedIn.setCookie);

        await db.collection("sessions").updateOne(
            { tokenHash: hashToken(cookieToken(loggedIn.setCookie)) },
            { $set: { expiresAt: new Date(Date.now() - 60 * 1000) } }
        );

        const me = await request("/api/me", { cookie: header });
        assert.equal(me.data.student, null);
    });

    test("event registration still works and can remember a signed-in student", async () => {
        const anonymous = await post("/api/register", {
            name: "Anon Student",
            email: "event.anon.test@example.com",
            phone: "9999999999",
            event: "Tech Fest 2026"
        });

        assert.equal(anonymous.status, 201);
        assert.equal(anonymous.data.message, "Registration successful!");

        const anonRecord = await db.collection("registrations").findOne({
            email: "event.anon.test@example.com"
        });
        assert.equal(anonRecord.event, "Tech Fest 2026");
        assert.equal(Object.hasOwn(anonRecord, "studentEmail"), false);

        const invalid = await post("/api/register", {
            name: "Anon Student",
            email: "event.anon.test@example.com",
            phone: "123",
            event: "Tech Fest 2026"
        });
        assert.equal(invalid.status, 400);
        assert.equal(invalid.data.message, "Enter a valid 10-digit phone number.");

        const loggedIn = await post("/api/login", {
            email: "student.login.test@example.com",
            password: PASSWORD
        });
        const signedIn = await post("/api/register", {
            name: "Different Name",
            email: "event.auth.test@example.com",
            phone: "9888888888",
            event: "Web Development Workshop"
        }, cookieHeader(loggedIn.setCookie));

        assert.equal(signedIn.status, 201);
        const signedRecord = await db.collection("registrations").findOne({
            email: "event.auth.test@example.com"
        });
        assert.equal(signedRecord.studentEmail, "student.login.test@example.com");
        assert.equal(signedRecord.name, "Different Name");
    });

    test("login and signup pages are server pages and do not store credentials in the browser", async () => {
        const loginPage = await request("/login");
        const signupPage = await request("/signup");
        const authScript = await request("/auth.js");
        const homeScript = await request("/script.js");
        const homePage = await request("/");

        assert.equal(loginPage.status, 200);
        assert.match(loginPage.text, /Student Login/);
        assert.match(loginPage.text, /not a college or Google password/);
        assert.match(loginPage.text, /type="password"/);
        assert.equal(loginPage.text.includes("localStorage"), false);

        assert.equal(signupPage.status, 200);
        assert.match(signupPage.text, /Create Student Account/);
        assert.match(signupPage.text, /id="confirmPassword"/);

        for (const script of [authScript.text, homeScript.text]) {
            assert.equal(script.includes("localStorage"), false);
            assert.equal(script.includes("sessionStorage"), false);
            assert.equal(script.includes("document.cookie"), false);
        }

        assert.match(homePage.text, /href="\/login"/);
        assert.match(homePage.text, /href="\/signup"/);
    });

    test("the static GitHub Pages file points at the server and has no login form", () => {
        const rootPage = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

        assert.equal(
            rootPage.includes("https://campusconnect-te0m.onrender.com/login"),
            true
        );
        assert.equal(
            rootPage.includes("https://campusconnect-te0m.onrender.com/signup"),
            true
        );
        assert.equal(rootPage.includes("type=\"password\""), false);
        assert.equal(rootPage.includes("localStorage"), false);
        assert.match(rootPage, /static files/);
    });
});
