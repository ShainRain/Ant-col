import { DEFAULT_SETTINGS } from './config.js';

const DB_NAME = 'shitu-vault-db';
const DB_VERSION = 1;
const STORE = 'kv';
const ROOT_KEY = 'rootHandle';
const SETTINGS_KEY = 'settings';
const INDEX_KEY = 'index';
const STATS_KEY = 'stats';
const MAX_INDEX = 8000;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDel(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- settings ----------

export async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
}

export async function setSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

// ---------- index ----------

let indexWriteChain = Promise.resolve();

export async function getIndex() {
  const stored = await chrome.storage.local.get(INDEX_KEY);
  return Array.isArray(stored[INDEX_KEY]) ? stored[INDEX_KEY] : [];
}

export function appendIndex(entries) {
  const run = async () => {
    const current = await getIndex();
    const byId = new Map(current.map((e) => [e.id, e]));
    const fresh = [];
    for (const entry of entries) {
      if (!entry || !entry.id) continue;
      if (!byId.has(entry.id)) fresh.push(entry);
      byId.set(entry.id, entry);
    }
    let merged = [...byId.values()].sort((a, b) => (a.savedAtMs || 0) - (b.savedAtMs || 0));
    if (merged.length > MAX_INDEX) merged = merged.slice(merged.length - MAX_INDEX);
    await chrome.storage.local.set({ [INDEX_KEY]: merged });
    if (fresh.length) await bumpStats(fresh);
    return merged;
  };
  indexWriteChain = indexWriteChain.then(run, run);
  return indexWriteChain;
}

export async function updateIndexEntry(id, patch) {
  return updateIndexEntries([id], () => patch);
}

export async function updateIndexEntries(ids, updater) {
  const wanted = new Set(ids || []);
  const run = async () => {
    const current = await getIndex();
    const next = current.map((entry) => {
      if (!wanted.has(entry.id)) return entry;
      const patch = typeof updater === 'function' ? updater(entry) : updater;
      return { ...entry, ...(patch || {}) };
    });
    await chrome.storage.local.set({ [INDEX_KEY]: next });
    return next;
  };
  indexWriteChain = indexWriteChain.then(run, run);
  return indexWriteChain;
}

export async function clearIndex() {
  await chrome.storage.local.set({ [INDEX_KEY]: [], [STATS_KEY]: emptyStats() });
}

export function emptyStats() {
  return { count: 0, totalBytes: 0, todayCount: 0, todayDate: '', lastSavedAt: 0 };
}

function localDayKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export async function getStats() {
  const stored = await chrome.storage.local.get(STATS_KEY);
  const stats = { ...emptyStats(), ...(stored[STATS_KEY] || {}) };
  const today = localDayKey();
  if (stats.todayDate !== today) {
    stats.todayDate = today;
    stats.todayCount = 0;
    await chrome.storage.local.set({ [STATS_KEY]: stats });
  }
  return stats;
}

async function bumpStats(entries) {
  const stats = await getStats();
  const today = localDayKey();
  if (stats.todayDate !== today) { stats.todayDate = today; stats.todayCount = 0; }
  stats.count += entries.length;
  stats.totalBytes += entries.reduce((sum, e) => sum + (e.size || 0), 0);
  stats.todayCount += entries.filter((e) => localDayKey(new Date(e.savedAtMs || Date.now())) === today).length;
  stats.lastSavedAt = Date.now();
  await chrome.storage.local.set({ [STATS_KEY]: stats });
}

// ---------- directory handle ----------

export async function getRootHandle() {
  const root = await idbGet(ROOT_KEY);
  if (!root || !root.handle) return null;
  return root;
}

export async function setRootHandle(handle, name) {
  await idbSet(ROOT_KEY, { handle, name: name || handle.name || '素材库', selectedAt: Date.now() });
}

export async function clearRootHandle() {
  await idbDel(ROOT_KEY);
}

export async function canWriteRoot(root) {
  if (!root || !root.handle) return false;
  try {
    if (typeof root.handle.queryPermission !== 'function') return true;
    const state = await root.handle.queryPermission({ mode: 'readwrite' });
    return state === 'granted';
  } catch {
    return false;
  }
}
