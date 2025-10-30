console.log("Popup script loaded");

function updateLogDisplay(logs) {
  // show only rows that actually have a status
  const logsx = (logs || []).filter(item => item.status && item.status !== "");
  console.log("🧪 updateLogDisplay called with", logsx.length, "visible entries");

  const logArea = document.getElementById("logArea");
  const summaryLine = document.getElementById("summaryLine");
  if (!logArea) return;

  const counts = { STANDARD: 0, OFFSET: 0, GENERATED: 0, EDITORIAL: 0 };

  const entries = logsx.map(log => {
    const raw = (log.status || "").trim();
    const type = raw.toUpperCase();
    if (counts.hasOwnProperty(type)) counts[type]++;
    return `${raw}, ${log.url || ""}`;
  });

  const header = "status,url";
  const summaryBlock = [
    `Standard, ${counts.STANDARD}`,
    `Offset, ${counts.OFFSET}`,
    `Generated, ${counts.GENERATED}`,
    `Editorial, ${counts.EDITORIAL}`
  ];

  logArea.value = [header, ...entries, "", ...summaryBlock].join("\n");

  if (summaryLine) {
    summaryLine.textContent =
      `STANDARD: ${counts.STANDARD} | OFFSET: ${counts.OFFSET} | ` +
      `GENERATED: ${counts.GENERATED} | EDITORIAL: ${counts.EDITORIAL}`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const logArea = document.getElementById("logArea");
  const linkArea = document.getElementById("linkArea");

  // restore saved text + logs
  chrome.storage.local.get(["linkAreaContent", "offsetLogs"], (data) => {
    if (linkArea && data.linkAreaContent) linkArea.value = data.linkAreaContent;
    if (Array.isArray(data.offsetLogs)) updateLogDisplay(data.offsetLogs);
  });

  // keep textarea saved
  linkArea?.addEventListener("input", () => {
    chrome.storage.local.set({ linkAreaContent: linkArea.value });
  });

  // when background / content updates logs, refresh popup
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.offsetLogs?.newValue) {
      updateLogDisplay(changes.offsetLogs.newValue);
    }
  });

  // collection results coming from background → just open + let content.js log
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "collectionLinksExtracted" && Array.isArray(message.links)) {
      console.log(`Extracted ${message.links.length} links from collection`);

      // open them
      chrome.runtime.sendMessage({ action: "openTabs", urls: message.links });

      // DO NOT write to storage here – content.js will do it
    }
  });

  // download current view
  document.getElementById("downloadBtn")?.addEventListener("click", () => {
    const blob = new Blob([logArea?.value || ""], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "offset_check_history.csv";
    a.click();
  });

  // open links / IDs / collection URLs
  document.getElementById("openLinkBtn")?.addEventListener("click", () => {
    const lines = (linkArea?.value || "").split("\n");
    const urls = [];

    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // collection → background will inject scanner
      if (trimmed.includes("/catalog/collections/")) {
        chrome.runtime.sendMessage({ action: "scanCollection", url: trimmed });
        return;
      }

      let url = null;
      if (trimmed.startsWith("http")) {
        url = trimmed;
      } else if (/^\d+[a-z]+$/i.test(trimmed)) {
        url = `https://www.shutterstock.com/editorial/image-editorial/${trimmed}`;
      } else if (/^\d+$/.test(trimmed)) {
        url = `https://www.shutterstock.com/image/${trimmed}`;
      }

      if (url) urls.push(url);
    });

    if (urls.length) {
      console.log(`Opening ${urls.length} tabs`);
      chrome.runtime.sendMessage({ action: "openTabs", urls });
      // DO NOT save logs here
    }
  });

  // clear textarea
  document.getElementById("clearLinkBtn")?.addEventListener("click", () => {
    if (linkArea) linkArea.value = "";
    chrome.storage.local.remove("linkAreaContent");
  });

  // clear logs
  document.getElementById("clearBtn")?.addEventListener("click", () => {
    if (logArea) logArea.value = "";
    const sL = document.getElementById("summaryLine");
    if (sL) sL.textContent = "";
    chrome.storage.local.set({ offsetLogs: [] });
  });
});