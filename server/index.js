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

// ─── PUBLIC: Extension checks global + user validity ───────
app.get("/check", (req, res) => {
  const data = loadData();
  const licenseKey = req.headers["x-license-key"] || req.query.key || null;

  // Global expiry check
  if (!data.expiry) {
    return res.json({ valid: false, reason: "No expiry set" });
  }
  const now = new Date();
  const globalExpiry = new Date(data.expiry);
  if (now > globalExpiry) {
    return res.json({ valid: false, reason: "Global validity expired" });
  }

  // Per-user check (if license key provided)
  if (licenseKey) {
    const user = data.users[licenseKey.toUpperCase()];
    if (!user) {
      return res.json({ valid: false, reason: "License key not found" });
    }
    if (!user.active) {
      return res.json({ valid: false, reason: "Your license has been disabled" });
    }
    const daysLeft = Math.max(0, Math.ceil((globalExpiry - now) / (1000 * 60 * 60 * 24)));
    return res.json({
      valid: true,
      expiry: data.expiry,
      daysLeft,
      reason: "Active",
      userName: user.name || licenseKey
    });
  }

  // No license key — global only
  const daysLeft = Math.max(0, Math.ceil((globalExpiry - now) / (1000 * 60 * 60 * 24)));
  return res.json({ valid: true, expiry: data.expiry, daysLeft, reason: "Active" });
});

// ─── ADMIN: Get status ──────────────────────────────────────
app.get("/admin/status", (req, res) => {
  if (!checkAdmin(req, res)) return;
  const data = loadData();
  const now = new Date();
  const expiry = data.expiry ? new Date(data.expiry) : null;
  return res.json({
    expiry: data.expiry || "Not set",
    valid: expiry ? now <= expiry : false,
    daysLeft: expiry ? Math.max(0, Math.ceil((expiry - now) / (1000 * 60 * 60 * 24))) : 0,
    users: data.users
  });
});

// ─── ADMIN: Set global expiry ───────────────────────────────
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

// ─── ADMIN: Clear global expiry ────────────────────────────
app.post("/admin/clear-expiry", (req, res) => {
  if (!checkAdmin(req, res)) return;
  const data = loadData();
  data.expiry = null;
  saveData(data);
  return res.json({ success: true, message: "Expiry cleared." });
});

// ─── ADMIN: Add user ────────────────────────────────────────
app.post("/admin/add-user", (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { key, name } = req.body;
  if (!key) return res.status(400).json({ error: "key required" });
  const data = loadData();
  data.users[key.toUpperCase()] = { name: name || key, active: true, addedAt: new Date().toISOString() };
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Validity server running on port ${PORT}`);
});
