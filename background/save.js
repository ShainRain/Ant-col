import { KIND_FOLDER, SCHEMA } from './config.js';
import { appendIndex, getIndex, getSettings } from './store.js';
import {
  extFromMime,
  displayName,
  makeBaseName,
  makeId,
  sanitizeSegment,
  siteFromUrl,
  timestampParts
} from './naming.js';
import { decodeDataUrl, fetchMedia, getImageSize, resizeImage, sha256Hex } from './media.js';
import { getWritableRoot, appendIndexMirror, writeItemFiles, writeText } from './fs-writer.js';
import { downloadBytes, downloadText } from './downloads-writer.js';
import { putThumb } from './thumb-store.js';
import { enlargeUrl, fallbackUrls } from './url-rules.js';

export class TargetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TargetError';
  }
}

export async function resolveTarget(settings) {
  const root = await getWritableRoot();
  const folderReady = root && root.permission === 'granted';
  if (settings.targetMode === 'folder') {
    if (!root) throw new TargetError('还没有选择素材库文件夹，请到设置里选择');
    if (!folderReady) throw new TargetError('素材库文件夹授权已失效，请到设置里重新授权');
    return { mode: 'folder', root, subfolder: settings.downloadsSubfolder };
  }
  if (settings.targetMode === 'auto' && folderReady) {
    return { mode: 'folder', root, subfolder: settings.downloadsSubfolder };
  }
  return { mode: 'downloads', root: null, subfolder: settings.downloadsSubfolder };
}

function resolveCollection(settings, raw) {
  const list = Array.isArray(settings.collections) && settings.collections.length
    ? settings.collections
    : ['灵感收集'];
  const defaultName = settings.defaultCollection || list[0] || '灵感收集';
  let name = String(raw || defaultName).trim() || defaultName;
  if (!list.includes(name)) name = defaultName;
  const isDefault = name === defaultName;
  const path = isDefault ? '' : sanitizeSegment(name, 40).replace(/[\\/]+/g, '-');
  return { name, path, isDefault };
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string') return tags.split(/[,，\s]+/).filter(Boolean);
  return [];
}

function collectTags(settings, item, extraTags = [], collection = null) {
  const tags = new Set();
  for (const t of normalizeTags(extraTags)) {
    const s = String(t || '').trim();
    if (s) tags.add(s.slice(0, 48));
  }
  if (settings.autoTags) {
    const site = siteFromUrl(item.pageUrl || item.url || '');
    if (site) tags.add(site);
    if (item.kind === 'screenshot') tags.add('截图');
    if (item.kind === 'video') tags.add('视频');
    if (collection && !collection.isDefault) tags.add(collection.name.slice(0, 48));
  }
  return [...tags];
}

function clampStar(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5, n));
}

function buildRecord({ item, bytes, mime, ext, width, height, sha, settings, meta, relPath, id, collection }) {
  const now = new Date();
  const t = timestampParts(now);
  const site = siteFromUrl(item.pageUrl || item.url || '');
  const name = displayName({
    title: item.title,
    alt: item.alt,
    url: item.url,
    pageTitle: item.pageTitle,
    kind: item.kind
  });
  const tags = collectTags(settings, item, meta.tags, collection);
  const annotation = meta.note || item.annotation || '';
  const pageUrl = item.pageUrl || '';
  const sourceUrl = item.url || item.sourceUrl || '';
  const record = {
    schema: SCHEMA,
    id,
    kind: item.kind,
    name,
    ext,
    mime,
    size: bytes?.length || 0,
    width: width || 0,
    height: height || 0,
    sha256: sha || '',
    sourceUrl,
    pageUrl,
    pageTitle: item.pageTitle || '',
    site,
    collection: collection?.name || '',
    collectionPath: collection?.path || '',
    tags,
    annotation,
    star: clampStar(meta.star ?? item.star ?? 0),
    status: meta.status || 'inbox',
    reviewedAt: null,
    savedAt: now.toISOString(),
    savedAtMs: now.getTime(),
    savedDisplay: t.display,
    relativePath: relPath,
    mode: '',
    absolutePath: '',
    downloadId: null
  };
  if (item.kind === 'screenshot') record.captureMode = item.captureMode || 'visible';
  if (item.kind === 'link') record.linkUrl = item.linkUrl || sourceUrl;
  return record;
}

export function sidecarFor(record) {
  return {
    schema: SCHEMA,
    id: record.id,
    kind: record.kind,
    name: record.name,
    ext: record.ext,
    mime: record.mime,
    size: record.size,
    width: record.width,
    height: record.height,
    sha256: record.sha256,
    sourceUrl: record.sourceUrl,
    pageUrl: record.pageUrl,
    pageTitle: record.pageTitle,
    site: record.site,
    collection: record.collection,
    collectionPath: record.collectionPath,
    tags: record.tags,
    annotation: record.annotation,
    star: record.star || 0,
    status: record.status,
    reviewedAt: record.reviewedAt,
    savedAt: record.savedAt,
    relativePath: record.relativePath,
    captureMode: record.captureMode
  };
}

