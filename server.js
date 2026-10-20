const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const dotenv = require("dotenv");
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const db = new sqlite3.Database(path.join(__dirname, "data", "techzone.sqlite"), (err) => {
    if (err) console.error("قاعدة البيانات لم تفتح:", err.message);
    else console.log("متصل بقاعدة SQLite بنجاح");
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price REAL NOT NULL, description TEXT, emoji TEXT)`);
});

app.get("/api/products", (req, res) => {
    db.all("SELECT * FROM products", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post("/api/products", (req, res) => {
    const { name, price, description, emoji } = req.body;
    db.run(`INSERT INTO products (name, price, description, emoji) VALUES (?, ?, ?, ?)`, [name, price, description, emoji], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
    });
});

app.listen(PORT, () => {
    console.log(`TechZone running at http://localhost:${PORT}`);
});
