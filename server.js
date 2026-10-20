const express = require("express");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// نظام قراءة المنتجات تلقائياً من ملف JSON محلي لتفادي مشاكل السيرفر
const productsPath = path.join(__dirname, "data", "products.json");

// منتجات افتراضية ثابتة ومحمية في حال عدم وجود ملف المنتجات
const defaultProducts = [
  { id: 1, name: "Dahua C900 256GB SSD NVMe M.2", price: 15000, description: "هارد تخزين داخلي فائق السرعة يدعم واجهة PCIe Gen3.0 x4 وضمان 3 سنوات.", emoji: "images/dahua.png" },
  { id: 2, name: "Gaming Mouse RGB - Corsair Harpoon", price: 5500, description: "فأرة ألعاب سلكية عالية الدقة بسرعة 12000 DPI مع إضاءة RGB ديناميكية وتصميم مريح.", emoji: "images/mouse.png" }
];

app.get("/api/products", (req, res) => {
  if (fs.existsSync(productsPath)) {
    try {
      const fileData = fs.readFileSync(productsPath, "utf8");
      return res.json(JSON.parse(fileData));
    } catch (e) {
      return res.json(defaultProducts);
    }
  }
  res.json(defaultProducts);
});

app.post("/api/products", (req, res) => {
  const { name, price, description, emoji } = req.body;
  let products = [];
  if (fs.existsSync(productsPath)) {
    try { products = JSON.parse(fs.readFileSync(productsPath, "utf8")); } catch (e) {}
  } else {
    products = [...defaultProducts];
  }
  const newProduct = { id: Date.now(), name, price: parseFloat(price), description, emoji };
  products.push(newProduct);
  fs.writeFileSync(productsPath, JSON.stringify(products, null, 2), "utf8");
  res.json(newProduct);
});

app.listen(PORT, () => {
  console.log(`TechZone Gaming Running smoothly at port ${PORT}`);
});