async function writeRecord(target, record, bytes, settings) {
  const fileName = record.relativePath.split('/').pop();
  const base = fileName.replace(/\.[^.]+$/, '');
  if (target.mode === 'folder') {
    const finalRel = await writeItemFiles(target.root, {
      relPath: record.relativePath,
      base,
      ext: record.ext,
      bytes
    });
    record.relativePath = finalRel;
    record.mode = 'folder';
    record.absolutePath = `${target.root.name}/${finalRel}`;
    if (settings.saveSidecar) {
      await writeText(target.root, finalRel.replace(/\.[^.]+$/, '.json'), JSON.stringify(sidecarFor(record), null, 2));
    }
    return record;
  }

  // 下载目录模式
  const desiredRel = record.relativePath;
  const result = await downloadBytes(bytes, record.mime, desiredRel, { subfolder: target.subfolder });
  record.mode = 'downloads';
  record.downloadId = result.downloadId;
  record.absolutePath = result.filename || desiredRel;
  record.relativePath = desiredRel;
  if (settings.saveSidecar) {
    try {
      const sidecarRel = desiredRel.replace(/\.[^.]+$/, '.json');
      await downloadText(JSON.stringify(sidecarFor(record), null, 2), 'application/json', sidecarRel, {
        subfolder: target.subfolder
      });
    } catch { /* sidecar 失败不影响主文件 */ }
  }
  return record;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function linkCardHtml({ title, linkUrl, pageTitle, note }) {
  const allowed = /^(https?:|file:|mailto:)/i.test(String(linkUrl || ''));
  const safeUrl = escapeHtml(allowed ? linkUrl : '#');
  const shownUrl = escapeHtml(linkUrl);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
    font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    background:#ffffff; color:#08090a; }
  main { width:min(620px, calc(100% - 48px)); background:#ffffff; border:1px solid #08090a1f;
    border-radius:8px; padding:34px 36px; }
  .eyebrow { margin:0 0 10px; font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:#08090a; }
  h1 { margin:0 0 12px; font-size:24px; line-height:1.25; letter-spacing:-.02em; }
  .url { margin:0 0 18px; font-size:12px; color:#a4aaad; word-break:break-all; }
  .note { margin:0 0 18px; font-size:14px; line-height:1.65; white-space:pre-wrap; }
  .meta { margin:0 0 22px; font-size:11px; color:#a4aaad; }
  a { display:inline-flex; padding:10px 16px; border-radius:10px; background:#08090a; color:#ffffff;
    text-decoration:none; font-size:13px; font-weight:600; }
  @media (prefers-color-scheme: dark) {
    body { background:#08090a; color:#f7f9f9; }
    main { background:#111315; border-color:#ffffff24; }
    .url, .meta { color:#a4aaad; }
    a { background:#08090a; color:#ffffff; }
  }
</style>
</head>
<body>
<main>
  <p class="eyebrow">Ant-col 蚁穴 · 链接收藏</p>
  <h1>${escapeHtml(title)}</h1>
  <p class="url">${shownUrl}</p>
  ${note ? `<p class="note">${escapeHtml(note)}</p>` : ''}
  <p class="meta">来源页：${escapeHtml(pageTitle || '')}</p>
  <a href="${safeUrl}">打开链接</a>
</main>
</body>
</html>`;
}

async function saveOne(item, meta, settings, target, knownHashes, knownLinks, collection) {
  const id = makeId();
  let bytes;
  let mime = item.mime || '';
  let width = Number(item.width) || 0;
  let height = Number(item.height) || 0;
  let ext = item.ext || '';
  let sourceUrl = item.url || item.sourceUrl || '';

  if (item.kind === 'screenshot') {
    if (!item.dataUrl) throw new Error('缺少截图数据');
    const { bytes: shot, mime: shotMime } = decodeDataUrl(item.dataUrl);
    bytes = shot;
    mime = shotMime || 'image/png';
    ext = 'png';
    if (settings.screenshotFormat === 'jpg') {
      const converted = await resizeImage(bytes, mime, 100000, (settings.screenshotQuality || 92) / 100);
      if (converted) {
        bytes = converted.bytes;
        mime = 'image/jpeg';
        ext = 'jpg';
      }
    }
    if (!width || !height) {
      const size = await getImageSize(bytes, mime);
      width = size.width; height = size.height;
    }
  } else if (item.kind === 'link') {
    const linkUrl = item.linkUrl || item.url;
    const title = item.title || item.pageTitle || linkUrl;
    bytes = new TextEncoder().encode(linkCardHtml({ title, linkUrl, pageTitle: item.pageTitle, note: meta.note }));
    mime = 'text/html';
    ext = 'html';
    sourceUrl = linkUrl;
  } else {
    // v1.3：命中站点规则时先换原图（失败/无命中保持原 URL）
    let fetchUrl = sourceUrl;
    const enlarged = enlargeUrl(fetchUrl);
    if (enlarged.hit && enlarged.url && enlarged.url !== fetchUrl) {
      item.enlargedFrom = fetchUrl;
      fetchUrl = enlarged.url;
    }
    const fetchOptions = { pageUrl: item.pageUrl || '', useReferrer: settings.useReferrer };
    let fetched;
    try {
      fetched = await fetchMedia(fetchUrl, fetchOptions);
    } catch (err) {
      // 主 CDN 失败时尝试备用 CDN（例如小红书 sns-img-hw → sns-img-bd）
      const backups = fallbackUrls(fetchUrl);
      let lastError = err;
      for (const backup of backups) {
        try {
          fetched = await fetchMedia(backup, fetchOptions);
          item.enlargedFrom = fetchUrl;
          fetchUrl = backup;
          lastError = null;
          break;
        } catch (backupError) {
          lastError = backupError;
        }
      }
      if (!fetched) throw lastError;
    }
    bytes = fetched.bytes;
    mime = mime || fetched.mime;
    if (!ext) ext = extFromMime(mime, sourceUrl);
    if (!width || !height) {
      const size = await getImageSize(bytes, mime);
      width = size.width; height = size.height;
    }
  }

  const sha = await sha256Hex(bytes);
  const dedupeKey = `${sha}::${collection?.path || ''}`;
  if (settings.dedupe) {
    if (item.kind === 'link') {
      const key = `${(item.linkUrl || item.url || '').trim()}::${collection?.path || ''}`;
      if (knownLinks.has(key)) return { status: 'duplicate', existing: knownLinks.get(key) };
    } else if (knownHashes.has(dedupeKey)) {
      return { status: 'duplicate', existing: knownHashes.get(dedupeKey) };
    }
  }

  const site = siteFromUrl(item.pageUrl || sourceUrl);
  const name = displayName({
    title: item.title,
    alt: item.alt,
    url: sourceUrl,
    pageTitle: item.pageTitle,
    kind: item.kind
  });
  const base = makeBaseName({ date: new Date(), site, name, template: settings.filenameTemplate });
  const folder = KIND_FOLDER[item.kind] || KIND_FOLDER.file;
  const t = timestampParts(new Date());
  const prefix = collection?.path ? `${collection.path}/` : '';
  const relPath = `${prefix}${folder}/${t.month}/${base}.${ext}`;
  const record = buildRecord({ item, bytes, mime, ext, width, height, sha, settings, meta, relPath, id, collection });

  const written = await writeRecord(target, record, bytes, settings);
  if (target.mode === 'folder') {
    await appendIndexMirror(target.root, written);
  }
  await appendIndex([written]);

  if (String(mime).startsWith('image/')) {
    try {
      const thumb = await resizeImage(bytes, mime, 360, 0.74);
      if (thumb) await putThumb(id, thumb.bytes, 'image/jpeg');
      else if (bytes.length < 1.5 * 1024 * 1024) await putThumb(id, bytes, mime);
    } catch { /* 缩略图失败不影响保存 */ }
  }

  if (settings.dedupe) {
    if (item.kind === 'link') {
      knownLinks.set(`${(item.linkUrl || item.url || '').trim()}::${collection?.path || ''}`, written);
    } else {
      knownHashes.set(dedupeKey, written);
    }
  }

  return { status: 'saved', item: written };
}

export async function saveItems(rawItems, meta = {}) {
  const settings = await getSettings();
  const collection = resolveCollection(settings, meta.collection);
  const target = await resolveTarget(settings);
  const index = await getIndex();
  const knownHashes = new Map(index.filter((e) => e.sha256).map((e) => [`${e.sha256}::${e.collectionPath || ''}`, e]));
  const knownLinks = new Map(index.filter((e) => e.kind === 'link').map((e) => [`${e.linkUrl || e.sourceUrl}::${e.collectionPath || ''}`, e]));
  const results = [];
  let done = 0;
  const total = rawItems.length;
  const concurrency = Math.min(3, Math.max(1, total));

  const queue = rawItems.slice();
  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      try {
        const result = await saveOne(item, meta, settings, target, knownHashes, knownLinks, collection);
        results.push(result);
      } catch (err) {
        results.push({ status: 'error', item, error: err?.message || String(err), code: err?.code || '' });
      }
      done++;
      try {
        chrome.runtime.sendMessage({ type: 'save-progress', done, total, last: results[results.length - 1] }).catch(() => {});
      } catch { /* popup 可能已关闭 */ }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return {
    total,
    saved: results.filter((r) => r.status === 'saved').length,
    duplicate: results.filter((r) => r.status === 'duplicate').length,
    error: results.filter((r) => r.status === 'error').length,
    mode: target.mode,
    collection: collection.name,
    items: results
  };
}
