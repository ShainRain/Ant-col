import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ext = path.resolve(__dirname, '..');
const fixture = path.join(__dirname, 'fixture');
const out = path.join(__dirname, 'out');
const downloads = path.join(out, 'downloads');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(downloads, { recursive: true });

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-col-e2e-'));
fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
fs.writeFileSync(path.join(profile, 'Default', 'Preferences'), JSON.stringify({
  download: { default_directory: downloads, prompt_for_download: false, directory_upgrade: true }
}));
let edgePid = null;
const PORT = 8765;
const CDP_PORT = 9777;

const log = (...args) => console.log('[e2e]', ...args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mime = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.css': 'text/css', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let p = path.join(fixture, decodeURIComponent(url.pathname));
  if (url.pathname === '/') p = path.join(fixture, 'index.html');
  if (!p.startsWith(fixture) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': mime[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(p).pipe(res);
});

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg);
        this.pending.delete(msg.id);
      } else if (msg.method) {
        this.events.push(msg);
      }
    };
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

const fetchJson = async (url) => (await fetch(url)).json();

async function connectTarget(target) {
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable').catch(() => {});
  return cdp;
}

async function evalIn(cdp, expression, awaitPromise = true) {
  const res = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true });
  if (res.result?.exceptionDetails) {
    const d = res.result.exceptionDetails;
    throw new Error(d.exception?.description || d.text || 'evaluation failed');
  }
  return res.result?.result?.value;
}

function walk(dir, base = dir) {
  const list = [];
  if (!fs.existsSync(dir)) return list;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) list.push(...walk(full, base));
    else list.push({ path: path.relative(base, full), size: fs.statSync(full).size });
  }
  return list;
}

async function waitFor(fn, timeout = 12000, step = 250) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await sleep(step);
  }
  return null;
}

