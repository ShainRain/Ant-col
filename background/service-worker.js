import { APP_NAME, DEFAULT_SETTINGS } from './config.js';
import {
  appendIndex,
  clearIndex,
  getIndex,
  getSettings,
  getStats,
  getRootHandle,
  setSettings,
  updateIndexEntries
} from './store.js';
import { saveItems, sidecarFor } from './save.js';
import { captureVisible, captureFullPage, getActiveTab } from './screenshot.js';
import { bytesToDataUrl, cropImage, decodeDataUrl, getImageSize } from './media.js';
import { getWritableRoot, readIndexMirror, writeIndexMirror, writeText } from './fs-writer.js';
import { clearThumbs } from './thumb-store.js';
import { showDefaultFolder, showDownload } from './downloads-writer.js';

const MENU_ROOT = 'ant-col-root';
const MENU_PROJECT_LIMIT = 10;
const PROJECT_MENU_RE = /^save-(image|video|link|page)-to:(.+)$/;

function projectMenuId(kind, name) {
  return `save-${kind}-to:${encodeURIComponent(name)}`;
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await ensureDefaults();
  await createMenus();
  await refreshBadge();
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage().catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
  await createMenus();
  await refreshBadge();
});

async function ensureDefaults() {
  const settings = await getSettings();
  if (!settings.firstRunDone) {
    await setSettings({ ...DEFAULT_SETTINGS, firstRunDone: true });
  }
}

