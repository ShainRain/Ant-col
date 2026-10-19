import { FETCH_TIMEOUT_MS } from './config.js';

const MAX_BYTES = 220 * 1024 * 1024;

export class MediaError extends Error {
  constructor(message, code = 'FETCH_FAILED') {
    super(message);
    this.name = 'MediaError';
    this.code = code;
  }
}

export function isDataUrl(url) {
  return /^data:/i.test(String(url || ''));
}

export function isBlobUrl(url) {
  return /^blob:/i.test(String(url || ''));
}

export function decodeDataUrl(dataUrl) {
  const s = String(dataUrl || '');
  const comma = s.indexOf(',');
  if (comma < 0) throw new MediaError('无效的 data URL', 'INVALID_DATA_URL');
  const meta = s.slice(5, comma);
  const isBase64 = /;base64/i.test(meta);
  const mime = (meta.split(';')[0] || 'application/octet-stream').trim() || 'application/octet-stream';
  const payload = s.slice(comma + 1);
  let bytes;
  if (isBase64) {
    const bin = atob(payload.replace(/\s+/g, ''));
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(payload));
  }
  return { bytes, mime };
}

export async function fetchMedia(url, { pageUrl = '', useReferrer = true } = {}) {
  if (!url) throw new MediaError('缺少资源地址', 'NO_URL');
  if (isDataUrl(url)) {
    const { bytes, mime } = decodeDataUrl(url);
    return { bytes, mime, finalUrl: url };
  }
  if (isBlobUrl(url)) {
    throw new MediaError('blob 地址需要在页面内读取，请改用右键保存或截图', 'BLOB_URL');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const baseInit = {
    credentials: 'include',
    cache: 'force-cache',
    redirect: 'follow',
    signal: controller.signal,
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,audio/*,*/*;q=0.8'
    }
  };

  let response;
  try {
    if (useReferrer && /^https?:/i.test(pageUrl)) {
      try {
        response = await fetch(url, { ...baseInit, referrer: pageUrl, referrerPolicy: 'no-referrer-when-downgrade' });
      } catch {
        response = await fetch(url, baseInit);
      }
    } else {
      response = await fetch(url, baseInit);
    }
  } catch (err) {
    clearTimeout(timer);
    if (err?.name === 'AbortError') throw new MediaError('下载超时', 'TIMEOUT');
    throw new MediaError(`无法下载：${err?.message || err}`, 'FETCH_FAILED');
  }

  try {
    if (!response.ok) {
      throw new MediaError(`服务器返回 ${response.status}`, 'HTTP_ERROR');
    }
    const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (mime === 'text/html' || mime === 'application/json') {
      throw new MediaError('返回的是网页而不是素材（可能有防盗链）', 'NOT_MEDIA');
    }
    const blob = await response.blob();
    if (blob.size > MAX_BYTES) throw new MediaError('文件超过 220MB', 'TOO_LARGE');
    const buffer = await blob.arrayBuffer();
    return { bytes: new Uint8Array(buffer), mime: mime || blob.type || '', finalUrl: response.url || url };
  } finally {
    clearTimeout(timer);
  }
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getImageSize(bytes, mime = '') {
  try {
    const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size;
  } catch {
    // SVG 兜底解析
    if (String(mime).includes('svg') || /^\s*</.test(new TextDecoder().decode(bytes.slice(0, 200)))) {
      try {
        const text = new TextDecoder().decode(bytes.slice(0, 4096));
        const w = text.match(/\bwidth=["']?([\d.]+)/i);
        const h = text.match(/\bheight=["']?([\d.]+)/i);
        const vb = text.match(/viewBox=["']?\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/i);
        return {
          width: Math.round(Number(w?.[1] || vb?.[1] || 0)),
          height: Math.round(Number(h?.[1] || vb?.[2] || 0))
        };
      } catch { /* ignore */ }
    }
    return { width: 0, height: 0 };
  }
}

export async function resizeImage(bytes, mime, maxSide = 720, quality = 0.85) {
  try {
    const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    let output;
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, w, h);
      output = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    } else {
      bitmap.close?.();
      return null;
    }
    bitmap.close?.();
    const buffer = await output.arrayBuffer();
    return { bytes: new Uint8Array(buffer), mime: 'image/jpeg', width: w, height: h };
  } catch {
    return null;
  }
}

export async function cropImage(dataUrl, rect, dpr = 1) {
  const { bytes, mime } = decodeDataUrl(dataUrl);
  const blob = new Blob([bytes], { type: mime });
  const bitmap = await createImageBitmap(blob);
  const sx = Math.max(0, Math.round(rect.x * dpr));
  const sy = Math.max(0, Math.round(rect.y * dpr));
  const sw = Math.min(bitmap.width - sx, Math.round(rect.width * dpr));
  const sh = Math.min(bitmap.height - sy, Math.round(rect.height * dpr));
  if (sw <= 0 || sh <= 0) throw new MediaError('截取区域无效', 'BAD_RECT');
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close?.();
  const out = await canvas.convertToBlob({ type: 'image/png' });
  const buffer = await out.arrayBuffer();
  return { bytes: new Uint8Array(buffer), mime: 'image/png', width: sw, height: sh };
}

export async function dataUrlToBytes(dataUrl) {
  return decodeDataUrl(dataUrl).bytes;
}

export function bytesToDataUrl(bytes, mime = 'image/png') {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}
