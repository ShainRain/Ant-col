const RESERVED = /[<>:"/\\|?*\u0000-\u001f]/g;
const ZERO_WIDTH = /[\u200b-\u200f\u202a-\u202e\ufeff]/g;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu;

export function sanitizeSegment(input, maxLen = 80) {
  let s = String(input ?? '')
    .replace(ZERO_WIDTH, '')
    .replace(EMOJI, '')
    .replace(RESERVED, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (!s) s = 'untitled';
  if (s.length > maxLen) s = s.slice(0, maxLen).trim();
  return s;
}

export function siteFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return '本地文件';
    let host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!host) return '网页';
    if (host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return 'local';
    const parts = host.split('.');
    if (parts.length >= 2) {
      const second = parts[parts.length - 2];
      const commonSecond = new Set(['com', 'co', 'net', 'org', 'gov', 'edu', 'ac']);
      if (commonSecond.has(second) && parts.length >= 3) {
        return parts[parts.length - 3].replace(/[^a-z0-9-]/g, '') || '网页';
      }
      return second.replace(/[^a-z0-9-]/g, '') || '网页';
    }
    return host.replace(/[^a-z0-9-]/g, '') || '网页';
  } catch {
    return '网页';
  }
}

function stripExt(name) {
  return String(name || '').replace(/\.(jpe?g|png|webp|gif|svg|avif|bmp|tiff?|mp4|webm|mov|m4v|ogg|mp3|wav|pdf)$/i, '');
}

export function slugFromUrl(url) {
  try {
    const u = new URL(url);
    let last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    last = stripExt(last);
    // 常见 CDN 的纯哈希文件名没有信息量
    if (/^[a-f0-9]{16,}$/i.test(last) || /^[0-9]{10,}$/.test(last)) return '';
    return sanitizeSegment(last, 48);
  } catch {
    return '';
  }
}

export function displayName({ title, alt, url, pageTitle, kind }) {
  const candidates = [title, alt, slugFromUrl(url), pageTitle];
  for (const c of candidates) {
    const s = sanitizeSegment(stripExt(c || ''), 56);
    if (s && s !== 'untitled') return s;
  }
  return kind === 'screenshot' ? '截图' : kind === 'link' ? '链接' : '素材';
}

export function timestampParts(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  return {
    date: `${y}${m}${d}`,
    time: `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
    month: `${y}-${m}`,
    display: `${y}-${m}-${d} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  };
}

export function makeBaseName({ date = new Date(), site = '', name = '', template = '{date}_{time}_{site}_{name}' }) {
  const t = timestampParts(date);
  const values = {
    date: t.date,
    time: t.time,
    site: sanitizeSegment(site, 24).replace(/\s+/g, '-'),
    name: sanitizeSegment(name, 56).replace(/\s+/g, '-'),
    month: t.month
  };
  let base = String(template || '{date}_{time}_{site}_{name}').replace(/\{(date|time|site|name|month)\}/g, (_, k) => values[k] || '');
  base = base.replace(RESERVED, ' ').replace(/\s+/g, '-').replace(/-{2,}/g, '-').replace(/^[-_]+|[-_]+$/g, '');
  if (!base) base = `${t.date}_${t.time}`;
  if (base.length > 110) base = base.slice(0, 110).replace(/[-_]+$/g, '');
  return base;
}

export function makeId() {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 7)).toUpperCase();
}

export function extFromMime(mime = '', url = '') {
  const m = String(mime).toLowerCase().split(';')[0].trim();
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
    'image/tiff': 'tif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/ogg': 'ogv',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'application/pdf': 'pdf'
  };
  if (map[m]) return map[m];
  const urlExt = (String(url).split('?')[0].match(/\.([a-z0-9]{2,5})$/i) || [])[1];
  if (urlExt) return urlExt.toLowerCase().replace('jpeg', 'jpg');
  if (m.startsWith('image/')) return m.slice(6).replace('+xml', '').replace('x-icon', 'ico') || 'png';
  if (m.startsWith('video/')) return m.slice(6) || 'mp4';
  return 'bin';
}

export function isImageExt(ext) {
  return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'avif', 'bmp', 'tif', 'tiff', 'ico'].includes(String(ext).toLowerCase());
}

export function humanBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function timeAgo(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  const d = new Date(ms);
  return `${d.getMonth() + 1}-${d.getDate()}`;
}
