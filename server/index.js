const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const ADMIN_SECRET = process.env.ADMIN_SECRET || "change-this-secret";
const DATA_FILE = path.join(__dirname, "validity.json");

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ expiry: null, users: {} }, null, 2));
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  if (!data.users) data.users = {};
  return data;
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function checkAdmin(req, res) {
  const secret = req.headers["x-admin-secret"];
  if (secret !== ADMIN_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

// ─── PUBLIC: Extension checks user validity ─────────────────
app.get("/check", (req, res) => {
  const data = loadData();
  const licenseKey = req.headers["x-license-key"] || req.query.key || null;
  const now = new Date();

  if (licenseKey) {
    const user = data.users[licenseKey.toUpperCase()];
    if (!user) {
      return res.json({ valid: false, reason: "License key not found" });
    }
    if (!user.active) {
      return res.json({ valid: false, reason: "Your license has been disabled" });
    }
    if (!user.expiry) {
      return res.json({ valid: false, reason: "No expiry set for this user" });
    }
    const userExpiry = new Date(user.expiry);
    if (now > userExpiry) {
      return res.json({ valid: false, reason: "Your license has expired" });
    }
    const daysLeft = Math.max(0, Math.ceil((userExpiry - now) / (1000 * 60 * 60 * 24)));
    return res.json({
      valid: true,
      expiry: user.expiry,
      daysLeft,
      reason: "Active",
      userName: user.name || licenseKey
    });
  }

  // No license key — global fallback
  if (!data.expiry) return res.json({ valid: false, reason: "No expiry set" });
  const globalExpiry = new Date(data.expiry);
  if (now > globalExpiry) return res.json({ valid: false, reason: "Global validity expired" });
  const daysLeft = Math.max(0, Math.ceil((globalExpiry - now) / (1000 * 60 * 60 * 24)));
  return res.json({ valid: true, expiry: data.expiry, daysLeft, reason: "Active" });
});

// ─── ADMIN: Get status ──────────────────────────────────────
app.get("/admin/status", (req, res) => {
  if (!checkAdmin(req, res)) return;
  const data = loadData();
  const now = new Date();
  const users = data.users;
  let activeCount = 0, expiredCount = 0, disabledCount = 0;
  Object.values(users).forEach(u => {
    if (!u.active) disabledCount++;
    else if (!u.expiry || new Date(u.expiry) < now) expiredCount++;
    else activeCount++;
  });
  return res.json({
    totalUsers: Object.keys(users).length,
    activeCount,
    expiredCount,
    disabledCount,
    users
  });
});

// ─── ADMIN: Add user ────────────────────────────────────────
app.post("/admin/add-user", (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { key, name, expiry } = req.body;
  if (!key) return res.status(400).json({ error: "key required" });
  const data = loadData();
  data.users[key.toUpperCase()] = {
    name: name || key,
    active: true,
    expiry: expiry ? new Date(expiry).toISOString() : null,
    addedAt: new Date().toISOString()
  };
  saveData(data);
  return res.json({ success: true, user: data.users[key.toUpperCase()] });
});

// ─── ADMIN: Set user expiry ─────────────────────────────────
app.post("/admin/set-user-expiry", (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { key, expiry } = req.body;
  if (!key || !expiry) return res.status(400).json({ error: "key and expiry required" });
  const data = loadData();
  if (!data.users[key.toUpperCase()]) return res.status(404).json({ error: "User not found" });
  data.users[key.toUpperCase()].expiry = new Date(expiry).toISOString();
  saveData(data);
  return res.json({ success: true, user: data.users[key.toUpperCase()] });
});

// ─── ADMIN: Toggle user active/inactive ─────────────────────
app.post("/admin/toggle-user", (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { key, active } = req.body;
  if (!key) return res.status(400).json({ error: "key required" });
  const data = loadData();
  if (!data.users[key.toUpperCase()]) return res.status(404).json({ error: "User not found" });
  data.users[key.toUpperCase()].active = active;
  saveData(data);
  return res.json({ success: true, user: data.users[key.toUpperCase()] });
});

// ─── ADMIN: Delete user ─────────────────────────────────────
app.post("/admin/delete-user", (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: "key required" });
  const data = loadData();
  delete data.users[key.toUpperCase()];
  saveData(data);
  return res.json({ success: true });
});

// ─── ADMIN: Set global expiry (legacy support) ──────────────
app.post("/admin/set-expiry", (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { expiry } = req.body;
  if (!expiry) return res.status(400).json({ error: "expiry date required" });
  const date = new Date(expiry);
  if (isNaN(date.getTime())) return res.status(400).json({ error: "Invalid date" });
  const data = loadData();
  data.expiry = date.toISOString();
  saveData(data);
  return res.json({ success: true, expiry: data.expiry });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Validity server running on port ${PORT}`);
});
