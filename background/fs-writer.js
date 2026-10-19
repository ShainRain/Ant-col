import { canWriteRoot, getRootHandle } from './store.js';

const INDEX_FILE = '_index.json';

export async function getWritableRoot() {
  const root = await getRootHandle();
  if (!root) return null;
  if (!(await canWriteRoot(root))) return { ...root, permission: 'prompt' };
  return { ...root, permission: 'granted' };
}

function splitPath(relPath) {
  return String(relPath).replace(/\\/g, '/').split('/').filter(Boolean);
}

async function getDir(root, parts, create = true) {
  let dir = root.handle;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

async function fileExists(dir, name) {
  try {
    await dir.getFileHandle(name, { create: false });
    return true;
  } catch {
    return false;
  }
}

export async function ensureUniqueName(dir, base, ext) {
  let name = `${base}.${ext}`;
  let i = 2;
  while (await fileExists(dir, name)) {
    name = `${base}-${i}.${ext}`;
    i++;
    if (i > 999) break;
  }
  return name;
}

export async function writeBytes(root, relPath, bytes, mime = '') {
  const parts = splitPath(relPath);
  const fileName = parts.pop();
  const dir = await getDir(root, parts, true);
  const handle = await dir.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime || 'application/octet-stream' });
  await writable.write(blob);
  await writable.close();
  return relPath;
}

export async function writeText(root, relPath, text, mime = 'application/json') {
  return writeBytes(root, relPath, new TextEncoder().encode(text), mime);
}

export async function readText(root, relPath) {
  const parts = splitPath(relPath);
  const fileName = parts.pop();
  try {
    const dir = await getDir(root, parts, false);
    const handle = await dir.getFileHandle(fileName, { create: false });
    const file = await handle.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

export async function readIndexMirror(root) {
  const text = await readText(root, INDEX_FILE);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let mirrorChain = Promise.resolve();

export function appendIndexMirror(root, entry) {
  const run = async () => {
    const existing = await readIndexMirror(root);
    const byId = new Map(existing.map((e) => [e.id, e]));
    byId.set(entry.id, entry);
    const list = [...byId.values()].sort((a, b) => (a.savedAtMs || 0) - (b.savedAtMs || 0));
    await writeText(root, INDEX_FILE, JSON.stringify(list, null, 2));
  };
  mirrorChain = mirrorChain.then(run, run);
  return mirrorChain;
}

export function writeIndexMirror(root, entries) {
  const run = async () => {
    const list = [...entries].sort((a, b) => (a.savedAtMs || 0) - (b.savedAtMs || 0));
    await writeText(root, INDEX_FILE, JSON.stringify(list, null, 2));
  };
  mirrorChain = mirrorChain.then(run, run);
  return mirrorChain;
}

export async function writeItemFiles(root, { relPath, base, ext, bytes }) {
  const parts = splitPath(relPath);
  const fileName = parts.pop();
  const dir = await getDir(root, parts, true);
  const uniqueName = await ensureUniqueName(dir, base, ext);
  const finalRel = [...parts, uniqueName].join('/');
  await writeBytes(root, finalRel, bytes);
  return finalRel;
}

export async function fileCountHint(root) {
  try {
    let count = 0;
    for await (const [name, handle] of root.handle.entries()) {
      if (handle.kind === 'directory') count++;
    }
    return count;
  } catch {
    return 0;
  }
}
