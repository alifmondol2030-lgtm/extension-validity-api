# Extension Validity System

Browser extension এর জন্য **date/expiry based** validity control system।  
Admin API call করে expiry set করবে, extension সেটা check করবে।

---

## 📁 Structure

```
extension-validity/
├── server/
│   ├── index.js        ← Express API server
│   ├── package.json
│   └── validity.json   ← Expiry data (auto-created)
├── extension/
│   └── validity.js     ← Extension এ include করার script
├── render.yaml         ← Render deploy config
└── README.md
```

---

## 🚀 Deploy to Render

1. GitHub এ এই repo push করো
2. [render.com](https://render.com) → **New Web Service**
3. Repo connect করো
4. Root Directory: `server`
5. Build: `npm install` | Start: `npm start`
6. Environment Variable:
   - `ADMIN_SECRET` = যেকোনো strong secret key (e.g. `mysecret123`)
7. Deploy করো → URL পাবে (e.g. `https://extension-validity-api.onrender.com`)

---

## 🔧 Extension এ Setup

`extension/validity.js` তোমার extension এ include করো।  
তারপর `VALIDITY_SERVER_URL` এ Render এর URL দাও:

```js
const VALIDITY_SERVER_URL = "https://extension-validity-api.onrender.com";
```

তোমার extension এর main script এ:

```js
initWithValidityCheck(
  (info) => {
    // ✅ Valid — extension start করো
    startExtension();
  },
  (info) => {
    // ❌ Expired — user কে জানাও
    alert("Extension expired: " + info.reason);
  }
);
```

---

## 📡 Admin API Calls

### ✅ Expiry Set করো
```bash
curl -X POST https://YOUR-APP.onrender.com/admin/set-expiry \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: YOUR_SECRET" \
  -d '{"expiry": "2025-12-31"}'
```

### 📊 Current Status দেখো
```bash
curl https://YOUR-APP.onrender.com/admin/status \
  -H "x-admin-secret: YOUR_SECRET"
```

### ❌ Extension বন্ধ করো (expiry clear)
```bash
curl -X POST https://YOUR-APP.onrender.com/admin/clear-expiry \
  -H "x-admin-secret: YOUR_SECRET"
```

### 🔍 Extension যেটা call করে (public)
```bash
curl https://YOUR-APP.onrender.com/check
```

---

## 📤 Response Examples

**Valid:**
```json
{ "valid": true, "expiry": "2025-12-31T00:00:00.000Z", "reason": "Active" }
```

**Expired:**
```json
{ "valid": false, "expiry": "2024-01-01T00:00:00.000Z", "reason": "Expired" }
```
