console.log("Node.js is connected to VS Code!");

const { MongoClient } = require("mongodb");

const url = "mongodb://127.0.0.1:27017";
const client = new MongoClient(url);

async function main() {
    try {
        await client.connect();
        console.log("Connected to MongoDB successfully!");

        const db = client.db("26csel44");
        console.log("Database selected:", db.databaseName);
    } catch (error) {
        console.error("Connection failed:", error.message);
    } finally {
        await client.close();
    }
}

main();