async function createMenus() {
  try { await chrome.contextMenus.removeAll(); } catch { /* ignore */ }
  const settings = await getSettings();
  const collections = [...new Set((settings.collections || [])
    .map((name) => String(name || '').trim())
    .filter(Boolean))].slice(0, MENU_PROJECT_LIMIT);

  chrome.contextMenus.create({ id: MENU_ROOT, title: 'Ant-col 蚁穴', contexts: ['all'] });
  chrome.contextMenus.create({ id: 'save-image', parentId: MENU_ROOT, title: '保存这张图片到素材库', contexts: ['image'] });
  chrome.contextMenus.create({ id: 'save-video', parentId: MENU_ROOT, title: '保存这个视频到素材库', contexts: ['video'] });
  chrome.contextMenus.create({ id: 'save-link', parentId: MENU_ROOT, title: '保存链接卡片', contexts: ['link'] });
  if (collections.length) {
    const groups = [
      ['image', '保存图片到项目', 'image'],
      ['video', '保存视频到项目', 'video'],
      ['link', '保存链接到项目', 'link'],
      ['page', '把本页存为链接卡片到项目', 'page']
    ];
    for (const [kind, title, context] of groups) {
      const parentId = `save-${kind}-project`;
      chrome.contextMenus.create({ id: parentId, parentId: MENU_ROOT, title, contexts: [context] });
      for (const name of collections) {
        chrome.contextMenus.create({
          id: projectMenuId(kind, name),
          parentId,
          title: name.length > 24 ? `${name.slice(0, 24)}…` : name,
          contexts: [context]
        });
      }
    }
  }
  chrome.contextMenus.create({ id: 'sep-1', parentId: MENU_ROOT, type: 'separator', contexts: ['page'] });
  chrome.contextMenus.create({ id: 'batch-save', parentId: MENU_ROOT, title: '批量保存本页图片…', contexts: ['page'] });
  chrome.contextMenus.create({ id: 'save-page-link', parentId: MENU_ROOT, title: '把本页保存为链接卡片', contexts: ['page'] });
  chrome.contextMenus.create({ id: 'screenshot-visible', parentId: MENU_ROOT, title: '保存可见区域截图', contexts: ['page'] });
  chrome.contextMenus.create({ id: 'screenshot-element', parentId: MENU_ROOT, title: '框选元素截图', contexts: ['page'] });
  chrome.contextMenus.create({ id: 'screenshot-full', parentId: MENU_ROOT, title: '保存整页截图', contexts: ['page'] });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id && !info.pageUrl) return;
  const pageUrl = info.pageUrl || tab?.url || '';
  const pageTitle = tab?.title || '';
  try {
    const projectMatch = PROJECT_MENU_RE.exec(String(info.menuItemId || ''));
    if (projectMatch) {
      const kind = projectMatch[1];
      const collection = decodeURIComponent(projectMatch[2] || '').trim();
      const base = { pageUrl, pageTitle, title: '', alt: '' };
      let item;
      if (kind === 'image' || kind === 'video') {
        item = { ...base, kind, url: info.srcUrl };
      } else if (kind === 'link') {
        item = { ...base, kind: 'link', url: info.linkUrl, linkUrl: info.linkUrl, title: info.selectionText || '' };
      } else {
        item = { ...base, kind: 'link', url: pageUrl, linkUrl: pageUrl, title: pageTitle };
      }
      const result = await saveItems([item], { tags: [], note: '', collection });
      await afterSave(result, tab);
      return;
    }
    if (info.menuItemId === 'save-image' || info.menuItemId === 'save-video') {
      const kind = info.menuItemId === 'save-image' ? 'image' : 'video';
      const result = await saveItems([{
        url: info.srcUrl,
        kind,
        pageUrl,
        pageTitle,
        title: '',
        alt: ''
      }], { tags: [], note: '' });
      await afterSave(result, tab);
    } else if (info.menuItemId === 'save-link') {
      const result = await saveItems([{
        kind: 'link',
        url: info.linkUrl,
        linkUrl: info.linkUrl,
        pageUrl,
        pageTitle,
        title: info.selectionText || ''
      }], { tags: [], note: '' });
      await afterSave(result, tab);
    } else if (info.menuItemId === 'save-page-link') {
      const result = await saveItems([{
        kind: 'link',
        url: pageUrl,
        linkUrl: pageUrl,
        pageUrl,
        pageTitle,
        title: pageTitle
      }], { tags: [], note: '' });
      await afterSave(result, tab);
    } else if (info.menuItemId === 'batch-save') {
      await openPopupOrNotify(tab);
    } else if (info.menuItemId === 'screenshot-visible') {
      await captureAndSave({ tab, mode: 'visible' });
    } else if (info.menuItemId === 'screenshot-full') {
      await captureAndSave({ tab, mode: 'full' });
    } else if (info.menuItemId === 'screenshot-element') {
      await startElementCapture(tab);
    }
  } catch (err) {
    await notifyTab(tab?.id, err?.message || '保存失败', 'error');
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const tab = await getActiveTab();
  try {
    if (command === 'save-hovered') {
      if (!tab) return;
      let item = null;
      try {
        item = await chrome.tabs.sendMessage(tab.id, { type: 'vv-get-hovered' });
      } catch { /* no content script */ }
      if (!item || !item.url) {
        await notifyTab(tab.id, '把鼠标移到图片或视频上，再按 Alt+S', 'info');
        return;
      }
      const result = await saveItems([{
        ...item,
        pageUrl: item.pageUrl || tab.url,
        pageTitle: item.pageTitle || tab.title
      }], { tags: [], note: '' });
      await afterSave(result, tab);
    } else if (command === 'screenshot-visible') {
      if (tab) await captureAndSave({ tab, mode: 'visible' });
    } else if (command === 'screenshot-element') {
      if (tab) await startElementCapture(tab);
    } else if (command === 'screenshot-full') {
      if (tab) await captureAndSave({ tab, mode: 'full' });
    } else if (command === 'save-page-images') {
      if (tab) await openPopupOrNotify(tab);
    }
  } catch (err) {
    await notifyTab(tab?.id, err?.message || '操作失败', 'error');
  }
});

async function openPopupOrNotify(tab) {
  try {
    await chrome.action.openPopup();
  } catch {
    await notifyTab(tab?.id, `点击工具栏上的「${APP_NAME}」图标，即可批量选择本页图片`, 'info');
  }
}

async function startElementCapture(tab) {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'vv-start-element-capture' });
  } catch {
    await notifyTab(tab.id, '当前页面无法框选（浏览器内部页面不支持）', 'error');
  }
}

