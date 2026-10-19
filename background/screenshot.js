import { bytesToDataUrl } from './media.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function captureVisible(windowId, format = 'png', quality = 92) {
  const options = { format };
  if (format === 'jpeg') options.quality = quality;
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, options);
  if (!dataUrl) throw new Error('无法截取当前页面');
  return dataUrl;
}

function prepareFullPage() {
  const hidden = [];
  try {
    for (const el of document.querySelectorAll('body *')) {
      try {
        const pos = getComputedStyle(el).position;
        if (pos === 'fixed' || pos === 'sticky') {
          hidden.push([el, el.style.visibility]);
          el.style.visibility = 'hidden';
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  document.getElementById('ant-col-toast-host')?.remove();
  document.getElementById('ant-col-capture-host')?.remove();
  window.__antColFullPageHidden = hidden;
  window.__antColFullPageScroll = window.scrollY || 0;
  const width = document.documentElement.clientWidth || window.innerWidth || 0;
  const height = Math.max(
    document.documentElement.scrollHeight || 0,
    document.body?.scrollHeight || 0,
    window.innerHeight || 0
  );
  window.scrollTo(0, 0);
  return { width, height, viewport: window.innerHeight, dpr: window.devicePixelRatio || 1 };
}

function scrollToY(y) {
  window.scrollTo(0, y);
  return new Promise((resolve) => {
    setTimeout(() => resolve({ scrollY: window.scrollY, viewport: window.innerHeight }), 160);
  });
}

function restoreFullPage() {
  try {
    for (const [el, visibility] of window.__antColFullPageHidden || []) {
      try { el.style.visibility = visibility; } catch { /* ignore */ }
    }
    window.scrollTo(0, window.__antColFullPageScroll || 0);
  } catch { /* ignore */ }
  delete window.__antColFullPageHidden;
  delete window.__antColFullPageScroll;
}

async function captureTile(tabId, windowId, format, quality) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await chrome.tabs.captureVisibleTab(windowId, format === 'jpeg' ? { format, quality } : { format });
    } catch (err) {
      if (attempt === 2) throw err;
      await sleep(650);
    }
  }
  throw new Error('截图失败');
}

export async function captureFullPage(tabId, format = 'png', quality = 92) {
  const tab = await chrome.tabs.get(tabId);
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  if (tab?.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});

  let prepared = null;
  try {
    const [prep] = await chrome.scripting.executeScript({ target: { tabId }, func: prepareFullPage });
    prepared = prep?.result;
    if (!prepared || !prepared.width || !prepared.height) throw new Error('无法获取页面尺寸');

    const MAX_HEIGHT = 16000;
    const scale = Math.min(1, MAX_HEIGHT / prepared.height);
    const canvasWidth = Math.max(1, Math.round(prepared.width * prepared.dpr * scale));
    const canvasHeight = Math.max(1, Math.round(prepared.height * prepared.dpr * scale));
    const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    const step = Math.max(240, prepared.viewport - 2);
    let y = 0;
    let guard = 0;
    while (y < prepared.height && guard < 80) {
      guard++;
      const [pos] = await chrome.scripting.executeScript({ target: { tabId }, func: scrollToY, args: [y] });
      const scrollY = Number(pos?.result?.scrollY ?? y);
      await sleep(220);
      const dataUrl = await captureTile(tabId, tab.windowId, format, quality);
      const blob = await (await fetch(dataUrl)).blob();
      const bitmap = await createImageBitmap(blob);
      const drawY = Math.round(scrollY * prepared.dpr * scale);
      const sourceWidth = Math.min(bitmap.width, Math.round(prepared.width * prepared.dpr));
      const drawW = Math.round(sourceWidth * scale);
      const drawH = Math.round(bitmap.height * scale);
      ctx.drawImage(bitmap, 0, 0, sourceWidth, bitmap.height, 0, drawY, drawW, drawH);
      bitmap.close?.();
      y += step;
      await sleep(360);
    }

    const output = await canvas.convertToBlob({
      type: format === 'jpeg' ? 'image/jpeg' : 'image/png',
      quality
    });
    const buffer = await output.arrayBuffer();
    return bytesToDataUrl(new Uint8Array(buffer), format === 'jpeg' ? 'image/jpeg' : 'image/png');
  } finally {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, func: restoreFullPage });
    } catch { /* ignore */ }
  }
}

export async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}
