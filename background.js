// background.js (MV3 service worker) — queued collection scanning + safe merges

// ---- Queue state ----
const collectionQueue = [];
let processing = false;
let currentTabId = null;

// ---- Helpers ----
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function mergeOffsetLogs(newUrls, cb = () => {}) {
  const add = (newUrls || []).map(u => ({ status: "", url: u }));
  
  chrome.storage.local.get(["offsetLogs"], (data) => {
    const prev = Array.isArray(data.offsetLogs) ? data.offsetLogs : [];
    const map = new Map(prev.map(x => [x.url, x]));

    for (const row of add) {
      if (!map.has(row.url)) map.set(row.url, row); // keep existing status if present
    }

    const merged = Array.from(map.values());
    chrome.storage.local.set(
      { offsetLogs: merged },
      () => {
        console.log("💾 Merged offsetLogs");
        cb();
      }
    );
  });
}

function openUrlsStaggered(urls) {
  (urls || []).forEach((url, i) => {
    setTimeout(() => {
      chrome.tabs.create({ url }, () => {
        if (chrome.runtime.lastError) {
          console.warn("⚠️ Could not open tab:", chrome.runtime.lastError.message);
        }
      });
    }, i * 500);
  });
}

async function processNextInQueue() {
  if (processing) return;
  const nextUrl = collectionQueue.shift();
  if (!nextUrl) return;

  processing = true;
  console.log("📥 Processing collection:", nextUrl);

  // Open the collection tab and inject the scanner
  chrome.tabs.create({ url: nextUrl }, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      console.warn("❌ Tab creation failed:", chrome.runtime.lastError?.message);
      processing = false;
      // proceed to next
      setTimeout(() => { processing = false; processNextInQueue(); }, 0);
      return;
    }

    currentTabId = tab.id;
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["collectionScanner.js"],
    }).catch((err) => {
      console.warn("❌ Failed to inject collectionScanner.js:", err);
      // Close tab and continue
      if (currentTabId) chrome.tabs.remove(currentTabId, () => {});
      currentTabId = null;
      processing = false;
      setTimeout(() => processNextInQueue(), 0);
    });
  });
}

// ---- Message router ----
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // From popup: add a collection to the queue (works even if user clicks twice quickly)
  if (message.action === "scanCollection" && message.url) {
    collectionQueue.push(message.url);
    // start if idle
    if (!processing) processNextInQueue();
    sendResponse?.({ ok: true, queued: collectionQueue.length });
    return true;
  }

  // From popup: open non-collection URLs
  if (message.action === "openTabs" && Array.isArray(message.urls)) {
    console.log(`📂 Opening ${message.urls.length} tabs`);
    openUrlsStaggered(message.urls);
    sendResponse?.({ ok: true });
    return true;
  }

  // From scanner in the collection tab
  if (message.action === "collectionLinksExtracted" && Array.isArray(message.links)) {
    console.log(`✅ Scanner returned ${message.links.length} links`);

    // 1️⃣ Merge into logs (no overwrite)
    mergeOffsetLogs(message.links, () => {
      // Notify popup (if open)
      chrome.runtime.sendMessage(
        { action: "collectionLinksExtracted", links: message.links },
        () => { /* ignore lastError when popup closed */ }
      );
    });

    // 2️⃣ Open each extracted item in its own tab (staggered)
    openUrlsStaggered(message.links);

    // 3️⃣ Badge (optional)
    chrome.action.setBadgeBackgroundColor({ color: "#2E7D32" });
    chrome.action.setBadgeText({ text: String(message.links.length) });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 8000);

    // 4️⃣ Close the collection tab we just processed (optional but cleaner)
    if (currentTabId != null) {
      chrome.tabs.remove(currentTabId, () => {});
    }
    currentTabId = null;

    // 5️⃣ Move to next collection after a tiny pause
    processing = false;
    setTimeout(() => processNextInQueue(), 150); // short gap before next
    sendResponse?.({ ok: true });
    return true;
  }

  // Unknown
  console.warn("⚠️ Unknown message:", message);
  sendResponse?.({ error: "unknown_action" });
  return true;
});