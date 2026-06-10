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

async function getGlobalMsValues() {
  const doc = await getSettings().findOne({ _id: "ms_values" });
  return { ms1: doc?.ms1 || 990, ms2: doc?.ms2 || 1150 };
}

// ==================== PUBLIC ENDPOINTS ====================

app.get("/check", async (req, res) => {
  const licenseKey = (req.headers["x-license-key"] || req.query.key || "").toUpperCase();
  const browserFingerprint = req.headers["x-browser-fp"] || null;

  if (!licenseKey) return res.json({ valid: false, reason: "No license key" });
  const user = await getUsers().findOne({ key: licenseKey });
  if (!user) return res.json({ valid: false, reason: "License key not found" });
  if (!user.active) return res.json({ valid: false, reason: "Your license has been disabled" });
  if (!user.expiry) return res.json({ valid: false, reason: "No expiry set" });

  const now = new Date();
  const expiry = new Date(user.expiry);
  if (now > expiry) return res.json({ valid: false, reason: "Your license has expired" });

  // ── Browser Lock ──
  if (browserFingerprint) {
    if (!user.browserFp) {
      // প্রথমবার — fingerprint save করো
      await getUsers().updateOne(
        { key: licenseKey },
        { $set: { browserFp: browserFingerprint, browserLockedAt: new Date().toISOString() } }
      );
      console.log(`[Lock] Browser locked for: ${licenseKey}`);
    } else if (user.browserFp !== browserFingerprint) {
      // অন্য browser — block
      return res.json({
        valid: false,
        reason: "This license is locked to another browser. Contact your admin to reset."
      });
    }
  }

  const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

  let ms1, ms2;
  if (user.ms1 && user.ms2) {
    ms1 = user.ms1; ms2 = user.ms2;
  } else {
    const global = await getGlobalMsValues();
    ms1 = global.ms1; ms2 = global.ms2;
  }

  return res.json({
    valid: true,
    expiry: user.expiry,
    daysLeft,
    reason: "Active",
    userName: user.name || licenseKey,
    browserLocked: !!user.browserFp,
    ms1, ms2
  });
});

app.get("/get-ms", async (req, res) => {
  const licenseKey = (req.headers["x-license-key"] || req.query.key || "").toUpperCase();
  if (licenseKey) {
    const user = await getUsers().findOne({ key: licenseKey });
    if (user && user.ms1 && user.ms2) return res.json({ ms1: user.ms1, ms2: user.ms2 });
  }
  const ms = await getGlobalMsValues();
  res.json({ ms1: ms.ms1, ms2: ms.ms2 });
});

// ==================== ADMIN ENDPOINTS ====================

app.get("/admin/status", async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const users = await getUsers().find({}).toArray();
  const now = new Date();
  let activeCount = 0, expiredCount = 0, disabledCount = 0;
  const usersObj = {};
  users.forEach(u => {
    usersObj[u.key] = {
      name: u.name, active: u.active, expiry: u.expiry,
      addedAt: u.addedAt, ms1: u.ms1 || null, ms2: u.ms2 || null,
      browserFp: u.browserFp || null,
      browserLockedAt: u.browserLockedAt || null
    };
    if (!u.active) disabledCount++;
    else if (!u.expiry || new Date(u.expiry) < now) expiredCount++;
    else activeCount++;
  });
  res.json({ totalUsers: users.length, activeCount, expiredCount, disabledCount, users: usersObj });
});

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

app.post("/admin/toggle-user", async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { key, active } = req.body;
  if (!key) return res.status(400).json({ error: "key required" });
  await getUsers().updateOne({ key: key.toUpperCase() }, { $set: { active } });
  res.json({ success: true });
});

app.post("/admin/delete-user", async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: "key required" });
  await getUsers().deleteOne({ key: key.toUpperCase() });
  res.json({ success: true });
});

app.get("/admin/get-ms", async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const ms = await getGlobalMsValues();
  res.json({ ms1: ms.ms1, ms2: ms.ms2 });
});

app.post("/admin/set-ms", async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { ms1, ms2 } = req.body;
  if (!ms1 || !ms2) return res.status(400).json({ error: "ms1 and ms2 required" });
  await getSettings().updateOne(
    { _id: "ms_values" },
    { $set: { _id: "ms_values", ms1: parseInt(ms1), ms2: parseInt(ms2), updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
  res.json({ success: true, ms1: parseInt(ms1), ms2: parseInt(ms2) });
});

app.post("/admin/set-user-ms", async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { key, ms1, ms2 } = req.body;
  if (!key) return res.status(400).json({ error: "key required" });
  const k = key.toUpperCase();
  if (ms1 === null && ms2 === null) {
    await getUsers().updateOne({ key: k }, { $unset: { ms1: "", ms2: "" } });
    return res.json({ success: true, cleared: true });
  }
  if (!ms1 || !ms2 || parseInt(ms1) < 100 || parseInt(ms2) < 100)
    return res.status(400).json({ error: "Valid ms1 and ms2 required (min 100)" });
  await getUsers().updateOne({ key: k }, { $set: { ms1: parseInt(ms1), ms2: parseInt(ms2) } });
  res.json({ success: true, ms1: parseInt(ms1), ms2: parseInt(ms2) });
});

// ── ADMIN: Reset browser lock ──
app.post("/admin/reset-browser", async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: "key required" });
  const result = await getUsers().updateOne(
    { key: key.toUpperCase() },
    { $unset: { browserFp: "", browserLockedAt: "" } }
  );
  if (result.matchedCount === 0) return res.status(404).json({ error: "User not found" });
  console.log(`[Admin] Browser lock reset for: ${key}`);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
connectDB().then(() => {
  app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
}).catch(err => { console.error("DB connection failed:", err); process.exit(1); });
