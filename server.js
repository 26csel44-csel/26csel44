
const express = require("express");
const { MongoClient } = require("mongodb");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const MONGO_URL = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const client = new MongoClient(MONGO_URL);

const allowedEvents = [
    "Tech Fest 2026",
    "Cultural Fest 2026",
    "Web Development Workshop"
];

app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

let registrations;

app.post("/api/register", async (req, res) => {
    try {
        const { name, email, phone, event } = req.body || {};

        if (
            typeof name !== "string" ||
            name.trim().length < 2 ||
            name.trim().length > 80
        ) {
            return res.status(400).json({
                message: "Enter a name between 2 and 80 characters."
            });
        }

        if (
            typeof email !== "string" ||
            email.trim().length > 254 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
        ) {
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

async function startServer() {
    try {
        await client.connect();

        const db = client.db("CollegeEventDB");
        registrations = db.collection("registrations");

        app.listen(PORT, () => {
            console.log(`Server running at http://localhost:${PORT}`);
            console.log("MongoDB connected successfully.");
        });
    } catch (error) {
        console.error("Unable to start the application:", error.message);
        await client.close().catch(() => {});
        process.exitCode = 1;
    }
}

startServer();
