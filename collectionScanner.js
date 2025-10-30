(async function () {
  console.log("✅ collectionScanner.js injected");

  const url = location.href;
  const folderIdMatch  = url.match(/\/catalog\/collections\/(\d+)-/);
  const shareCodeMatch = url.match(/-([A-Za-z0-9_-]{16,})$/);
  if (!folderIdMatch || !shareCodeMatch) {
    console.warn("❌ Could not extract folderId/shareCode:", url);
    return;
  }
  const folderId  = folderIdMatch[1];
  const shareCode = shareCodeMatch[1];

  const base =
    "https://www.shutterstock.com/napi/s/dam/holdings/search" +
    "?include=media-item%2Cmedia-item.track-assets%2Cmedia-item.cms-entry" +
    "&sort=-createdAt&useMms=true&channel=shutterstock" +
    "&filter[folderId]=" + encodeURIComponent(folderId) +
    "&filter[assetType]=image%2Cvideo%2Caudio%2Csfx%2Ceditorial-image%2Ceditorial-video%2Cdesign%2Celements" +
    "&shareCode=" + encodeURIComponent(shareCode) +
    "&language=en" +
    "&page[size]=50";

  const isStdId = s => /^[0-9]{6,12}$/.test(s);
  const isEdId  = s => /^[0-9]{5,12}[a-z]{1,3}$/i.test(s);

  function buildUrl(assetType, id) {
    const t = (assetType || "").toLowerCase();
    if (isEdId(id) || t.startsWith("editorial")) {
      return `https://www.shutterstock.com/editorial/image-editorial/${id}`;
    }
    // Use canonical path for all standard media
	return `https://www.shutterstock.com/image/${id}`;
  }

// keep your helpers…
async function fetchPage(n) {
  const u = `${base}&page[number]=${n}`;
  console.log("📡 Fetching:", u);
  const r = await fetch(u, { credentials: "same-origin" });
  return r.json();
}

// already correct: declare sleep OUTSIDE fetchPage
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// optional: small retry wrapper (handles occasional blank/partial pages)
async function fetchPageWithRetry(n, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const json = await fetchPage(n);
      // basic sanity: expect included to be an array (may be empty)
      if (json && (Array.isArray(json.included) || Array.isArray(json.data))) {
        return json;
      }
    } catch (e) {
      console.warn(`⚠️ fetchPage ${n} failed (try ${i+1}/${tries}):`, e);
    }
    // small backoff (exponential-ish)
    await sleep(120 * (i + 1));
  }
  return { included: [], meta: {} };
}




  function extractFromIncluded(json) {
    const inc = Array.isArray(json?.included) ? json.included : [];
    console.log(`ℹ️ included count: ${inc.length}`);

    const links = [];
    for (const it of inc) {
      const a   = it?.attributes || {};
      const typ = (it?.type || "").toLowerCase();

      // For your payload: 
      //  - standard assets:  type === "images", id is the public numeric ID
      //  - editorial assets: type === "rex-assets", id (or attributes.editorialId) is the public ed ID
      let publicId = null;
      if (typ === "images") {
        publicId = String(it.id || a.mediaId || "");
        if (!isStdId(publicId)) continue; // guard against huge internal IDs
      } else if (typ === "rex-assets") {
        publicId = String(a.editorialId || it.id || "");
        if (!isEdId(publicId)) continue;
      } else {
        // ignore other types
        continue;
      }

      links.push(buildUrl(a.assetType, publicId));
    }

    return links;
  }

  // first page
const first = await fetchPageWithRetry(1);
const meta  = first?.meta || {};
const totalPages = Number(meta?.pagination?.totalPages || meta?.page?.totalPages || 1);

let all = extractFromIncluded(first);

for (let p = 2; p <= totalPages; p++) {
  await sleep(120);
  const js = await fetchPageWithRetry(p);
  all = all.concat(extractFromIncluded(js));
}

// de-dupe & final sanity (supports /image/{id} and editorial)
all = Array.from(new Set(all)).filter(u =>
  /\/(image\/\d{6,12}|editorial\/image-editorial\/[0-9a-z]{5,})$/i.test(u)
);

console.log(`✅ Extracted ${all.length} image links`, all);
if (all.length) {
  chrome.runtime.sendMessage({ action: "collectionLinksExtracted", links: all });
} else {
  console.warn("⚠️ No valid IDs extracted from included[]. Open Network → Preview to verify shapes.");
}
})();