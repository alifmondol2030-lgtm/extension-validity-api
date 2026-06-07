// ============================================================
//  validity.js — Extension e এই file টা include করো
//  এটা server থেকে expiry check করে extension enable/disable করে
// ============================================================

const VALIDITY_SERVER_URL = "https://YOUR-APP-NAME.onrender.com"; // ← Render URL দাও

// Cache time: 5 minutes (বারবার server call এড়াতে)
const CACHE_DURATION_MS = 5 * 60 * 1000;

let _cachedResult = null;
let _cacheTime = 0;

/**
 * Server থেকে validity check করো
 * @returns {Promise<{valid: boolean, reason: string, expiry: string|null}>}
 */
async function checkValidity() {
  const now = Date.now();

  // Cache valid থাকলে server call করো না
  if (_cachedResult && now - _cacheTime < CACHE_DURATION_MS) {
    return _cachedResult;
  }

  try {
    const response = await fetch(`${VALIDITY_SERVER_URL}/check`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();
    _cachedResult = data;
    _cacheTime = now;
    return data;

  } catch (error) {
    console.error("[Validity] Check failed:", error.message);

    // Server reach না হলে — invalid ধরো (safe default)
    return { valid: false, reason: "Server unreachable", expiry: null };
  }
}

/**
 * Extension initialize করার সময় এই function call করো
 * Valid হলে callback চলবে, না হলে extension বন্ধ হবে
 *
 * @param {Function} onValid   — extension চালু হলে এই function run হবে
 * @param {Function} onInvalid — expired/invalid হলে এই function run হবে
 */
async function initWithValidityCheck(onValid, onInvalid) {
  const result = await checkValidity();

  if (result.valid) {
    console.log("[Validity] ✅ Active. Expiry:", result.expiry);
    if (typeof onValid === "function") onValid(result);
  } else {
    console.warn("[Validity] ❌ Invalid:", result.reason);
    if (typeof onInvalid === "function") onInvalid(result);
  }
}

// ─── তোমার extension এ এভাবে use করো ──────────────────────
//
//  initWithValidityCheck(
//    (info) => {
//      // ✅ Extension চালু করো এখানে
//      startExtension();
//    },
//    (info) => {
//      // ❌ Expired হলে এখানে handle করো
//      showExpiredMessage(info.reason);
//    }
//  );
//
// ────────────────────────────────────────────────────────────
