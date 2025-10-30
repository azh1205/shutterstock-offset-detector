// content.js

// --- Canonicalize to match popup/scanner keys ---
// Editorial → https://www.shutterstock.com/editorial/image-editorial/ID
// Standard  → https://www.shutterstock.com/image/ID
function canonicalize(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();

    // editorial
    const mEd = path.match(/\/editorial\/image-editorial\/([0-9a-z]{5,})$/i);
    if (mEd) return `https://www.shutterstock.com/editorial/image-editorial/${mEd[1]}`;

    // image / image-photo / image-vector / image-illustration → canonical /image/ID
    const mStd = path.match(/\/image(?:-[a-z]+)?\/([0-9]{6,12})$/i);
    if (mStd) return `https://www.shutterstock.com/image/${mStd[1]}`;

    return url;
  } catch { return url; }
}

// Stronger labels should overwrite weaker ones
const RANK = { "": 0, "STANDARD": 1, "EDITORIAL": 2, "GENERATED": 2, "OFFSET": 3 };

// Upsert (merge/upgrade) instead of "skip if duplicate"
function upsertOffsetLog(canonUrl, newStatus) {
  const status = (newStatus || "").toUpperCase();

  chrome.storage.local.get(["offsetLogs"], (data) => {
    const prev = Array.isArray(data.offsetLogs) ? data.offsetLogs : [];
    const map = new Map(prev.map(x => [x.url, x]));

    const row = map.get(canonUrl) || { url: canonUrl, status: "" };
    if ((RANK[status] || 0) > (RANK[row.status] || 0)) {
      row.status = status; // upgrade only
    }
    map.set(canonUrl, row);

    if(status != null) {
      chrome.storage.local.set({ offsetLogs: Array.from(map.values()) });
    }

    
  });
}

// -------------------- detection (unchanged logic) --------------------
const html = document.documentElement.innerHTML.toLowerCase();

const isOffset    = html.includes("offset_logo_black_background.png");
const isEditorial = html.includes("image-editorial");
const isGenerated = html.includes("ai-generated image formats");

const url   = window.location.href;
const canon = canonicalize(url);

const status = isOffset
  ? "OFFSET"
  : (isEditorial
      ? "EDITORIAL"
      : (isGenerated
          ? "GENERATED"
          : "STANDARD"));

console.log("[content] detected:", { canon, status });

// Merge/upgrade row
upsertOffsetLog(canon, status);

// Optional: also inform background (harmless if no listener)
chrome.runtime.sendMessage({ action: "updateStatus", url: canon, status }, () => {});