async function captureAndSave({ tab, mode, rect, dpr = 1, dataUrl }) {
  const pageUrl = tab?.url || '';
  const pageTitle = tab?.title || '';
  let shot = dataUrl;
  let captureMode = mode;
  if (!shot) {
    if (mode === 'full') {
      try {
        shot = await captureFullPage(tab.id, 'png');
      } catch {
        shot = await captureVisible(tab.windowId, 'png');
        captureMode = 'visible-fallback';
      }
    } else {
      shot = await captureVisible(tab.windowId, 'png');
    }
  }
  if (mode === 'element' && rect) {
    const cropped = await cropImage(shot, rect, dpr);
    shot = bytesToDataUrl(cropped.bytes, 'image/png');
  }
  const { bytes } = decodeDataUrl(shot);
  const size = await getImageSize(bytes, 'image/png');
  const result = await saveItems([{
    kind: 'screenshot',
    dataUrl: shot,
    url: '',
    pageUrl,
    pageTitle,
    title: pageTitle || '截图',
    width: size.width,
    height: size.height,
    captureMode
  }], { tags: [], note: '' });
  await afterSave(result, tab);
  return result;
}

async function afterSave(result, tab) {
  await refreshBadge();
  const saved = result.items?.filter((r) => r.status === 'saved') || [];
  const duplicate = result.duplicate || 0;
  const error = result.error || 0;
  let text;
  if (saved.length === 1 && duplicate === 0 && error === 0) {
    const item = saved[0].item;
    text = `已保存「${item.name}」`;
    if (item.mode === 'downloads') text += ' 到下载文件夹';
  } else {
    text = `已保存 ${saved.length} 项`;
    if (duplicate) text += `，跳过 ${duplicate} 项重复`;
    if (error) text += `，${error} 项失败`;
  }
  await notifyTab(tab?.id, text, error ? 'error' : 'success');
}

async function notifyTab(tabId, text, tone = 'info') {
  if (tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'vv-toast', text, tone });
      return;
    } catch { /* fall through */ }
  }
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: APP_NAME,
      message: text
    });
  } catch { /* ignore */ }
}

async function refreshBadge() {
  try {
    const index = await getIndex();
    const count = index.filter((e) => (e.status || 'kept') === 'inbox').length;
    await chrome.action.setBadgeBackgroundColor({ color: '#ffffff' });
    await chrome.action.setBadgeText({ text: count > 0 ? String(Math.min(count, 99)) : '' });
  } catch { /* ignore */ }
}

async function buildState() {
  const [settings, index, stats, root] = await Promise.all([
    getSettings(),
    getIndex(),
    getStats(),
    getRootHandle()
  ]);
  let permission = 'none';
  if (root) {
    try {
      permission = typeof root.handle.queryPermission === 'function'
        ? await root.handle.queryPermission({ mode: 'readwrite' })
        : 'granted';
    } catch { permission = 'prompt'; }
  }
  const recent = [...index].sort((a, b) => (b.savedAtMs || 0) - (a.savedAtMs || 0)).slice(0, 40);
  const tags = new Map();
  for (const item of index.slice(-800)) {
    for (const tag of item.tags || []) tags.set(tag, (tags.get(tag) || 0) + 1);
  }
  const allTags = [...tags.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([name, count]) => ({ name, count }));
  return {
    settings,
    root: root ? { name: root.name, permission } : null,
    stats,
    recent,
    allTags,
    indexCount: index.length,
    inboxCount: index.filter((entry) => (entry.status || 'kept') === 'inbox').length
  };
}

function statusOf(item) {
  return ['inbox', 'kept', 'archived'].includes(item?.status) ? item.status : 'kept';
}

