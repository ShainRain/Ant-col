import {
  getSettings,
  setSettings,
  getRootHandle,
  setRootHandle,
  clearRootHandle,
  getStats,
  getIndex
} from '../background/store.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let settings = null;
let root = null;
let saveTimer = null;

function toast(text, tone = '') {
  const el = $('#toast');
  el.textContent = text;
  el.className = `toast show ${tone}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => el.classList.remove('show'), 2600);
}

function humanBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

async function refresh() {
  settings = await getSettings();
  root = await getRootHandle();
  const stats = await getStats();
  const index = await getIndex();
  $('#statCount').textContent = stats.count || index.length || 0;
  $('#statSize').textContent = humanBytes(stats.totalBytes || index.reduce((s, i) => s + (i.size || 0), 0));
  $('#statToday').textContent = stats.todayCount || 0;
  $('#indexInfo').textContent = `浏览器本地索引 ${index.length} 条${index.length ? `，最近保存 ${index[index.length - 1]?.savedDisplay || ''}` : ''}。素材文件与 JSON 元数据在保存目录中。`;
  renderSettings();
  renderFolder();
}

function renderSettings() {
  for (const radio of $$('input[name="targetMode"]')) {
    radio.checked = radio.value === settings.targetMode;
  }
  $('#downloadsSubfolder').value = settings.downloadsSubfolder || '';
  $('#filenameTemplate').value = settings.filenameTemplate || '';
  $('#collectionsInput').value = (settings.collections || []).join('，');
  $('#minImageSize').value = String(settings.minImageSize ?? 200);
  $('#screenshotFormat').value = settings.screenshotFormat || 'png';
  $('#dedupe').checked = settings.dedupe !== false;
  $('#saveSidecar').checked = settings.saveSidecar !== false;
  $('#autoTags').checked = settings.autoTags !== false;
  $('#includeBackgroundImages').checked = settings.includeBackgroundImages !== false;
  $('#useReferrer').checked = settings.useReferrer !== false;
}

async function renderFolder() {
  const name = $('#folderName');
  const status = $('#folderStatus');
  const choose = $('#chooseFolder');
  const reauth = $('#reauthorize');
  const clear = $('#clearFolder');
  const panel = $('#folderPanel');
  panel.classList.toggle('muted', settings?.targetMode === 'downloads');

  if (!root) {
    name.textContent = '尚未选择文件夹';
    status.textContent = `默认：下载文件夹 / ${settings.downloadsSubfolder || 'Ant-col素材'}`;
    choose.textContent = '选择文件夹…';
    reauth.hidden = true;
    clear.hidden = true;
    return;
  }

  let permission = 'granted';
  try {
    permission = typeof root.handle.queryPermission === 'function'
      ? await root.handle.queryPermission({ mode: 'readwrite' })
      : 'granted';
  } catch { permission = 'prompt'; }

  name.textContent = root.name || root.handle.name || '素材库';
  if (permission === 'granted') {
    status.textContent = `已授权写入 · ${root.name || ''}`;
    choose.textContent = '更换文件夹…';
    reauth.hidden = true;
  } else {
    status.textContent = '需要重新授权（浏览器重启后常见）';
    choose.textContent = '更换文件夹…';
    reauth.hidden = false;
  }
  clear.hidden = false;
  if (settings?.targetMode === 'downloads') {
    status.textContent = '当前模式仅使用下载目录；选择文件夹会自动切换到「自动」';
  }
}

async function save(patch, message = '已保存') {
  settings = await setSettings(patch);
  if (message) toast(message);
}

function debounceSave(patch) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(patch, ''), 450);
}

function parseCollections(text) {
  let list = String(text || '')
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  list = [...new Set(list)].slice(0, 24);
  if (!list.length) list = ['灵感收集'];
  return {
    collections: list,
    defaultCollection: list.includes('灵感收集') ? '灵感收集' : list[0]
  };
}

async function chooseFolder() {
  try {
    let handle;
    try {
      handle = await window.showDirectoryPicker({ id: 'ant-col', mode: 'readwrite', startIn: 'pictures' });
    } catch (err) {
      if (err?.name === 'AbortError') return;
      handle = await window.showDirectoryPicker({ id: 'ant-col', mode: 'readwrite' });
    }
    const permission = await handle.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      toast('没有获得写入权限', 'error');
      return;
    }
    await setRootHandle(handle, handle.name);
    settings = await setSettings({ targetMode: settings.targetMode === 'downloads' ? 'auto' : settings.targetMode });
    await chrome.runtime.sendMessage({ type: 'root-changed' }).catch(() => {});
    await refresh();
    toast(`已选择「${handle.name}」`);
  } catch (err) {
    if (err?.name !== 'AbortError') toast(err?.message || '选择文件夹失败', 'error');
  }
}

async function reauthorize() {
  if (!root?.handle) return;
  try {
    const permission = await root.handle.requestPermission({ mode: 'readwrite' });
    if (permission === 'granted') {
      await chrome.runtime.sendMessage({ type: 'root-changed' }).catch(() => {});
      await refresh();
      toast('已重新授权');
    } else {
      toast('仍未获得权限', 'error');
    }
  } catch (err) {
    toast(err?.message || '授权失败', 'error');
  }
}

async function clearFolder() {
  if (!confirm('移除素材库文件夹？已保存的文件不会被删除。')) return;
  await clearRootHandle();
  await setSettings({ targetMode: 'downloads' });
  await refresh();
  toast('已移除文件夹，之后保存到下载目录');
}

async function downloadExport(format) {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'export-index', format });
    if (!res || res.error) throw new Error(res?.error || '导出失败');
    const mime = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
    const blob = new Blob([res.text], { type: mime });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    try {
      await chrome.downloads.download({
        url,
        filename: `Ant-col索引-${stamp}.${format === 'csv' ? 'csv' : 'json'}`,
        saveAs: true
      });
      toast(`已导出 ${res.count} 条索引`);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  } catch (err) {
    toast(err?.message || '导出失败', 'error');
  }
}

function bind() {
  for (const radio of $$('input[name="targetMode"]')) {
    radio.addEventListener('change', async () => {
      if (radio.checked) {
        await save({ targetMode: radio.value });
        await renderFolder();
      }
    });
  }
  $('#downloadsSubfolder').addEventListener('input', (e) => debounceSave({ downloadsSubfolder: e.target.value.trim() || 'Ant-col素材' }));
  $('#filenameTemplate').addEventListener('input', (e) => debounceSave({ filenameTemplate: e.target.value.trim() || '{date}_{time}_{site}_{name}' }));
  $('#collectionsInput').addEventListener('input', (e) => debounceSave(parseCollections(e.target.value)));
  $('#minImageSize').addEventListener('change', (e) => save({ minImageSize: Number(e.target.value) || 0 }, ''));
  $('#screenshotFormat').addEventListener('change', (e) => save({ screenshotFormat: e.target.value }, ''));
  $('#dedupe').addEventListener('change', (e) => save({ dedupe: e.target.checked }, ''));
  $('#saveSidecar').addEventListener('change', (e) => save({ saveSidecar: e.target.checked }, ''));
  $('#autoTags').addEventListener('change', (e) => save({ autoTags: e.target.checked }, ''));
  $('#includeBackgroundImages').addEventListener('change', (e) => save({ includeBackgroundImages: e.target.checked }, ''));
  $('#useReferrer').addEventListener('change', (e) => save({ useReferrer: e.target.checked }, ''));
  $('#openLibrary').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'open-library' }).catch(() => {}));
  $('#chooseFolder').addEventListener('click', chooseFolder);
  $('#reauthorize').addEventListener('click', reauthorize);
  $('#clearFolder').addEventListener('click', clearFolder);
  $('#exportJson').addEventListener('click', () => downloadExport('json'));
  $('#exportCsv').addEventListener('click', () => downloadExport('csv'));
  $('#openDownloads').addEventListener('click', async () => {
    const res = await chrome.runtime.sendMessage({ type: 'show-default-folder' });
    if (!res?.ok) toast('无法打开下载文件夹');
  });
  $('#clearIndex').addEventListener('click', async () => {
    if (!confirm('清空浏览器本地索引？已保存的素材文件不会被删除，但素材库和回看记录会消失。')) return;
    await chrome.runtime.sendMessage({ type: 'clear-index' });
    await refresh();
    toast('本地索引已清空');
  });
}

(async function init() {
  bind();
  try {
    await refresh();
  } catch (err) {
    toast(err?.message || '读取设置失败', 'error');
  }
})();
