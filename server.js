require("dotenv").config();
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";
if (isProduction && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error("In production, SESSION_SECRET must be at least 32 characters.");
}
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
  throw new Error("Set ADMIN_USERNAME and ADMIN_PASSWORD in .env before starting.");
}
if (process.env.ADMIN_PASSWORD.length < 12) {
  throw new Error("ADMIN_PASSWORD must be at least 12 characters.");
}
if (isProduction) app.set("trust proxy", 1);

const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "techzone.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL,
 price INTEGER NOT NULL CHECK(price >= 0), emoji TEXT NOT NULL DEFAULT '📦',
 description TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT, customer_name TEXT NOT NULL, phone TEXT NOT NULL,
 wilaya TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
 items_json TEXT NOT NULL, total INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'جديد',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
if (db.prepare("SELECT COUNT(*) n FROM products").get().n === 0) {
  const insert = db.prepare("INSERT INTO products (name,category,price,emoji,description) VALUES (?,?,?,?,?)");
  const seeds = [
    ["XFX Radeon RX 6600 8GB","بطاقات الرسوميات",45000,"🎮","بطاقة رسومية للألعاب بدقة 1080p"],
    ["Intel Core i5-12400F","المعالجات",28500,"🧠","معالج للألعاب والعمل"],
    ["MSI B550M PRO-VDH WIFI","أجهزة الكمبيوتر",32000,"🖥️","لوحة أم مع Wi-Fi"],
    ["XPG DDR4 8GB 3200MHz","الرامات والتخزين",9500,"💾","ذاكرة RAM للأجهزة المكتبية"],
    ["Samsung 980 500GB NVMe","الرامات والتخزين",12500,"💽","قرص SSD سريع M.2 NVMe"],
    ["سماعة ألعاب Gaming","ملحقات الحاسوب",6500,"🎧","سماعة مع ميكروفون"],
    ["هاتف ذكي 128GB","الهواتف الذكية",38000,"📱","هاتف للاستخدام اليومي"],
    ["حاسوب محمول للدراسة","أجهزة الكمبيوتر",89000,"💻","مناسب للدراسة والعمل"]
  ];
  const tx = db.transaction(rows => rows.forEach(p => insert.run(...p)));
  tx(seeds);
}
const adminHash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(session({
  name: "tz.sid",
  secret: process.env.SESSION_SECRET || "development-only-secret-change-this",
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: isProduction, maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(express.static(path.join(__dirname, "public")));
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

const requireAdmin = (req, res, next) => {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: "يلزم تسجيل الدخول إلى لوحة الإدارة." });
};
const clean = (v, max = 250) => String(v ?? "").trim().slice(0, max);
const validProduct = body => {
  const name = clean(body.name, 120), category = clean(body.category, 80);
  const price = Number(body.price), emoji = clean(body.emoji || "📦", 8), description = clean(body.description, 500);
  if (!name || !category || !Number.isSafeInteger(price) || price < 0) return { error: "أدخل اسم المنتج والفئة وسعراً صحيحاً." };
  return { value: { name, category, price, emoji, description } };
};

app.get("/api/products", (req, res) => {
  res.json(db.prepare("SELECT id,name,category,price,emoji,description FROM products WHERE active=1 ORDER BY id DESC").all());
});
app.post("/api/orders", (req, res) => {
  const customer_name = clean(req.body.name, 100), phone = clean(req.body.phone, 30);
  const wilaya = clean(req.body.wilaya, 80), address = clean(req.body.address, 300), notes = clean(req.body.notes, 500);
  const inputItems = Array.isArray(req.body.items) ? req.body.items : [];
  if (!customer_name || !phone || !wilaya || !/^[0-9+ ()-]{8,18}$/.test(phone) || inputItems.length < 1 || inputItems.length > 50) {
    return res.status(400).json({ error: "تحقق من الاسم والهاتف والولاية والمنتجات." });
  }
  const items = [];
  for (const item of inputItems) {
    const id = Number(item.id), qty = Number(item.qty);
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 99) return res.status(400).json({ error: "كمية منتج غير صالحة." });
    const p = db.prepare("SELECT id,name,price FROM products WHERE id=? AND active=1").get(id);
    if (!p) return res.status(400).json({ error: "أحد المنتجات لم يعد متاحاً." });
    items.push({ id: p.id, name: p.name, price: p.price, qty });
  }
  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const result = db.prepare(`INSERT INTO orders (customer_name,phone,wilaya,address,notes,items_json,total)
    VALUES (?,?,?,?,?,?,?)`).run(customer_name, phone, wilaya, address, notes, JSON.stringify(items), total);
  res.status(201).json({ ok: true, id: result.lastInsertRowid, message: "تم تسجيل طلبك بنجاح." });
});

