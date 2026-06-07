const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// ─── CONFIG ────────────────────────────────────────────────
const ADMIN_SECRET = process.env.ADMIN_SECRET || "change-this-secret";
const DATA_FILE = path.join(__dirname, "validity.json");

// ─── HELPERS ───────────────────────────────────────────────
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ expiry: null }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
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

// ─── ROUTES ────────────────────────────────────────────────

// Extension calls this to check validity
app.get("/check", (req, res) => {
  const data = loadData();

  if (!data.expiry) {
    return res.json({ valid: false, reason: "No expiry set" });
  }

  const now = new Date();
  const expiry = new Date(data.expiry);
  const valid = now <= expiry;

  return res.json({
    valid,
    expiry: data.expiry,
    reason: valid ? "Active" : "Expired",
  });
});

// Admin: expiry date set koro
// POST /admin/set-expiry
// Header: x-admin-secret: YOUR_SECRET
// Body: { "expiry": "2025-12-31" }
app.post("/admin/set-expiry", (req, res) => {
  if (!checkAdmin(req, res)) return;

  const { expiry } = req.body;
  if (!expiry) {
    return res.status(400).json({ error: "expiry date required (YYYY-MM-DD)" });
  }

  const date = new Date(expiry);
  if (isNaN(date.getTime())) {
    return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
  }

  const data = loadData();
  data.expiry = date.toISOString();
  saveData(data);

  return res.json({
    success: true,
    message: `Expiry set to ${date.toDateString()}`,
    expiry: data.expiry,
  });
});

// Admin: current expiry dekhao
app.get("/admin/status", (req, res) => {
  if (!checkAdmin(req, res)) return;

  const data = loadData();
  const now = new Date();
  const expiry = data.expiry ? new Date(data.expiry) : null;

  return res.json({
    expiry: data.expiry || "Not set",
    valid: expiry ? now <= expiry : false,
    daysLeft: expiry
      ? Math.max(0, Math.ceil((expiry - now) / (1000 * 60 * 60 * 24)))
      : 0,
  });
});

// Admin: expiry clear koro (disable extension)
app.post("/admin/clear-expiry", (req, res) => {
  if (!checkAdmin(req, res)) return;

  const data = loadData();
  data.expiry = null;
  saveData(data);

  return res.json({ success: true, message: "Expiry cleared. Extension disabled." });
});

// ─── START ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Validity server running on port ${PORT}`);
});
