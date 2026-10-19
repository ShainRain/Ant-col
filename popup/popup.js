const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const KIND_LABEL = { image: '图片', video: '视频', screenshot: '截图', link: '链接', file: '文件' };
const KIND_GLYPH = { image: '◨', video: '▶', screenshot: '▣', link: '↗', file: '◇' };

const state = {
  settings: null,
  root: null,
  stats: { count: 0, totalBytes: 0, todayCount: 0 },
  inboxCount: 0,
  recent: [],
  allTags: [],
  images: [],
  displayed: [],
  selected: new Set(),
  tags: [],
  tab: null,
  busy: false,
  scanToken: 0
};

function send(message) {
  return chrome.runtime.sendMessage(message);
}

function humanBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function timeAgo(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  const d = new Date(ms);
  return `${d.getMonth() + 1}-${d.getDate()}`;
}

function toast(text, tone = '') {
  const el = $('#toast');
  el.textContent = text;
  el.className = `toast show ${tone}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => el.classList.remove('show'), 3000);
}

async function loadState() {
  const res = await send({ type: 'state' });
  if (!res || res.error) throw new Error(res?.error || '无法读取状态');
  state.settings = res.settings;
  state.root = res.root;
  state.stats = res.stats;
  state.inboxCount = res.inboxCount || 0;
  state.recent = res.recent || [];
  state.allTags = res.allTags || [];
  renderTarget();
  renderFirstRun();
  renderRecent();
  renderTagSuggestions();
}

function renderTarget() {
  const useFolder = !!state.root && state.settings?.targetMode !== 'downloads';
  const name = useFolder
    ? state.root.name
    : `下载 / ${state.settings?.downloadsSubfolder || 'Ant-col素材'}`;
  $('#targetName').textContent = name;
  const dot = $('#targetDot');
  dot.className = 'target-dot';
  if (useFolder && state.root.permission !== 'granted') dot.classList.add('warn');
  if (!useFolder) dot.classList.add('off');
  $('#targetChip').title = useFolder
    ? `素材库：${state.root.name}${state.root.permission !== 'granted' ? '（需要重新授权）' : ''}`
    : '当前保存到下载文件夹，点击设置可更改';
}

function renderFirstRun() {
  const show = !state.root || state.root.permission !== 'granted';
  $('#firstRun').hidden = !show;
  if (show) {
    const strong = $('#firstRun strong');
    const span = $('#firstRun span');
    if (state.root && state.root.permission !== 'granted') {
      strong.textContent = '文件夹授权已失效';
      span.textContent = '浏览器重启后需要重新确认一次写入权限，点右侧按钮重新授权。';
      $('#chooseFolderBtn').textContent = '重新授权';
    } else {
      strong.textContent = '保存到任意文件夹';
      span.textContent = '现在默认进入下载文件夹。选择一个素材库文件夹，所有素材会直接写到你指定的位置。';
      $('#chooseFolderBtn').textContent = '选择文件夹';
    }
  }
}

function renderStats() {
  $('#recentTitle').textContent = '最近收进';
  $('#recentStats').textContent = `${state.stats.count || 0} 项 · ${humanBytes(state.stats.totalBytes)}${state.inboxCount ? ` · 待整理 ${state.inboxCount}` : ''}`;
}

function renderRecent() {
  renderStats();
  const list = $('#recentList');
  list.innerHTML = '';
  const items = state.recent || [];
  $('#recentEmpty').hidden = items.length > 0;
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'recent-item';
    row.innerHTML = `
      <div class="recent-icon">${KIND_GLYPH[item.kind] || '◇'}</div>
      <div class="recent-body">
        <div class="recent-name"></div>
        <div class="recent-meta"></div>
      </div>
      <button title="定位文件">定位</button>
    `;
    const statusLabel = { inbox: '待整理', kept: '已整理', archived: '归档' }[item.status || 'kept'];
    row.querySelector('.recent-name').textContent = item.name || '未命名';
    row.querySelector('.recent-meta').textContent = `${statusLabel} · ${KIND_LABEL[item.kind] || '素材'} · ${timeAgo(item.savedAtMs)} · ${item.relativePath || ''}`;
    row.querySelector('button').addEventListener('click', async () => {
      const res = await send({ type: 'reveal', item });
      if (!res?.ok) toast(res?.path ? `文件位置：${res.path}` : '无法定位文件');
    });
    list.appendChild(row);
  }
}

function renderTagSuggestions() {
  const dl = $('#tagSuggestions');
  dl.innerHTML = '';
  for (const tag of state.allTags) {
    const opt = document.createElement('option');
    opt.value = tag.name;
    dl.appendChild(opt);
  }
}

function renderTags() {
  const box = $('#tagChips');
  box.innerHTML = '';
  state.tags.forEach((tag, index) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `<span></span><button title="移除">×</button>`;
    chip.querySelector('span').textContent = tag;
    chip.querySelector('button').addEventListener('click', () => {
      state.tags.splice(index, 1);
      renderTags();
    });
    box.appendChild(chip);
  });
}

function addTag(raw) {
  const parts = String(raw || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    if (part && !state.tags.includes(part) && state.tags.length < 12) state.tags.push(part.slice(0, 48));
  }
  renderTags();
}

function collectImages(minSize, includeBackground) {
  const out = [];
  const seen = new Set();
  const viewport = { w: innerWidth, h: innerHeight };
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && r.bottom > 0 && r.right > 0 && r.top < viewport.h && r.left < viewport.w;
  };
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return u; } };
  const push = (data) => {
    if (!data.url || seen.has(data.url)) return;
    if (data.width && data.height && data.width < minSize && data.height < minSize) return;
    seen.add(data.url);
    out.push(data);
  };

  document.querySelectorAll('img').forEach((img) => {
    const src = img.currentSrc || img.src;
    if (!src) return;
    const w = img.naturalWidth || Math.round(img.getBoundingClientRect().width);
    const h = img.naturalHeight || Math.round(img.getBoundingClientRect().height);
    if (w <= 1 || h <= 1) return;
    push({
      url: abs(src),
      kind: 'image',
      title: img.title || img.alt || '',
      alt: img.alt || '',
      width: w,
      height: h,
      visible: isVisible(img),
      area: w * h
    });
  });

  document.querySelectorAll('video').forEach((video) => {
    const src = video.currentSrc || video.src;
    const poster = video.poster ? abs(video.poster) : '';
    const w = video.videoWidth || Math.round(video.getBoundingClientRect().width);
    const h = video.videoHeight || Math.round(video.getBoundingClientRect().height);
    if (src && !src.startsWith('blob:')) {
      push({ url: abs(src), kind: 'video', title: video.title || '', alt: '', width: w, height: h, visible: isVisible(video), area: w * h });
    } else if (poster) {
      push({ url: poster, kind: 'image', title: video.title || '视频封面', alt: '', width: 0, height: 0, visible: isVisible(video), area: 0 });
    }
  });

  if (includeBackground) {
    const all = document.querySelectorAll('body *');
    const limit = Math.min(all.length, 4000);
    for (let i = 0; i < limit; i++) {
      const el = all[i];
      if (el.closest('img,video,canvas,svg')) continue;
      let bg;
      try { bg = getComputedStyle(el).backgroundImage; } catch { continue; }
      if (!bg || bg === 'none' || !bg.includes('url(')) continue;
      const m = bg.match(/url\((['"]?)(.*?)\1\)/i);
      if (!m?.[2] || m[2].startsWith('data:image/svg')) continue;
      const url = abs(m[2]);
      if (seen.has(url)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) continue;
      push({
        url,
        kind: 'image',
        title: el.getAttribute('aria-label') || el.title || '',
        alt: '',
        width: Math.round(r.width),
        height: Math.round(r.height),
        visible: isVisible(el),
        area: r.width * r.height
      });
    }
  }

  out.sort((a, b) => (Number(b.visible) - Number(a.visible)) || (b.area - a.area));
  return out.slice(0, 300);
}

async function scan() {
  const token = ++state.scanToken;
  const grid = $('#grid');
  grid.innerHTML = '';
  state.images = [];
  state.selected.clear();
  $('#pageEmpty').hidden = true;
  $('#scanCount').textContent = '正在扫描…';
  $('#scanHint').textContent = '';

  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch { /* ignore */ }
  state.tab = tab || null;

  if (!tab || !/^https?:|^file:/i.test(tab.url || '')) {
    $('#scanCount').textContent = '此页面不可扫描';
    $('#scanHint').textContent = '浏览器内部页面不支持，请切换到普通网页';
    $('#pageEmpty').hidden = false;
    $('#emptyTitle').textContent = '这里没有可保存的网页素材';
    $('#emptyDesc').textContent = '打开网页开始搜寻视觉资产';
    updateSelectionUI();
    return;
  }

  $('#scanHint').textContent = (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })();
  const minSize = Number($('#sizeFilter').value) || 0;
  let images = [];
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectImages,
      args: [minSize, state.settings?.includeBackgroundImages !== false]
    });
    images = results?.[0]?.result || [];
  } catch (err) {
    if (token !== state.scanToken) return;
    $('#scanCount').textContent = '扫描失败';
    $('#scanHint').textContent = err?.message || '请刷新页面后重试';
    $('#pageEmpty').hidden = false;
    $('#emptyTitle').textContent = '无法访问这个页面';
    $('#emptyDesc').textContent = '如果页面刚打开，刷新一次再试';
    updateSelectionUI();
    return;
  }
  if (token !== state.scanToken) return;

  state.images = images;
  const filtered = images.filter((img) => {
    const min = Number($('#sizeFilter').value) || 0;
    return !min || img.width >= min || img.height >= min;
  });
  state.displayed = filtered;
  renderGrid(filtered);
  $('#scanCount').textContent = `发现 ${filtered.length} 张素材`;
  $('#pageEmpty').hidden = filtered.length > 0;
  if (!filtered.length) {
    $('#emptyTitle').textContent = '没有发现可保存的图片';
    $('#emptyDesc').textContent = '试试降低尺寸筛选，或右键页面上的图片';
  } else if (filtered.length <= 12) {
    filtered.forEach((img) => state.selected.add(img.url));
  }
  updateSelectionUI();
}

function renderGrid(images) {
  const grid = $('#grid');
  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const img of images) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.url = img.url;
    card.title = `${img.title || '素材'}\n${img.width || '?'} × ${img.height || '?'}`;
    const image = document.createElement('img');
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.src = img.url;
    image.addEventListener('error', () => {
      image.remove();
      const broken = document.createElement('div');
      broken.className = 'broken';
      broken.textContent = '⊘';
      card.appendChild(broken);
    });
    const check = document.createElement('span');
    check.className = 'check';
    check.textContent = '✓';
    const badge = document.createElement('span');
    badge.className = 'size-badge';
    badge.textContent = img.width && img.height ? `${img.width}×${img.height}` : (img.kind === 'video' ? '视频' : '素材');
    card.append(image, check, badge);
    card.addEventListener('click', () => {
      if (state.selected.has(img.url)) state.selected.delete(img.url);
      else state.selected.add(img.url);
      card.classList.toggle('selected', state.selected.has(img.url));
      updateSelectionUI();
    });
    if (state.selected.has(img.url)) card.classList.add('selected');
    frag.appendChild(card);
  }
  grid.appendChild(frag);
}

function updateSelectionUI() {
  const count = state.selected.size;
  const btn = $('#saveBtn');
  btn.disabled = count === 0 || state.busy;
  $('#saveBtnText').textContent = count ? `保存 ${count} 项` : '保存';
  const cards = $$('.card');
  let selectedCards = 0;
  for (const card of cards) {
    const on = state.selected.has(card.dataset.url);
    card.classList.toggle('selected', on);
    if (on) selectedCards++;
  }
  const all = $('#selectAll');
  all.checked = cards.length > 0 && selectedCards === cards.length;
  all.indeterminate = selectedCards > 0 && selectedCards < cards.length;
  if (cards.length) {
    const found = state.images.length;
    $('#scanCount').textContent = found > cards.length
      ? `发现 ${found} 张 · 可保存 ${cards.length} 张 · 已选 ${selectedCards}`
      : `发现 ${cards.length} 张素材 · 已选 ${selectedCards}`;
  }
}

async function saveSelected() {
  if (state.busy || !state.selected.size) return;
  state.busy = true;
  updateSelectionUI();
  const items = state.images
    .filter((img) => state.selected.has(img.url))
    .map((img) => ({
      url: img.url,
      kind: img.kind,
      title: img.title,
      alt: img.alt,
      width: img.width,
      height: img.height,
      pageUrl: state.tab?.url || '',
      pageTitle: state.tab?.title || ''
    }));
  const meta = { tags: state.tags.slice(), note: $('#noteInput').value.trim() };
  const progress = $('#progress');
  const bar = $('#progressBar');
  progress.hidden = false;
  bar.style.width = '6%';
  try {
    const res = await send({ type: 'save', items, meta });
    if (!res || res.error) throw new Error(res?.error || '保存失败');
    bar.style.width = '100%';
    const saved = res.items?.filter((r) => r.status === 'saved') || [];
    const dup = res.duplicate || 0;
    const errors = res.error || 0;
    let msg = `已保存 ${saved.length} 项`;
    if (dup) msg += `，跳过 ${dup} 项重复`;
    if (errors) msg += `，${errors} 项失败`;
    if (res.mode === 'downloads') msg += '（下载文件夹）';
    toast(msg, errors ? 'error' : '');
    for (const savedItem of saved) {
      state.selected.delete(savedItem.item.sourceUrl);
    }
    await loadState();
    updateSelectionUI();
  } catch (err) {
    toast(err?.message || '保存失败', 'error');
  } finally {
    state.busy = false;
    progress.hidden = true;
    bar.style.width = '0%';
    updateSelectionUI();
  }
}

async function exportIndex() {
  try {
    const res = await send({ type: 'export-index', format: 'json' });
    if (!res || res.error) throw new Error(res?.error || '导出失败');
    const url = `data:application/json;charset=utf-8,${encodeURIComponent(res.text)}`;
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    await chrome.downloads.download({
      url,
      filename: `Ant-col索引-${stamp}.json`,
      saveAs: true
    });
    toast(`已导出 ${res.count} 项`);
  } catch (err) {
    toast(err?.message || '导出失败', 'error');
  }
}

function switchTab(name, tabEl) {
  $$('.tab').forEach((tab) => tab.classList.toggle('active', tab === tabEl));
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === (name === 'page' ? 'viewPage' : 'viewRecent')));
  const ink = $('.tab-ink');
  ink.style.left = `${tabEl.offsetLeft}px`;
  ink.style.width = `${tabEl.offsetWidth}px`;
  if (name === 'recent') {
    loadState().catch(() => {});
  }
}

function bind() {
  $$('.tab').forEach((tab) => tab.addEventListener('click', () => switchTab(tab.dataset.tab, tab)));
  $('#libraryBtn').addEventListener('click', () => send({ type: 'open-library' }).catch(() => {}));
  $('#settingsBtn').addEventListener('click', () => send({ type: 'open-options' }));
  $('#targetChip').addEventListener('click', () => send({ type: 'open-options' }));
  $('#chooseFolderBtn').addEventListener('click', () => send({ type: 'open-options' }));
  $('#rescanBtn').addEventListener('click', () => scan());
  $('#sizeFilter').addEventListener('change', () => {
    state.selected.clear();
    scan();
  });
  $('#selectAll').addEventListener('change', (event) => {
    const cards = $$('.card');
    if (event.target.checked) cards.forEach((card) => state.selected.add(card.dataset.url));
    else state.selected.clear();
    updateSelectionUI();
  });
  $('#saveBtn').addEventListener('click', saveSelected);
  $('#exportBtn').addEventListener('click', exportIndex);
  $('#openFolderBtn').addEventListener('click', async () => {
    const res = await send({ type: 'show-default-folder' });
    if (!res?.ok) toast('无法打开下载文件夹');
  });
  $('#tagInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addTag(event.target.value);
      event.target.value = '';
    } else if (event.key === 'Backspace' && !event.target.value && state.tags.length) {
      state.tags.pop();
      renderTags();
    }
  });
  $('#tagInput').addEventListener('blur', (event) => {
    if (event.target.value.trim()) {
      addTag(event.target.value);
      event.target.value = '';
    }
  });
  const note = $('#noteInput');
  note.addEventListener('input', () => {
    note.style.height = 'auto';
    note.style.height = `${Math.min(70, note.scrollHeight)}px`;
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'save-progress' && state.busy) {
      const pct = Math.max(6, Math.round((message.done / Math.max(1, message.total)) * 100));
      $('#progressBar').style.width = `${pct}%`;
      $('#saveBtnText').textContent = `保存 ${message.done}/${message.total}`;
    }
  });
  // 初始 ink 位置
  requestAnimationFrame(() => {
    const active = $('.tab.active');
    const ink = $('.tab-ink');
    ink.style.left = `${active.offsetLeft}px`;
    ink.style.width = `${active.offsetWidth}px`;
  });
}

(async function init() {
  bind();
  try {
    await loadState();
  } catch (err) {
    toast(err?.message || '读取设置失败', 'error');
  }
  await scan();
  if (new URLSearchParams(location.search).has('test')) {
    window.__shitu = { scan, state, saveSelected, loadState, toast };
  }
})();
