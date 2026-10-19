import { DOWNLOAD_TIMEOUT_MS } from './config.js';

function normalizeDownloadPath(path) {
  return String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

function waitForDownload(downloadId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.downloads.onChanged.removeListener(listener);
      reject(new Error('下载超时'));
    }, DOWNLOAD_TIMEOUT_MS);

    const finish = async (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(listener);
      if (error) return reject(error);
      try {
        const [item] = await chrome.downloads.search({ id: downloadId });
        resolve(item || { id: downloadId });
      } catch {
        resolve({ id: downloadId });
      }
    };

    const listener = (delta) => {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === 'complete') finish();
      else if (delta.state?.current === 'interrupted') finish(new Error(delta.error?.current || '下载中断'));
    };
    chrome.downloads.onChanged.addListener(listener);

    chrome.downloads.search({ id: downloadId }).then(([item]) => {
      if (item?.state === 'complete') finish();
      else if (item?.state === 'interrupted') finish(new Error(item.error || '下载中断'));
    }).catch(() => {});
  });
}

export async function downloadBytes(bytes, mime, relPath, { subfolder = '拾图素材' } = {}) {
  const filename = normalizeDownloadPath(`${subfolder}/${relPath}`);
  let url;
  let revoke = false;
  if (bytes.length < 2 * 1024 * 1024) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    url = `data:${mime || 'application/octet-stream'};base64,${btoa(binary)}`;
  } else {
    const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
    url = URL.createObjectURL(blob);
    revoke = true;
  }

  try {
    const downloadId = await chrome.downloads.download({
      url,
      filename,
      conflictAction: 'uniquify',
      saveAs: false
    });
    if (typeof downloadId !== 'number') throw new Error('浏览器未开始下载');
    const item = await waitForDownload(downloadId);
    return { downloadId, filename: item.filename || filename, bytes: item.fileSize || bytes.length };
  } finally {
    if (revoke) setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
}

export async function downloadText(text, mime, relPath, options) {
  const bytes = new TextEncoder().encode(text);
  return downloadBytes(bytes, mime, relPath, options);
}

export async function showDownload(downloadId) {
  try {
    await chrome.downloads.show(downloadId);
    return true;
  } catch {
    return false;
  }
}

export async function showDefaultFolder() {
  try {
    chrome.downloads.showDefaultFolder();
    return true;
  } catch {
    return false;
  }
}