app.post("/api/admin/login", loginLimiter, (req, res) => {
  const username = clean(req.body.username, 100), password = String(req.body.password || "");
  if (username !== process.env.ADMIN_USERNAME || !bcrypt.compareSync(password, adminHash)) {
    return res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة." });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "تعذر بدء الجلسة." });
    req.session.isAdmin = true;
    res.json({ ok: true });
  });
});
app.post("/api/admin/logout", requireAdmin, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/admin/me", (req, res) => res.json({ authenticated: !!(req.session && req.session.isAdmin) }));
app.get("/api/admin/stats", requireAdmin, (req, res) => {
  res.json({
    products: db.prepare("SELECT COUNT(*) n FROM products WHERE active=1").get().n,
    orders: db.prepare("SELECT COUNT(*) n FROM orders").get().n,
    newOrders: db.prepare("SELECT COUNT(*) n FROM orders WHERE status='جديد'").get().n,
    revenue: db.prepare("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status NOT IN ('ملغى')").get().n
  });
});
app.get("/api/admin/products", requireAdmin, (req, res) => res.json(db.prepare("SELECT * FROM products ORDER BY id DESC").all()));
app.post("/api/admin/products", requireAdmin, (req, res) => {
  const result = validProduct(req.body); if (result.error) return res.status(400).json({ error: result.error });
  const p = result.value;
  const info = db.prepare("INSERT INTO products (name,category,price,emoji,description) VALUES (?,?,?,?,?)").run(p.name,p.category,p.price,p.emoji,p.description);
  res.status(201).json({ id: info.lastInsertRowid });
});
app.put("/api/admin/products/:id", requireAdmin, (req, res) => {
  const result = validProduct(req.body); if (result.error) return res.status(400).json({ error: result.error });
  const p = result.value;
  const info = db.prepare("UPDATE products SET name=?,category=?,price=?,emoji=?,description=? WHERE id=?").run(p.name,p.category,p.price,p.emoji,p.description,Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: "المنتج غير موجود." });
  res.json({ ok: true });
});
app.delete("/api/admin/products/:id", requireAdmin, (req, res) => {
  const info = db.prepare("UPDATE products SET active=0 WHERE id=?").run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: "المنتج غير موجود." });
  res.json({ ok: true });
});
app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const orders = db.prepare("SELECT * FROM orders ORDER BY id DESC").all().map(o => ({ ...o, items: JSON.parse(o.items_json) }));
  res.json(orders);
});
app.patch("/api/admin/orders/:id", requireAdmin, (req, res) => {
  const allowed = ["جديد","قيد المعالجة","تم الشحن","مكتمل","ملغى"];
  const status = clean(req.body.status, 30);
  if (!allowed.includes(status)) return res.status(400).json({ error: "حالة الطلب غير صالحة." });
  const info = db.prepare("UPDATE orders SET status=? WHERE id=?").run(status, Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: "الطلب غير موجود." });
  res.json({ ok: true });
});

app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`TechZone running at http://localhost:${PORT}`));
