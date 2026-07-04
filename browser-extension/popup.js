async function capture(selectionOnly) {
  const status = document.getElementById("status");
  status.textContent = "Reading page…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const selection = String(window.getSelection() || "").trim();
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll("script,style,noscript,nav,header,footer,form,button,svg,canvas").forEach((node) => node.remove());
        const text = (clone.innerText || clone.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
        const author = document.querySelector('meta[name="author"]')?.content || document.querySelector('[rel="author"]')?.textContent?.trim() || "";
        return { version: 1, title: document.title || location.hostname, url: location.href, text, selection, author, capturedAt: new Date().toISOString() };
      },
    });
    if (!result) throw new Error("Page could not be read");
    if (selectionOnly && !result.selection) throw new Error("Select some text first");
    if (!selectionOnly) result.selection = "";
    const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
    const safe = result.title.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "capture";
    await chrome.downloads.download({ url: blobUrl, filename: `${safe}.zenclip.json`, saveAs: false });
    status.textContent = "Saved. Import it from Zen → Sources.";
  } catch (error) { status.textContent = error.message || "Capture failed"; }
}

async function captureScreenshot() {
  const status = document.getElementById("status");
  status.textContent = "Capturing screenshot…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const payload = { version: 1, title: tab.title || "Screenshot", url: tab.url || "", text: "Visible-page screenshot", selection: "", capturedAt: new Date().toISOString(), imageDataUrl };
    const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: "application/json" }));
    await chrome.downloads.download({ url: blobUrl, filename: "screenshot.zenclip.json", saveAs: false });
    status.textContent = "Saved. Import it from Zen → Sources.";
  } catch (error) { status.textContent = error.message || "Screenshot failed"; }
}

document.getElementById("selection").addEventListener("click", () => capture(true));
document.getElementById("page").addEventListener("click", () => capture(false));
document.getElementById("screenshot").addEventListener("click", captureScreenshot);