async function main() {
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  log('fixture server on', PORT);

  const child = spawn(edge, [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${CDP_PORT}`,
    `--load-extension=${ext}`,
    `--disable-extensions-except=${ext}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    '--window-size=1100,900',
    `http://127.0.0.1:${PORT}/index.html`
  ], { stdio: 'ignore' });
  let edgeLog = '';
  edgePid = child.pid;
  child.on('error', (err) => { edgeLog += 'SPAWN_ERROR ' + String(err) + '\n'; });
  child.on('exit', (code, signal) => { edgeLog += `EXIT code=${code} signal=${signal}\n`; });

  const version = await waitFor(async () => {
    try {
      const v = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
      return v?.webSocketDebuggerUrl ? v : null;
    } catch { return null; }
  }, 25000);
  if (!version) {
    fs.writeFileSync(path.join(out, 'edge.log'), edgeLog);
    throw new Error('Edge CDP unavailable\n' + edgeLog.slice(-3000));
  }

  const browser = new CDP(version.webSocketDebuggerUrl);
  await browser.ready;

  const swTarget = await waitFor(async () => {
    const list = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
    return list.find((t) => t.type === 'service_worker' && t.url.includes('service-worker.js')) || null;
  }, 15000);
  if (!swTarget) throw new Error('service worker target not found\n' + edgeLog.slice(-3000));
  const extId = new URL(swTarget.url).host;
  log('extension id', extId);

  log('sw target', swTarget.url);
  const sw = await connectTarget(swTarget);
  await sw.send('Log.enable').catch(() => {});
  const swReady = await waitFor(async () => {
    try { return await evalIn(sw, 'typeof chrome !== "undefined" && !!chrome.runtime'); } catch { return false; }
  }, 8000);
  if (!swReady) throw new Error('service worker chrome runtime not ready');
  log('sw env', await evalIn(sw, '({ href: self.location.href, chrome: typeof chrome, runtime: typeof chrome !== "undefined" && !!chrome.runtime })'));
  const swVersion = await evalIn(sw, 'chrome.runtime.getManifest().version');
  log('sw version', swVersion);

  const fixtureTarget = await waitFor(async () => {
    const list = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
    return list.find((t) => t.type === 'page' && t.url.includes(':8765/')) || null;
  }, 10000);
  if (!fixtureTarget) throw new Error('fixture page target not found');
  const page = await connectTarget(fixtureTarget);
  await page.send('Page.bringToFront');
  await sleep(700);

  await evalIn(page, `(() => {
    const img = document.querySelector('#hero');
    const r = img.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    img.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
    img.dispatchEvent(new MouseEvent('mouseover', { clientX: x, clientY: y, bubbles: true }));
    return { x, y };
  })()`);
  await sleep(250);

  const popupUrl = `chrome-extension://${extId}/popup/popup.html?test=1`;
  const created = await browser.send('Target.createTarget', { url: popupUrl });
  const popupTargetId = created.result.targetId;
  const popupTarget = await waitFor(async () => {
    const list = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
    return list.find((t) => t.id === popupTargetId) || null;
  }, 10000);
  const popup = await connectTarget(popupTarget);
  await waitFor(async () => evalIn(popup, '!!window.__antCol', false).catch(() => false), 12000);

  const tabs = await evalIn(popup, 'chrome.tabs.query({})');
  const fixtureTab = tabs.find((t) => (t.url || '').includes(':8765/'));
  const popupTab = tabs.find((t) => (t.url || '').includes('popup.html'));
  if (!fixtureTab) throw new Error('fixture tab not found');
  log('fixture tab', fixtureTab.id, fixtureTab.title);

  await evalIn(popup, `chrome.tabs.update(${fixtureTab.id}, { active: true })`);
  await sleep(300);
  const scan = await evalIn(popup, `(async () => {
    await window.__antCol.scan();
    return {
      count: window.__antCol.state.images.length,
      images: window.__antCol.state.images.map((i) => ({ url: i.url, kind: i.kind, w: i.width, h: i.height, visible: i.visible }))
    };
  })()`);
  log('scan', JSON.stringify(scan, null, 2));

  const hovered = await evalIn(popup, `chrome.tabs.sendMessage(${fixtureTab.id}, { type: 'vv-get-hovered' })`);
  log('hovered', JSON.stringify(hovered));

  // drag image -> dock -> collect panel -> save
  await page.send('Page.bringToFront');
  await evalIn(popup, `chrome.windows.update(${fixtureTab.windowId}, { focused: true })`).catch(() => {});
  await sleep(250);
  const dropReady = await evalIn(page, `(() => {
    const img = document.querySelector('#hero');
    const dt = new DataTransfer();
    img.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  })()`);
  await waitFor(async () => evalIn(page, `!!document.getElementById('ant-col-drop-host')`, false).catch(() => false), 6000);
  await sleep(250);
  const dropState = await evalIn(page, `(() => {
    const host = document.getElementById('ant-col-drop-host');
    return {
      exists: !!host,
      shown: !!host?.shadowRoot?.querySelector('.card.show'),
      folders: [...(host?.shadowRoot?.querySelectorAll('.folder-item .name') || [])].map((x) => x.textContent)
    };
  })()`);
  log('drag drop page', JSON.stringify({ dropReady, ...dropState }));
  const dropShot = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(out, 'drag-page.png'), Buffer.from(dropShot.result.data, 'base64'));
  const panelOpen = await evalIn(page, `(() => {
    const host = document.getElementById('ant-col-drop-host');
    const left = host?.shadowRoot?.querySelector('.left');
    const dt = new DataTransfer();
    left.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    left.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  })()`);
  await waitFor(async () => evalIn(page, `!!document.getElementById('ant-col-drag-panel-host')`, false).catch(() => false), 4000);
  await sleep(250);
  const panelState = await evalIn(page, `(() => {
    const host = document.getElementById('ant-col-drag-panel-host');
    const root = host?.shadowRoot;
    return { exists: !!host, title: root?.querySelector('.title')?.value || '', dest: root?.querySelector('.collection')?.textContent || '' };
  })()`);
  log('drag panel', JSON.stringify({ panelOpen, ...panelState }));
  const panelShot = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(out, 'drag-panel.png'), Buffer.from(panelShot.result.data, 'base64'));
  await evalIn(page, `(() => {
    const root = document.getElementById('ant-col-drag-panel-host').shadowRoot;
    const title = root.querySelector('.title');
    title.value = '拖拽测试图';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    const tag = root.querySelector('.tagin');
    tag.value = 'drag';
    tag.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    root.querySelector('.note').value = 'drag e2e';
    root.querySelector('.save').click();
    return true;
  })()`);
  await waitFor(() => walk(downloads).some((f) => f.path.includes('拖拽测试图')), 15000);
  log('drag saved files', JSON.stringify(walk(downloads).filter((f) => f.path.includes('拖拽测试图')), null, 2));
  await waitFor(async () => !(await evalIn(page, `!!document.getElementById('ant-col-drag-panel-host')`, false).catch(() => true)), 6000);
  await sleep(400);

  // image inside <a> -> panel offers image / link card mode
  await evalIn(page, `(() => {
    const img = document.querySelector('#portrait');
    const dt = new DataTransfer();
    img.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  })()`);
  await sleep(250);
  await evalIn(page, `(() => {
    const host = document.getElementById('ant-col-drop-host');
    const left = host?.shadowRoot?.querySelector('.left');
    const dt = new DataTransfer();
    left.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    left.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  })()`);
  await waitFor(async () => evalIn(page, `!!document.getElementById('ant-col-drag-panel-host')`, false).catch(() => false), 4000);
  await sleep(250);
  const linkPanel = await evalIn(page, `(() => {
    const root = document.getElementById('ant-col-drag-panel-host')?.shadowRoot;
    return {
      modesHidden: root?.querySelector('.modes')?.hidden,
      modes: [...(root?.querySelectorAll('[data-mode]') || [])].map((b) => b.textContent),
      title: root?.querySelector('.title')?.value || ''
    };
  })()`);
  log('link-mode panel', JSON.stringify(linkPanel));
  await evalIn(page, `(() => {
    const root = document.getElementById('ant-col-drag-panel-host').shadowRoot;
    root.querySelector('[data-mode="link"]').click();
    const title = root.querySelector('.title');
    title.value = '拖拽链接卡片';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('.save').click();
    return true;
  })()`);
  await waitFor(() => walk(downloads).some((f) => f.path.includes('链接') && f.path.endsWith('.html')), 15000);
  log('drag link files', JSON.stringify(walk(downloads).filter((f) => f.path.includes('链接')), null, 2));
  await waitFor(async () => !(await evalIn(page, `!!document.getElementById('ant-col-drag-panel-host')`, false).catch(() => true)), 6000);
  await sleep(400);

  // drop onto a collection on the right side
  await evalIn(page, `(() => {
    const img = document.querySelector('#tiny');
    const dt = new DataTransfer();
    img.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  })()`);
  await sleep(300);
  const collectionDrop = await evalIn(page, `(() => {
    const host = document.getElementById('ant-col-drop-host');
    const root = host?.shadowRoot;
    const item = [...root.querySelectorAll('.folder-item')].find((x) => x.querySelector('.name')?.textContent === '日常审美');
    if (!item) return { found: false };
    const dt = new DataTransfer();
    item.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    item.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return { found: true };
  })()`);
  await waitFor(async () => evalIn(page, `!!document.getElementById('ant-col-drag-panel-host')`, false).catch(() => false), 4000);
  await sleep(250);
  const collectionPanel = await evalIn(page, `(() => {
    const root = document.getElementById('ant-col-drag-panel-host')?.shadowRoot;
    return { collection: root?.querySelector('.collection')?.textContent || '', title: root?.querySelector('.title')?.value || '' };
  })()`);
  log('collection drop', JSON.stringify({ ...collectionDrop, ...collectionPanel }));
  await evalIn(page, `(() => {
    const root = document.getElementById('ant-col-drag-panel-host').shadowRoot;
    const title = root.querySelector('.title');
    title.value = '收藏夹测试';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('.save').click();
    return true;
  })()`);
  await waitFor(() => walk(downloads).some((f) => f.path.includes('日常审美') && f.path.includes('收藏夹测试') && f.path.endsWith('.json')), 15000);
  log('collection files', JSON.stringify(walk(downloads).filter((f) => f.path.includes('日常审美')), null, 2));
  await waitFor(async () => !(await evalIn(page, `!!document.getElementById('ant-col-drag-panel-host')`, false).catch(() => true)), 6000);
  await sleep(300);

  // "+ 建立或选择文件夹" -> new collection -> panel
  await page.send('Page.bringToFront');
  await evalIn(popup, `chrome.windows.update(${fixtureTab.windowId}, { focused: true })`).catch(() => {});
  await sleep(200);
  await evalIn(page, `(() => {
    const img = document.querySelector('#hero');
    const dt = new DataTransfer();
    img.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  })()`);
  await waitFor(async () => evalIn(page, `!!document.getElementById('ant-col-drop-host')`, false).catch(() => false), 6000);
  await sleep(250);
  const chooserOpen = await evalIn(page, `(() => {
    const host = document.getElementById('ant-col-drop-host');
    const root = host?.shadowRoot;
    const choose = root?.querySelector('.choose');
    const dt = new DataTransfer();
    choose.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    choose.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  })()`);
  await waitFor(async () => evalIn(page, `!!document.getElementById('ant-col-folder-chooser-host')`, false).catch(() => false), 4000);
  await sleep(250);
  const chooser = await evalIn(page, `(() => {
    const root = document.getElementById('ant-col-folder-chooser-host')?.shadowRoot;
    return { rows: [...(root?.querySelectorAll('.row .name') || [])].map((x) => x.textContent) };
  })()`);
  log('folder chooser', JSON.stringify({ chooserOpen, ...chooser }));
  await evalIn(page, `(() => {
    const root = document.getElementById('ant-col-folder-chooser-host').shadowRoot;
    root.querySelector('.new').value = '临时收藏';
    root.querySelector('[data-act="ok"]').click();
    return true;
  })()`);
  await waitFor(async () => evalIn(page, `!!document.getElementById('ant-col-drag-panel-host')`, false).catch(() => false), 5000);
  await sleep(250);
  const chooserPanel = await evalIn(page, `(() => {
    const root = document.getElementById('ant-col-drag-panel-host')?.shadowRoot;
    return { collection: root?.querySelector('.collection')?.textContent || '' };
  })()`);
  log('chooser panel', JSON.stringify(chooserPanel));
  await evalIn(page, `(() => {
    const root = document.getElementById('ant-col-drag-panel-host').shadowRoot;
    root.querySelector('.x').click();
    return true;
  })()`);

  await evalIn(popup, `(async () => {
    const s = await import(chrome.runtime.getURL('background/store.js'));
    await s.setSettings({ targetMode: 'downloads', dedupe: false, autoTags: true });
    return true;
  })()`);

  const saveItems = scan.images.filter((i) => i.kind === 'image').slice(0, 2).map((i) => ({
    url: i.url,
    kind: i.kind,
    title: i.url.split('/').pop(),
    width: i.w,
    height: i.h,
    pageUrl: `http://127.0.0.1:${PORT}/index.html`,
    pageTitle: 'Fixture Gallery'
  }));

  const saveDownloads = await evalIn(popup, `chrome.runtime.sendMessage({ type: 'save', items: ${JSON.stringify(saveItems)}, meta: { tags: ['test', 'fixture'], note: 'e2e downloads' } })`);
  log('save downloads summary', JSON.stringify({ saved: saveDownloads.saved, duplicate: saveDownloads.duplicate, error: saveDownloads.error, mode: saveDownloads.mode }, null, 2));
  await waitFor(() => walk(downloads).length >= 3, 12000);
  log('downloads files', JSON.stringify(walk(downloads), null, 2));
  const asciiId = await evalIn(popup, `chrome.downloads.download({ url: 'data:text/plain,hello', filename: 'vv-ascii/hello.txt', saveAs: false })`);
  await sleep(800);
  const dlApi = await evalIn(popup, 'chrome.downloads.search({})');
  log('ascii download id', asciiId);
  log('downloads api', JSON.stringify((dlApi || []).map((d) => ({ id: d.id, filename: d.filename, state: d.state, error: d.error, bytes: d.fileSize, byExtensionId: d.byExtensionId })), null, 2));
  log('saved records', JSON.stringify((saveDownloads.items || []).map((r) => ({ status: r.status, path: r.item?.absolutePath, id: r.item?.downloadId })), null, 2));

  await evalIn(popup, `(async () => {
    const s = await import(chrome.runtime.getURL('background/store.js'));
    const root = await navigator.storage.getDirectory();
    await s.setRootHandle(root, 'OPFS Test');
    await s.setSettings({ targetMode: 'folder', dedupe: false, autoTags: true });
    return true;
  })()`);
  const saveFolder = await evalIn(popup, `chrome.runtime.sendMessage({ type: 'save', items: ${JSON.stringify(saveItems.slice(0, 1))}, meta: { tags: ['test', 'folder'], note: 'e2e folder' } })`);
  log('save folder summary', JSON.stringify({ saved: saveFolder.saved, duplicate: saveFolder.duplicate, error: saveFolder.error, mode: saveFolder.mode }, null, 2));

  const tree = await evalIn(popup, `(async () => {
    const root = await navigator.storage.getDirectory();
    const files = [];
    async function walk(dir, base) {
      for await (const [name, handle] of dir.entries()) {
        const p = base ? base + '/' + name : name;
        if (handle.kind === 'directory') await walk(handle, p);
        else { const f = await handle.getFile(); files.push({ path: p, size: f.size, type: f.type }); }
      }
    }
    await walk(root, '');
    return files;
  })()`);
  log('opfs tree', JSON.stringify(tree, null, 2));

  const sidecar = await evalIn(popup, `(async () => {
    const root = await navigator.storage.getDirectory();
    const out = [];
    async function walk(dir, base) {
      for await (const [name, handle] of dir.entries()) {
        const p = base ? base + '/' + name : name;
        if (handle.kind === 'directory') await walk(handle, p);
        else if (name.endsWith('.json')) { const f = await handle.getFile(); out.push({ path: p, text: (await f.text()).slice(0, 1200) }); }
      }
    }
    await walk(root, '');
    return out;
  })()`);
  log('sidecars', JSON.stringify(sidecar, null, 2));

  await evalIn(popup, `chrome.tabs.update(${popupTab.id}, { active: true })`).catch(() => {});
  await popup.send('Emulation.setDeviceMetricsOverride', { width: 404, height: 600, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  const shot = await popup.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const shotPath = path.join(out, 'popup.png');
  fs.writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'));
  log('popup screenshot', shotPath);

  await evalIn(popup, `chrome.tabs.update(${fixtureTab.id}, { active: true })`);
  await sleep(600);
  const screen = await evalIn(popup, `chrome.runtime.sendMessage({ type: 'save-screenshot', mode: 'visible' })`);
  log('screenshot save', JSON.stringify({ saved: screen.saved, error: screen.error, mode: screen.mode }, null, 2));
  await waitFor(() => walk(downloads).some((f) => f.path.includes('\u622a\u56fe')), 12000);
  log('downloads after screenshot', JSON.stringify(walk(downloads), null, 2));

  // element screenshot through the content overlay
  await evalIn(popup, `(async () => {
    const s = await import(chrome.runtime.getURL('background/store.js'));
    await s.setSettings({ targetMode: 'downloads', dedupe: false });
    return true;
  })()`);
  await evalIn(popup, `chrome.tabs.update(${fixtureTab.id}, { active: true })`);
  await page.send('Page.bringToFront');
  await sleep(300);
  await evalIn(popup, `chrome.tabs.sendMessage(${fixtureTab.id}, { type: 'vv-start-element-capture' })`);
  await sleep(300);
  const heroRect = await evalIn(page, `(() => { const r = document.querySelector('#hero').getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: heroRect.x, y: heroRect.y, button: 'none' });
  await sleep(150);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: heroRect.x, y: heroRect.y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: heroRect.x, y: heroRect.y, button: 'left', clickCount: 1 });
  await sleep(1200);
  log('element screenshot downloads', JSON.stringify(walk(downloads).filter((f) => f.path.includes('\u622a\u56fe')), null, 2));

  // duplicate detection + link card in downloads mode
  await evalIn(popup, `(async () => {
    const s = await import(chrome.runtime.getURL('background/store.js'));
    await s.setSettings({ targetMode: 'downloads', dedupe: true });
    return true;
  })()`);
  const dup = await evalIn(popup, `chrome.runtime.sendMessage({ type: 'save', items: ${JSON.stringify(saveItems.slice(0, 1))}, meta: {} })`);
  log('duplicate check', JSON.stringify({ saved: dup.saved, duplicate: dup.duplicate, error: dup.error }, null, 2));
  const directNames = await evalIn(popup, `(async () => {
    const tries = ['Ant-col\u7d20\u6750/\u94fe\u63a5/test.url', 'Ant-col\u7d20\u6750/\u94fe\u63a5/test.txt', 'Ant-col\u7d20\u6750/\u94fe\u63a5/test.html'];
    const out = {};
    for (const f of tries) {
      try { out[f] = 'id:' + await chrome.downloads.download({ url: 'data:text/plain,hi', filename: f, saveAs: false }); }
      catch (e) { out[f] = String(e); }
    }
    return out;
  })()`);
  log('direct filenames', JSON.stringify(directNames, null, 2));
  const link = await evalIn(popup, `chrome.runtime.sendMessage({ type: 'save', items: [{ kind: 'link', url: 'https://example.com/article', linkUrl: 'https://example.com/article', pageUrl: 'http://127.0.0.1:${PORT}/index.html', pageTitle: 'Fixture Gallery', title: 'Example Article' }], meta: { tags: ['link'], note: 'e2e link' } })`);
  log('link save', JSON.stringify({ saved: link.saved, duplicate: link.duplicate, error: link.error, detail: link.items?.[0] }, null, 2));
  await waitFor(() => walk(downloads).some((f) => f.path.includes('\u94fe\u63a5') && f.path.endsWith('.html')), 8000);
  log('downloads after link', JSON.stringify(walk(downloads).filter((f) => f.path.includes('\u94fe\u63a5')), null, 2));

  // full page screenshot (CDP page connection must be closed so chrome.debugger can attach)
  page.close();
  await sleep(500);
  await evalIn(popup, `chrome.tabs.update(${fixtureTab.id}, { active: true })`);
  await sleep(400);
  const full = await evalIn(popup, `chrome.runtime.sendMessage({ type: 'save-screenshot', mode: 'full' })`);
  log('full page save', JSON.stringify({ saved: full.saved, error: full.error, captureMode: full.items?.[0]?.item?.captureMode }, null, 2));

  // Library page: inbox, thumbnails, detail drawer, update, triage
  const libCreated = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/library/library.html?test=1` });
  const libTarget = await waitFor(async () => {
    const list = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
    return list.find((t) => t.id === libCreated.result.targetId) || null;
  }, 10000);
  const libraryPage = await connectTarget(libTarget);
  await libraryPage.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await waitFor(async () => evalIn(libraryPage, '!!window.__antColLibrary', false).catch(() => false), 12000);
  await sleep(1200);
  const libraryInit = await evalIn(libraryPage, `(() => {
    const s = window.__antColLibrary.state;
    return {
      items: s.items.length,
      inbox: s.items.filter((i) => i.status === 'inbox').length,
      projects: s.projects.map((p) => p.name),
      cards: document.querySelectorAll('.card').length,
      images: document.querySelectorAll('.card-thumb img').length,
      blobImages: [...document.querySelectorAll('.card-thumb img')].filter((i) => i.src.startsWith('blob:')).length,
      batchHidden: document.querySelector('#batchBar')?.hidden,
      loadMoreHidden: document.querySelector('#loadMoreBtn')?.hidden,
      title: document.querySelector('#viewTitle')?.textContent || ''
    };
  })()`);
  log('library init', JSON.stringify(libraryInit));
  const libShot = await libraryPage.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(out, 'library.png'), Buffer.from(libShot.result.data, 'base64'));

  const batchState = await evalIn(libraryPage, `(async () => {
    const boxes = [...document.querySelectorAll('.card-check input')].slice(0, 2);
    boxes.forEach((box) => box.click());
    await new Promise((r) => setTimeout(r, 200));
    return { selected: boxes.length, count: document.querySelector('#batchCount')?.textContent, hidden: document.querySelector('#batchBar')?.hidden };
  })()`);
  const batchApplied = await evalIn(libraryPage, `(async () => {
    const select = document.querySelector('#batchProject');
    select.value = '帮催作品';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 900));
    return window.__antColLibrary.state.items.filter((i) => i.collection === '帮催作品').length;
  })()`);
  log('library batch', JSON.stringify({ ...batchState, projectItems: batchApplied }));
  const searchState = await evalIn(libraryPage, `(async () => {
    const input = document.querySelector('#searchInput');
    input.value = 'art-1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 350));
    const result = { count: document.querySelector('#resultCount')?.textContent, cards: document.querySelectorAll('.card').length };
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 350));
    return result;
  })()`);
  log('library search', JSON.stringify(searchState));

  const detailOpened = await evalIn(libraryPage, `(async () => {
    const s = window.__antColLibrary.state;
    const first = s.items.find((i) => i.status === 'inbox') || s.items[0];
    if (!first) return { ok: false };
    window.__antColLibrary.openDetail(first.id);
    await new Promise((r) => setTimeout(r, 250));
    return {
      ok: true,
      id: first.id,
      drawer: !!document.getElementById('detailDrawer'),
      projectOptions: [...document.querySelectorAll('#detailProject option')].map((x) => x.textContent)
    };
  })()`);
  log('library detail', JSON.stringify(detailOpened));
  const detailShot = await libraryPage.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(out, 'library-detail.png'), Buffer.from(detailShot.result.data, 'base64'));
  const libUpdate = await evalIn(libraryPage, `(async () => {
    const s = window.__antColLibrary.state;
    const first = s.items.find((i) => i.status === 'inbox') || s.items[0];
    await window.__antColLibrary.updateItems([first.id], {
      status: 'kept',
      collection: '日常审美',
      annotation: 'library e2e'
    }, 'library test');
    const updated = window.__antColLibrary.state.items.find((i) => i.id === first.id);
    return { status: updated?.status, collection: updated?.collection, annotation: updated?.annotation };
  })()`);
  log('library update', JSON.stringify(libUpdate));
  const folderMirror = await evalIn(libraryPage, `(async () => {
    const s = window.__antColLibrary.state;
    const item = s.items.find((i) => i.mode === 'folder');
    if (!item) return { found: false };
    await window.__antColLibrary.updateItems([item.id], { status: 'kept' }, 'mirror test');
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('_index.json');
    const list = JSON.parse(await (await handle.getFile()).text());
    const entry = list.find((x) => x.id === item.id);
    return { found: true, status: entry?.status, mirrorCount: list.length };
  })()`);
  log('folder index mirror', JSON.stringify(folderMirror));
  await evalIn(libraryPage, `document.querySelector('#toast')?.classList.remove('show'); true`).catch(() => {});
  const triageOpen = await evalIn(libraryPage, `(async () => {
    window.__antColLibrary.startTriage();
    await new Promise((r) => setTimeout(r, 300));
    const card = document.querySelector('#triageRoot .triage-card');
    return { open: !!card, title: document.querySelector('#triageTitle')?.textContent || '', projects: [...document.querySelectorAll('#triageProjects button')].map((x) => x.textContent) };
  })()`);
  log('library triage', JSON.stringify(triageOpen));
  const triageShot = await libraryPage.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(out, 'library-triage.png'), Buffer.from(triageShot.result.data, 'base64'));
  const triageAction = await evalIn(libraryPage, `(async () => {
    document.querySelector('#triageKeep')?.click();
    await new Promise((r) => setTimeout(r, 650));
    return {
      open: !!document.querySelector('#triageRoot .triage-card'),
      progress: document.querySelector('.triage-top span')?.textContent || ''
    };
  })()`);
  log('library triage keep', JSON.stringify(triageAction));
  await evalIn(libraryPage, `document.querySelector('#triageClose')?.click()`).catch(() => {});
  await evalIn(libraryPage, `window.__antColLibrary.exportItems('md')`).catch(() => {});
  await waitFor(() => walk(downloads).some((f) => f.path.includes('Ant-col-导出')), 10000);
  log('library export', JSON.stringify(walk(downloads).filter((f) => f.path.includes('Ant-col-导出')), null, 2));

  // options page screenshot
  await evalIn(popup, `chrome.tabs.update(${popupTab.id}, { active: true })`).catch(() => {});
  const optCreated = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/options/options.html` });
  const optTarget = await waitFor(async () => {
    const list = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
    return list.find((t) => t.id === optCreated.result.targetId) || null;
  }, 10000);
  const optionsPage = await connectTarget(optTarget);
  await optionsPage.send('Emulation.setDeviceMetricsOverride', { width: 940, height: 1100, deviceScaleFactor: 1, mobile: false });
  await sleep(900);
  const optShot = await optionsPage.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const optPath = path.join(out, 'options.png');
  fs.writeFileSync(optPath, Buffer.from(optShot.result.data, 'base64'));
  const picker = await evalIn(optionsPage, 'typeof window.showDirectoryPicker');
  log('options screenshot', optPath, 'picker:', picker);

  const swErrors = sw.events.filter((e) => e.method === 'Runtime.exceptionThrown' || e.method === 'Log.entryAdded');
  log('sw errors', JSON.stringify(swErrors.slice(-10), null, 2));

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify({
    extId,
    swVersion,
    scanCount: scan.count,
    hovered: hovered?.url || null,
    downloads: walk(downloads).length,
    opfsFiles: tree.length,
    library: libraryInit,
    libraryUpdate: libUpdate,
    popupShot: shotPath,
    libraryShot: path.join(out, 'library.png')
  }, null, 2));

  sw.close(); popup.close(); optionsPage.close(); libraryPage.close(); browser.close();
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
  server.closeAllConnections?.();
  server.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('E2E FAILED:', err);
  try { if (edgePid) execFileSync('taskkill', ['/PID', String(edgePid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
  server.closeAllConnections?.();
  server.close();
  process.exit(1);
});



