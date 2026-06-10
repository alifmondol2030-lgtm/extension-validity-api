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

function getUsers()    { return db.collection("users"); }
function getSettings() { return db.collection("settings"); }
function getRequests() { return db.collection("activation_requests"); }

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

  if (!licenseKey) return res.json({ valid: false, reason: "No license key" });
  const user = await getUsers().findOne({ key: licenseKey });
  if (!user) return res.json({ valid: false, reason: "License key not found" });
  if (!user.active) return res.json({ valid: false, reason: "Your license has been disabled" });
  if (!user.expiry) return res.json({ valid: false, reason: "No expiry set" });

  const now = new Date();
  const expiry = new Date(user.expiry);
  if (now > expiry) return res.json({ valid: false, reason: "Your license has expired" });

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

// ==================== ACTIVATION REQUEST ====================

app.post("/verify-request", async (req, res) => {
  const { key, fingerprint, userAgent } = req.body;
  if (!key || !fingerprint) {
    return res.status(400).json({ error: "key and fingerprint required" });
  }

  const licenseKey = key.toUpperCase();
  const user = await getUsers().findOne({ key: licenseKey });
  if (!user) return res.json({ status: "not_found", reason: "License key not found" });
  if (!user.active) return res.json({ status: "disabled", reason: "License disabled" });

  const existing = await getRequests().findOne({ key: licenseKey, fingerprint, status: "allowed" });
  if (existing) {
    return res.json({ status: "allowed", reason: "Already approved" });
  }

  const pending = await getRequests().findOne({ key: licenseKey, fingerprint, status: "pending" });
  if (pending) {
    return res.json({ status: "pending", reason: "Waiting for admin approval", requestId: pending._id });
  }

  const newReq = {
    key: licenseKey,
    fingerprint,
    userAgent: userAgent || "Unknown",
    requestedAt: new Date().toISOString(),
    status: "pending"
  };
  const result = await getRequests().insertOne(newReq);
  console.log(`[Request] New activation request: ${licenseKey} | fp: ${fingerprint.substring(0, 12)}...`);

  res.json({
    status: "pending",
    reason: "Your request has been sent to admin. Please wait for approval.",
    requestId: result.insertedId
  });
});

app.get("/check-approval", async (req, res) => {
  const key = (req.query.key || "").toUpperCase();
  const fingerprint = req.query.fp || "";

  if (!key || !fingerprint) {
    return res.status(400).json({ error: "key and fp required" });
  }

  const approved = await getRequests().findOne({ key, fingerprint, status: "allowed" });
  if (approved) return res.json({ status: "allowed" });

  const denied = await getRequests().findOne({ key, fingerprint, status: "denied" });
  if (denied) return res.json({ status: "denied", reason: "Your request was denied by admin." });

  const pending = await getRequests().findOne({ key, fingerprint, status: "pending" });
  if (pending) return res.json({ status: "pending", reason: "Waiting for admin approval." });

  return res.json({ status: "not_found" });
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
      addedAt: u.addedAt, ms1: u.ms1 || null, ms2: u.ms2 || null
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
  await getRequests().deleteMany({ key: key.toUpperCase() });
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

// ── ADMIN: সব pending requests দেখো ──
app.get("/admin/pending-requests", async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const filterKey = req.query.key ? req.query.key.toUpperCase() : null;
  const query = filterKey ? { key: filterKey } : {};
  const requests = await getRequests()
    .find(query)
    .sort({ requestedAt: -1 })
    .toArray();
  const formatted = requests.map(r => ({
    id: r._id.toString(),
    key: r.key,
    fingerprint: r.fingerprint,
    userAgent: r.userAgent,
    requestedAt: r.requestedAt,
    status: r.status
  }));
  res.json({ requests: formatted, total: formatted.length });
});

// ── ADMIN: Request approve করো ──
app.post("/admin/approve-request", async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { key, requestId } = req.body;
  if (!key || !requestId) return res.status(400).json({ error: "key and requestId required" });
  const { ObjectId } = require("mongodb");
  let oid;
  try { oid = new ObjectId(requestId); }
  catch { return res.status(400).json({ error: "Invalid requestId" }); }
  const result = await getRequests().updateOne(
    { _id: oid, key: key.toUpperCase() },
    { $set: { status: "allowed", approvedAt: new Date().toISOString() } }
  );
  if (result.matchedCount === 0) return res.status(404).json({ error: "Request not found" });
  console.log(`[Admin] ✅ Approved request: ${requestId} for key: ${key}`);
  res.json({ success: true });
});

// ── ADMIN: Request deny করো ──
app.post("/admin/deny-request", async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { key, requestId } = req.body;
  if (!key || !requestId) return res.status(400).json({ error: "key and requestId required" });
  const { ObjectId } = require("mongodb");
  let oid;
  try { oid = new ObjectId(requestId); }
  catch { return res.status(400).json({ error: "Invalid requestId" }); }
  const result = await getRequests().updateOne(
    { _id: oid, key: key.toUpperCase() },
    { $set: { status: "denied", deniedAt: new Date().toISOString() } }
  );
  if (result.matchedCount === 0) return res.status(404).json({ error: "Request not found" });
  console.log(`[Admin] ✕ Denied request: ${requestId} for key: ${key}`);
  res.json({ success: true });
});

// ── ADMIN: কোনো key এর সব requests মুছো ──
app.post("/admin/clear-requests", async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: "key required" });
  await getRequests().deleteMany({ key: key.toUpperCase() });
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
connectDB().then(() => {
  app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
}).catch(err => { console.error("DB connection failed:", err); process.exit(1); });
