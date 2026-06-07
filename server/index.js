const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const ADMIN_SECRET = process.env.ADMIN_SECRET || "change-this-secret";
const MONGODB_URI = process.env.MONGODB_URI;

let db;
async function connectDB() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db("luckyloop");
  console.log("✅ MongoDB connected");
}

function getUsers() { return db.collection("users"); }
function getSettings() { return db.collection("settings"); }

function checkAdmin(req, res) {
  if (req.headers["x-admin-secret"] !== ADMIN_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

// ==================== MS HELPERS ====================
async function getMsValues() {
  const doc = await getSettings().findOne({ _id: "ms_values" });
  return { ms1: doc?.ms1 || 990, ms2: doc?.ms2 || 1150 };
}

// ==================== PUBLIC ENDPOINTS ====================

// PUBLIC: Check license
app.get("/check", async (req, res) => {
  const licenseKey = (req.headers["x-license-key"] || req.query.key || "").toUpperCase();
  if (!licenseKey) return res.json({ valid: false, reason: "No license key" });
  const user = await getUsers().findOne({ key: licenseKey });
  if (!user) return res.json({ valid: false, reason: "License key not found" });
  if (!user.active) return res.json({ valid: false, reason: "Your license has been disabled" });
  if (!user.expiry) return res.json({ valid: false, reason: "No expiry set" });
  const now = new Date();
  const expiry = new Date(user.expiry);
  if (now > expiry) return res.json({ valid: false, reason: "Your license has expired" });
  const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

  // ms values ও include করো — userscript এখান থেকে পাবে
  const ms = await getMsValues();

  return res.json({
    valid: true,
    expiry: user.expiry,
    daysLeft,
    reason: "Active",
    userName: user.name || licenseKey,
    ms1: ms.ms1,
    ms2: ms.ms2
  });
});

// PUBLIC: Get MS values (userscript এ /get-ms call করে)
app.get("/get-ms", async (req, res) => {
  const ms = await getMsValues();
  res.json({ ms1: ms.ms1, ms2: ms.ms2 });
});

// ==================== ADMIN ENDPOINTS ====================

// ADMIN: Status
app.get("/admin/status", async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const users = await getUsers().find({}).toArray();
  const now = new Date();
  let activeCount = 0, expiredCount = 0, disabledCount = 0;
  const usersObj = {};
  users.forEach(u => {
    usersObj[u.key] = { name: u.name, active: u.active, expiry: u.expiry, addedAt: u.addedAt };
    if (!u.active) disabledCount++;
    else if (!u.expiry || new Date(u.expiry) < now) expiredCount++;
    else activeCount++;
  });
  res.json({ totalUsers: users.length, activeCount, expiredCount, disabledCount, users: usersObj });
});

// ADMIN: Add user
app.post("/admin/add-user", async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { key, name, expiry } = req.body;
  if (!key) return res.status(400).json({ error: "key required" });
  const k = key.toUpperCase();
  await getUsers().updateOne(
    { key: k },
    { $set: { key: k, name: name || k, active: true, expiry: expiry || null, addedAt: new Date().toISOString() } },
    { upsert: true }
  );
  res.json({ success: true });
});

// ADMIN: Set user expiry
app.post("/admin/set-user-expiry", async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { key, expiry } = req.body;
  if (!key || !expiry) return res.status(400).json({ error: "key and expiry required" });
  const result = await getUsers().updateOne(
    { key: key.toUpperCase() },
    { $set: { expiry: new Date(expiry).toISOString() } }
  );
  if (result.matchedCount === 0) return res.status(404).json({ error: "User not found" });
  res.json({ success: true });
});

// ADMIN: Toggle user
app.post("/admin/toggle-user", async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { key, active } = req.body;
  if (!key) return res.status(400).json({ error: "key required" });
  await getUsers().updateOne({ key: key.toUpperCase() }, { $set: { active } });
  res.json({ success: true });
});

// ADMIN: Delete user
app.post("/admin/delete-user", async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: "key required" });
  await getUsers().deleteOne({ key: key.toUpperCase() });
  res.json({ success: true });
});

// ADMIN: Get MS values
app.get("/admin/get-ms", async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const ms = await getMsValues();
  res.json({ ms1: ms.ms1, ms2: ms.ms2 });
});

// ADMIN: Set MS values
app.post("/admin/set-ms", async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { ms1, ms2 } = req.body;
  if (!ms1 || !ms2) return res.status(400).json({ error: "ms1 and ms2 required" });
  await getSettings().updateOne(
    { _id: "ms_values" },
    { $set: { _id: "ms_values", ms1: parseInt(ms1), ms2: parseInt(ms2), updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
  console.log(`[Admin] MS values updated: ${ms1}ms / ${ms2}ms`);
  res.json({ success: true, ms1: parseInt(ms1), ms2: parseInt(ms2) });
});

const PORT = process.env.PORT || 3000;
connectDB().then(() => {
  app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
}).catch(err => { console.error("DB connection failed:", err); process.exit(1); });