async function buildLibraryState() {
  const [settings, index, stats, root] = await Promise.all([
    getSettings(),
    getIndex(),
    getStats(),
    getRootHandle()
  ]);
  let permission = 'none';
  if (root) {
    try {
      permission = typeof root.handle.queryPermission === 'function'
        ? await root.handle.queryPermission({ mode: 'readwrite' })
        : 'granted';
    } catch { permission = 'prompt'; }
  }
  const defaultProject = settings.defaultCollection || settings.collections?.[0] || '灵感收集';
  const projectNames = [...(settings.collections || [])];
  for (const item of index) {
    if (item.collection && !projectNames.includes(item.collection)) projectNames.push(item.collection);
  }
  if (!projectNames.length) projectNames.push(defaultProject);

  const items = index.map((entry) => ({
    ...entry,
    status: statusOf(entry),
    collection: entry.collection || defaultProject
  }));
  const projectCounts = new Map(projectNames.map((name) => [name, 0]));
  const tagCounts = new Map();
  const statusCounts = { inbox: 0, kept: 0, archived: 0 };
  for (const item of items) {
    statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
    projectCounts.set(item.collection, (projectCounts.get(item.collection) || 0) + 1);
    for (const tag of item.tags || []) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
  }
  const projects = projectNames.map((name) => ({ name, count: projectCounts.get(name) || 0 }));
  const tags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
  return {
    settings,
    root: root ? { name: root.name, permission } : null,
    stats,
    items,
    projects,
    tags,
    inboxCount: statusCounts.inbox,
    statusCounts,
    defaultProject,
    indexCount: items.length
  };
}

async function updateItems(message) {
  const ids = [...new Set((message.ids || []).map((id) => String(id)).filter(Boolean))];
  if (!ids.length) return { ok: true, items: [] };
  const settings = await getSettings();
  const patch = {};
  if (['inbox', 'kept', 'archived'].includes(message.status)) {
    patch.status = message.status;
    patch.reviewedAt = Date.now();
  }
  if (typeof message.collection === 'string' && message.collection.trim()) {
    patch.collection = message.collection.trim().slice(0, 48);
  }
  if (typeof message.annotation === 'string') patch.annotation = message.annotation.slice(0, 2000);
  if (message.star !== undefined && message.star !== null && message.star !== '') {
    const star = Math.round(Number(message.star));
    if (Number.isFinite(star)) patch.star = Math.max(0, Math.min(5, star));
  }
  if (Array.isArray(message.tags)) {
    patch.tags = [...new Set(message.tags.map((t) => String(t).trim().slice(0, 48)).filter(Boolean))].slice(0, 24);
  }
  const addTags = Array.isArray(message.addTags)
    ? [...new Set(message.addTags.map((t) => String(t).trim().slice(0, 48)).filter(Boolean))]
    : [];

  const updated = await updateIndexEntries(ids, (entry) => {
    const next = { ...patch, updatedAt: Date.now() };
    if (addTags.length) next.tags = [...new Set([...(entry.tags || []), ...addTags])].slice(0, 24);
    if (!patch.status) next.reviewedAt = entry.reviewedAt || null;
    return next;
  });

  const root = await getWritableRoot();
  if (root?.permission === 'granted') {
    for (const entry of updated) {
      if (!ids.includes(entry.id) || entry.mode !== 'folder' || !entry.relativePath) continue;
      try {
        await writeText(root, entry.relativePath.replace(/\.[^.]+$/, '.json'), JSON.stringify(sidecarFor(entry), null, 2));
      } catch { /* sidecar 更新失败不阻塞 */ }
    }
    const mirrorEntries = updated.filter((entry) => entry.mode === 'folder');
    if (mirrorEntries.length) {
      try { await writeIndexMirror(root, mirrorEntries); } catch { /* ignore */ }
    }
  }
  await refreshBadge();
  return {
    ok: true,
    items: updated.filter((entry) => ids.includes(entry.id)),
    indexCount: updated.length,
    defaultProject: settings.defaultCollection || settings.collections?.[0] || '灵感收集'
  };
}

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportIndex(format = 'json') {
  const index = await getIndex();
  if (format === 'csv') {
    const header = ['id', 'name', 'kind', 'ext', 'width', 'height', 'size', 'star', 'site', 'tags', 'pageUrl', 'sourceUrl', 'savedAt', 'relativePath', 'mode'];
    const lines = [header.join(',')];
    for (const item of index) {
      lines.push([
        item.id, item.name, item.kind, item.ext, item.width, item.height, item.size, item.star || 0,
        item.site, (item.tags || []).join('|'), item.pageUrl, item.sourceUrl, item.savedAt,
        item.relativePath, item.mode
      ].map(csvEscape).join(','));
    }
    return { format, text: '\ufeff' + lines.join('\r\n'), count: index.length };
  }
  return { format: 'json', text: JSON.stringify(index, null, 2), count: index.length };
}

async function importFolderIndex() {
  const root = await getRootHandle();
  if (!root) return { imported: 0 };
  try {
    const list = await readIndexMirror(root);
    const valid = list.filter((e) => e && e.id && e.schema);
    if (valid.length) await appendIndex(valid);
    return { imported: valid.length };
  } catch {
    return { imported: 0 };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case 'state':
          return sendResponse(await buildState());
        case 'quick-state': {
          const s = await buildState();
          return sendResponse({
            settings: s.settings,
            root: s.root,
            allTags: s.allTags,
            collections: s.settings.collections || [],
            defaultCollection: s.settings.defaultCollection || '灵感收集'
          });
        }
        case 'add-collection': {
          const name = String(message.name || '').trim().slice(0, 40);
          if (!name) return sendResponse({ error: '名称不能为空' });
          const current = await getSettings();
          const list = [...new Set([...(current.collections || ['灵感收集']), name])].slice(0, 24);
          await setSettings({ collections: list });
          await createMenus();
          return sendResponse({ ok: true, collections: list });
        }
        case 'settings-changed':
          await createMenus();
          await refreshBadge();
          return sendResponse({ ok: true });
        case 'library-state':
          return sendResponse(await buildLibraryState());
        case 'update-items':
          return sendResponse(await updateItems(message));
        case 'open-library':
          await chrome.tabs.create({ url: chrome.runtime.getURL('library/library.html') });
          return sendResponse({ ok: true });
        case 'save':
          return sendResponse(await saveItems(message.items || [], message.meta || {}));
        case 'save-link':
          return sendResponse(await saveItems([{ ...message.item, kind: 'link' }], message.meta || {}));
        case 'save-screenshot':
          return sendResponse(await captureAndSaveMessage(message));
        case 'element-selected':
          return sendResponse(await handleElementSelected(message, sender));
        case 'open-options':
          await chrome.runtime.openOptionsPage();
          return sendResponse({ ok: true });
        case 'export-index':
          return sendResponse(await exportIndex(message.format));
        case 'clear-index':
          await clearIndex();
          await clearThumbs().catch(() => {});
          await refreshBadge();
          return sendResponse({ ok: true });
        case 'root-changed': {
          const imported = await importFolderIndex();
          await refreshBadge();
          return sendResponse({ ok: true, ...imported });
        }
        case 'reveal': {
          const item = message.item;
          let ok = false;
          if (item?.downloadId) ok = await showDownload(item.downloadId);
          if (!ok && item?.mode === 'downloads') ok = await showDefaultFolder();
          return sendResponse({ ok, path: item?.absolutePath || item?.relativePath || '' });
        }
        case 'show-default-folder':
          return sendResponse({ ok: await showDefaultFolder() });
        case 'stats':
          return sendResponse(await getStats());
        case 'ping':
          return sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
        default:
          return sendResponse({ error: 'unknown message' });
      }
    } catch (err) {
      sendResponse({ error: err?.message || String(err), code: err?.code || '', name: err?.name || '' });
    }
  })();
  return true;
});

async function captureAndSaveMessage(message) {
  const tab = message.tabId ? await chrome.tabs.get(message.tabId) : await getActiveTab();
  if (!tab) throw new Error('找不到当前标签页');
  return captureAndSave({
    tab,
    mode: message.mode || 'visible',
    rect: message.rect,
    dpr: message.dpr,
    dataUrl: message.dataUrl
  });
}

async function handleElementSelected(message, sender) {
  const tab = await chrome.tabs.get(sender.tab.id);
  return captureAndSave({
    tab,
    mode: 'element',
    rect: message.rect,
    dpr: message.dpr || 1
  });
}
