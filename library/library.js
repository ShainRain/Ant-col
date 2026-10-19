import { getThumb } from '../background/thumb-store.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const send = (message) => chrome.runtime.sendMessage(message);

const KIND_LABEL = { image: '图片', video: '视频', screenshot: '截图', link: '链接', file: '文件' };
const KIND_GLYPH = { image: '◨', video: '▶', screenshot: '▣', link: '↗', file: '◇' };
const STATUS_LABEL = { inbox: '待整理', kept: '已整理', archived: '归档' };

const state = {
  items: [],
  projects: [],
  tags: [],
  settings: null,
  root: null,
  stats: null,
  view: 'inbox',
  project: '',
  tag: '',
  query: '',
  kind: 'all',
  sort: 'newest',
  selected: new Set(),
  limit: 120,
  detailId: null,
  triage: null,
  thumbUrls: new Map(),
  loading: true
};

function toast(text, tone = '') {
  const el = $('#toast');
  el.textContent = text;
  el.className = `toast show ${tone}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => el.classList.remove('show'), 2800);
}

function humanBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function dateLabel(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hashColor(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 58%)`;
}

async function load() {
  state.loading = true;
  try {
    const res = await send({ type: 'library-state' });
    if (!res || res.error) throw new Error(res?.error || '无法读取素材库');
    state.items = res.items || [];
    state.projects = res.projects || [];
    state.tags = res.tags || [];
    state.settings = res.settings || {};
    state.root = res.root || null;
    state.stats = res.stats || {};
    if (state.view === 'project' && !state.projects.some((p) => p.name === state.project)) {
      state.view = 'all';
      state.project = '';
    }
    if (state.view === 'tag' && !state.tags.some((t) => t.name === state.tag)) {
      state.view = 'all';
      state.tag = '';
    }
    renderSidebar();
    renderHead();
    renderGrid();
  } catch (err) {
    toast(err?.message || '读取失败', 'error');
  } finally {
    state.loading = false;
  }
}

function parseQuery(raw) {
  const out = { text: [], tag: '', project: '', site: '', kind: '', status: '', star: 0, starOp: '', starred: false };
  for (const token of String(raw || '').trim().split(/\s+/).filter(Boolean)) {
    if (token.startsWith('tag:') || token.startsWith('#')) out.tag = token.replace(/^tag:|^#/, '');
    else if (token.startsWith('project:')) out.project = token.slice(8);
    else if (token.startsWith('site:')) out.site = token.slice(5).toLowerCase();
    else if (token.startsWith('kind:')) out.kind = token.slice(5);
    else if (token === 'is:starred' || token === 'is:star') out.starred = true;
    else if (token.startsWith('is:')) out.status = token.slice(3);
    else if (token.startsWith('star:')) {
      const match = /^(>=|<=|>|<|=)?([0-5])$/.exec(token.slice(5));
      if (match) { out.starOp = match[1] || '='; out.star = Number(match[2]); }
    } else out.text.push(token);
  }
  return out;
}

function filtered() {
  const q = parseQuery(state.query);
  const text = q.text.join(' ').toLowerCase();
  let list = state.items.slice();

  if (state.view === 'inbox') list = list.filter((i) => i.status === 'inbox');
  else if (state.view === 'kept') list = list.filter((i) => i.status === 'kept');
  else if (state.view === 'archived') list = list.filter((i) => i.status === 'archived');
  else if (state.view === 'project') list = list.filter((i) => i.collection === state.project);
  else if (state.view === 'tag') list = list.filter((i) => (i.tags || []).includes(state.tag));

  if (q.tag) list = list.filter((i) => (i.tags || []).includes(q.tag));
  if (q.project) list = list.filter((i) => i.collection === q.project);
  if (q.status) list = list.filter((i) => i.status === q.status);
  if (q.starred) list = list.filter((i) => Number(i.star || 0) > 0);
  if (q.star) {
    list = list.filter((i) => {
      const star = Number(i.star || 0);
      if (q.starOp === '>=') return star >= q.star;
      if (q.starOp === '<=') return star <= q.star;
      if (q.starOp === '>') return star > q.star;
      if (q.starOp === '<') return star < q.star;
      return star === q.star;
    });
  }
  const kind = q.kind || state.kind;
  if (kind !== 'all') list = list.filter((i) => i.kind === kind);
  if (q.site) list = list.filter((i) => String(i.site || '').toLowerCase().includes(q.site));
  if (text) {
    list = list.filter((i) => {
      const hay = [i.name, i.site, i.collection, i.pageTitle, i.annotation, i.sourceUrl, ...(i.tags || [])]
        .join(' ').toLowerCase();
      return text.split(/\s+/).every((part) => hay.includes(part));
    });
  }

  if (state.sort === 'newest') list.sort((a, b) => (b.savedAtMs || 0) - (a.savedAtMs || 0));
  else if (state.sort === 'oldest') list.sort((a, b) => (a.savedAtMs || 0) - (b.savedAtMs || 0));
  else if (state.sort === 'name') list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh'));
  else if (state.sort === 'size') list.sort((a, b) => (b.size || 0) - (a.size || 0));
  else if (state.sort === 'star') {
    list.sort((a, b) => (Number(b.star || 0) - Number(a.star || 0)) || ((b.savedAtMs || 0) - (a.savedAtMs || 0)));
  }
  return list;
}

function renderSidebar() {
  const counts = { inbox: 0, kept: 0, archived: 0, all: state.items.length };
  for (const item of state.items) counts[item.status] = (counts[item.status] || 0) + 1;
  $('#inboxBadge').textContent = String(counts.inbox || 0);
  $('#inboxBadge').classList.toggle('zero', !counts.inbox);
  for (const el of $$('[data-count]')) {
    const key = el.dataset.count;
    el.textContent = String(counts[key] || 0);
  }
  for (const button of $$('#mainNav button')) {
    button.classList.toggle('active', state.view === button.dataset.view);
  }

  const projectList = $('#projectList');
  projectList.innerHTML = '';
  for (const project of state.projects) {
    const button = document.createElement('button');
    button.className = `rail-item${state.view === 'project' && state.project === project.name ? ' active' : ''}`;
    button.innerHTML = '<span class="dot"></span><span class="name"></span><em></em>';
    button.querySelector('.dot').style.background = hashColor(project.name);
    button.querySelector('.name').textContent = project.name;
    button.querySelector('em').textContent = String(project.count || 0);
    button.addEventListener('click', () => {
      state.view = 'project';
      state.project = project.name;
      state.tag = '';
      state.limit = 120;
      state.selected.clear();
      renderSidebar(); renderHead(); renderGrid();
    });
    projectList.appendChild(button);
  }
  if (!state.projects.length) {
    const empty = document.createElement('div');
    empty.className = 'rail-item';
    empty.style.cursor = 'default';
    empty.textContent = '还没有项目';
    projectList.appendChild(empty);
  }

  const tagList = $('#tagList');
  tagList.innerHTML = '';
  for (const tag of state.tags.slice(0, 24)) {
    const button = document.createElement('button');
    button.className = `tag-chip${state.view === 'tag' && state.tag === tag.name ? ' active' : ''}`;
    button.textContent = `${tag.name} ${tag.count}`;
    button.addEventListener('click', () => {
      state.view = 'tag';
      state.tag = tag.name;
      state.project = '';
      state.limit = 120;
      state.selected.clear();
      renderSidebar(); renderHead(); renderGrid();
    });
    tagList.appendChild(button);
  }
  if (!state.tags.length) {
    const empty = document.createElement('span');
    empty.className = 'tag-chip';
    empty.textContent = '暂无标签';
    tagList.appendChild(empty);
  }

  $('#triageBtn').disabled = !counts.inbox;
}

function renderHead() {
  const list = filtered();
  let title = '全部素材';
  let sub = '你的本地视觉记忆。';
  if (state.view === 'inbox') { title = 'Inbox'; sub = '收进来，再慢慢整理。'; }
  else if (state.view === 'kept') { title = '已整理'; sub = '已经归类、可以随时取用的素材。'; }
  else if (state.view === 'archived') { title = '归档'; sub = '暂时不看，但还留着。'; }
  else if (state.view === 'project') { title = state.project; sub = '项目素材与参考资料。'; }
  else if (state.view === 'tag') { title = `#${state.tag}`; sub = '同标签下的素材。'; }
  $('#viewTitle').textContent = title;
  $('#viewSubtitle').textContent = sub;
  $('#resultCount').textContent = `${list.length} 项`;
  const totalBytes = list.reduce((sum, i) => sum + (i.size || 0), 0);
  $('#viewSubtitle').textContent = `${sub}${list.length ? ` · ${humanBytes(totalBytes)}` : ''}`;
  $('#clearSelectionBtn').hidden = state.selected.size === 0;
  $('#selectAllBtn').hidden = list.length === 0;
  $('#selectAllBtn').textContent = state.selected.size === list.length && list.length ? '取消全选' : '全选当前';
}

function thumbFallback(item, thumb) {
  const glyph = document.createElement('div');
  glyph.className = 'glyph';
  glyph.textContent = KIND_GLYPH[item.kind] || '◇';
  thumb.appendChild(glyph);
}

async function fillThumb(item, thumb) {
  const cached = state.thumbUrls.get(item.id);
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.alt = '';
  if (cached) {
    img.src = cached;
    thumb.appendChild(img);
    return;
  }
  try {
    const blob = await getThumb(item.id);
    if (blob) {
      const url = URL.createObjectURL(blob);
      state.thumbUrls.set(item.id, url);
      img.src = url;
      thumb.appendChild(img);
      return;
    }
  } catch { /* ignore */ }
  const source = item.sourceUrl && ['image', 'screenshot'].includes(item.kind) && /^(https?:|data:)/i.test(item.sourceUrl)
    ? item.sourceUrl
    : '';
  if (source) {
    img.src = source;
    img.onerror = () => { img.remove(); if (!thumb.querySelector('.glyph')) thumbFallback(item, thumb); };
    thumb.appendChild(img);
    return;
  }
  thumbFallback(item, thumb);
}

function makeCard(item) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = item.id;
  if (state.selected.has(item.id)) card.classList.add('selected');

  const checkWrap = document.createElement('label');
  checkWrap.className = 'card-check';
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = state.selected.has(item.id);
  check.addEventListener('click', (event) => event.stopPropagation());
  check.addEventListener('change', () => {
    if (check.checked) state.selected.add(item.id);
    else state.selected.delete(item.id);
    card.classList.toggle('selected', check.checked);
    renderBatch();
    renderHead();
  });
  checkWrap.appendChild(check);

  const thumb = document.createElement('div');
  thumb.className = 'card-thumb';
  fillThumb(item, thumb);

  const badge = document.createElement('span');
  badge.className = `card-badge ${item.status}`;
  badge.textContent = STATUS_LABEL[item.status] || '素材';
  thumb.appendChild(badge);

  const foot = document.createElement('div');
  foot.className = 'card-foot';
  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = item.name || '未命名素材';
  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const star = Number(item.star || 0);
  if (star > 0) {
    const starEl = document.createElement('span');
    starEl.className = 'card-star';
    starEl.style.cssText = 'color:#f7f9f9;letter-spacing:1px;';
    starEl.textContent = '★'.repeat(star);
    starEl.title = `${star} 星`;
    meta.append(starEl);
  }
  const site = document.createElement('span');
  site.textContent = item.collection || '未归类';
  const kind = document.createElement('span');
  kind.className = 'card-kind';
  kind.textContent = `${KIND_LABEL[item.kind] || '素材'}${item.width && item.height ? ` · ${item.width}×${item.height}` : ''}`;
  meta.append(site, kind);
  foot.append(name, meta);

  card.append(checkWrap, thumb, foot);
  card.addEventListener('click', (event) => {
    if (event.target.closest('.card-check')) return;
    openDetail(item.id);
  });
  return card;
}

function renderGrid() {
  const list = filtered();
  const grid = $('#grid');
  grid.innerHTML = '';
  const slice = list.slice(0, state.limit);
  for (const item of slice) grid.appendChild(makeCard(item));
  $('#empty').hidden = list.length > 0;
  if (!list.length) {
    if (state.view === 'inbox') {
      $('#emptyTitle').textContent = 'Inbox 已经清空';
      $('#emptyDesc').textContent = '新的采集会先进入这里，再决定留在哪个项目。';
    } else {
      $('#emptyTitle').textContent = '没有匹配的素材';
      $('#emptyDesc').textContent = '试试换个关键词、项目或类型。';
    }
  }
  $('#loadMoreBtn').hidden = list.length <= state.limit;
  $('#loadMoreBtn').textContent = `加载更多（${list.length - state.limit} 项未显示）`;
  $('#resultCount').textContent = `${list.length} 项`;
  $('#clearSelectionBtn').hidden = state.selected.size === 0;
  $('#selectAllBtn').hidden = list.length === 0;
  $('#selectAllBtn').textContent = state.selected.size === list.length && list.length ? '取消全选' : '全选当前';
  renderBatch();
}

function renderBatch() {
  const count = state.selected.size;
  $('#batchBar').hidden = count === 0;
  $('#batchCount').textContent = String(count);
  const select = $('#batchProject');
  const current = select.value;
  select.innerHTML = '<option value="">移到项目…</option>';
  for (const project of state.projects) {
    const option = document.createElement('option');
    option.value = project.name;
    option.textContent = project.name;
    select.appendChild(option);
  }
  select.value = current;
}

async function updateItems(ids, payload, message = '已更新') {
  if (!ids.length) return false;
  try {
    const res = await send({ type: 'update-items', ids, ...payload });
    if (!res || res.error) throw new Error(res?.error || '更新失败');
    toast(message);
    state.selected.clear();
    await load();
    return true;
  } catch (err) {
    toast(err?.message || '更新失败', 'error');
    return false;
  }
}

function openDetail(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  closeDetail();
  state.detailId = id;

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'detailOverlay';
  overlay.addEventListener('click', closeDetail);

  const drawer = document.createElement('aside');
  drawer.className = 'drawer';
  drawer.id = 'detailDrawer';
  drawer.innerHTML = `
    <div class="drawer-head"><strong>素材详情</strong><button data-close>×</button></div>
    <div class="drawer-body">
      <div class="drawer-preview" id="detailPreview"></div>
      <h2 class="drawer-title" id="detailTitle"></h2>
      <div class="drawer-sub" id="detailSub"></div>
      <div class="field"><span>文件</span><div class="drawer-path" id="detailPath"></div></div>
      <div class="field"><span>项目</span><select id="detailProject"></select></div>
      <div class="field"><span>状态</span><div class="status-row" id="detailStatus"></div></div>
      <div class="field"><span>评分</span><div class="status-row" id="detailStar"></div></div>
      <div class="field"><span>标签</span><div class="chips" id="detailTags"></div><input id="detailTagInput" placeholder="输入后回车" /></div>
      <div class="field"><span>备注</span><textarea id="detailNote" placeholder="为什么存它？"></textarea></div>
      <div class="drawer-actions">
        <button id="detailCopy">复制路径</button>
        <button id="detailReveal">定位文件</button>
        <button id="detailSource">打开来源</button>
      </div>
      <button class="drawer-save" id="detailSave">保存修改</button>
    </div>
  `;
  document.body.append(overlay, drawer);
  drawer.querySelector('[data-close]').addEventListener('click', closeDetail);

  $('#detailTitle').textContent = item.name || '未命名素材';
  $('#detailSub').textContent = [item.site, item.pageTitle || item.sourceUrl, dateLabel(item.savedAtMs)].filter(Boolean).join(' · ');
  $('#detailPath').textContent = item.absolutePath || item.relativePath || '索引中暂无路径';

  const select = $('#detailProject');
  for (const project of state.projects) {
    const option = document.createElement('option');
    option.value = project.name;
    option.textContent = project.name;
    select.appendChild(option);
  }
  if (!state.projects.some((p) => p.name === item.collection)) {
    const option = document.createElement('option');
    option.value = item.collection || '';
    option.textContent = item.collection || '未归类';
    select.appendChild(option);
  }
  select.value = item.collection || '';

  let status = item.status;
  let star = Math.max(0, Math.min(5, Number(item.star || 0)));
  let tags = [...(item.tags || [])];
  const renderStatus = () => {
    const box = $('#detailStatus');
    box.innerHTML = '';
    for (const value of ['inbox', 'kept', 'archived']) {
      const button = document.createElement('button');
      button.textContent = STATUS_LABEL[value];
      button.className = status === value ? 'on' : '';
      button.addEventListener('click', () => { status = value; renderStatus(); });
      box.appendChild(button);
    }
  };
  const renderTags = () => {
    const box = $('#detailTags');
    box.innerHTML = '';
    tags.forEach((tag, index) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = tag;
      const remove = document.createElement('button');
      remove.textContent = '×';
      remove.addEventListener('click', () => { tags.splice(index, 1); renderTags(); });
      chip.appendChild(remove);
      box.appendChild(chip);
    });
  };
  const renderStar = () => {
    const box = $('#detailStar');
    box.innerHTML = '';
    for (let value = 1; value <= 5; value++) {
      const button = document.createElement('button');
      button.textContent = value <= star ? '★' : '☆';
      button.title = `${value} 星`;
      button.className = value <= star ? 'on' : '';
      button.addEventListener('click', () => {
        star = star === value ? 0 : value;
        renderStar();
      });
      box.appendChild(button);
    }
  };
  renderStatus();
  renderStar();
  renderTags();
  $('#detailNote').value = item.annotation || '';
  $('#detailTagInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      const value = event.target.value.trim();
      if (value && !tags.includes(value)) tags.push(value.slice(0, 48));
      event.target.value = '';
      renderTags();
    }
  });

  const preview = $('#detailPreview');
  const img = document.createElement('img');
  img.referrerPolicy = 'no-referrer';
  const cached = state.thumbUrls.get(item.id);
  const fallback = item.sourceUrl && ['image', 'screenshot'].includes(item.kind) ? item.sourceUrl : '';
  if (cached || fallback) {
    img.src = cached || fallback;
    img.onerror = () => { img.remove(); preview.innerHTML = `<div class="glyph">${KIND_GLYPH[item.kind] || '◇'}</div>`; };
    preview.appendChild(img);
  } else {
    preview.innerHTML = `<div class="glyph">${KIND_GLYPH[item.kind] || '◇'}</div>`;
    getThumb(item.id).then((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      state.thumbUrls.set(item.id, url);
      if (!$('#detailDrawer') || state.detailId !== item.id) return;
      preview.innerHTML = '';
      const next = document.createElement('img');
      next.src = url;
      preview.appendChild(next);
    }).catch(() => {});
  }

  $('#detailCopy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(item.absolutePath || item.relativePath || '');
    toast('路径已复制');
  });
  $('#detailReveal').addEventListener('click', async () => {
    const res = await send({ type: 'reveal', item });
    if (!res?.ok) toast(res?.path ? `文件位置：${res.path}` : '无法定位文件');
  });
  $('#detailSource').addEventListener('click', () => {
    const url = item.pageUrl || item.sourceUrl;
    if (!url) return toast('没有可打开的来源', 'error');
    chrome.tabs.create({ url });
  });
  $('#detailSave').addEventListener('click', async () => {
    const ok = await updateItems([item.id], {
      collection: select.value,
      status,
      star,
      tags,
      annotation: $('#detailNote').value
    }, '已保存修改');
    if (ok) closeDetail();
  });

  const esc = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeDetail(); }
  };
  document.addEventListener('keydown', esc, true);
  drawer._esc = esc;
}

function closeDetail() {
  const drawer = $('#detailDrawer');
  if (drawer?._esc) document.removeEventListener('keydown', drawer._esc, true);
  $('#detailOverlay')?.remove();
  drawer?.remove();
  state.detailId = null;
}

function triageProjectOptions(item) {
  return state.projects.map((project) => project.name).concat(
    state.projects.some((p) => p.name === item.collection) ? [] : [item.collection].filter(Boolean)
  );
}

function startTriage() {
  if (state.detailId) closeDetail();
  if (state.triage) closeTriage(false);
  const queue = state.items
    .filter((item) => item.status === 'inbox')
    .sort((a, b) => (b.savedAtMs || 0) - (a.savedAtMs || 0));
  if (!queue.length) {
    toast('Inbox 已经空了');
    return;
  }
  state.triage = { queue, index: 0, project: queue[0].collection || state.projects[0]?.name || '' };
  renderTriage();
}

function closeTriage(reload = true) {
  if (state.triage?._esc) document.removeEventListener('keydown', state.triage._esc, true);
  $('#triageRoot').innerHTML = '';
  state.triage = null;
  if (reload) load();
}

function renderTriage() {
  const triage = state.triage;
  if (!triage) return;
  if (triage._esc) {
    document.removeEventListener('keydown', triage._esc, true);
    triage._esc = null;
  }
  const root = $('#triageRoot');
  if (triage.index >= triage.queue.length) {
    root.innerHTML = '';
    state.triage = null;
    load();
    toast('Inbox 整理完成');
    return;
  }
  const item = triage.queue[triage.index];
  const projectList = triageProjectOptions(item);
  if (!projectList.includes(triage.project)) triage.project = item.collection || projectList[0] || '';

  root.innerHTML = `
    <div class="triage-overlay">
      <div class="triage-card">
        <div class="triage-visual" id="triageVisual"></div>
        <div class="triage-side">
          <div class="triage-top"><span>${triage.index + 1} / ${triage.queue.length} · 待整理</span><button id="triageClose">×</button></div>
          <h2 class="triage-title" id="triageTitle"></h2>
          <div class="triage-source" id="triageSource"></div>
          <div class="triage-meta" id="triageMeta"></div>
          <div class="triage-tags" id="triageTags"></div>
          <div class="field"><span>放进项目</span><div class="triage-projects" id="triageProjects"></div></div>
          <div class="triage-actions">
            <button class="primary" id="triageKeep">保留并整理</button>
            <div class="row">
              <button id="triageSkip">跳过</button>
              <button id="triageArchive">归档</button>
            </div>
          </div>
          <div class="triage-hint">K 保留 · A 归档 · → 跳过 · Esc 退出</div>
        </div>
      </div>
    </div>
  `;
  $('#triageTitle').textContent = item.name || '未命名素材';
  $('#triageSource').textContent = [item.site, item.pageTitle || item.sourceUrl].filter(Boolean).join(' · ');
  $('#triageMeta').textContent = [
    KIND_LABEL[item.kind] || '素材',
    item.width && item.height ? `${item.width} × ${item.height}` : '',
    dateLabel(item.savedAtMs)
  ].filter(Boolean).join(' · ');
  const triageTags = $('#triageTags');
  for (const tag of (item.tags || []).slice(0, 8)) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = tag;
    triageTags.appendChild(chip);
  }
  const visual = $('#triageVisual');
  const img = document.createElement('img');
  img.referrerPolicy = 'no-referrer';
  const src = state.thumbUrls.get(item.id) || (item.sourceUrl && ['image', 'screenshot'].includes(item.kind) ? item.sourceUrl : '');
  if (src) {
    img.src = src;
    img.onerror = () => { img.remove(); visual.innerHTML = `<div class="glyph">${KIND_GLYPH[item.kind] || '◇'}</div>`; };
    visual.appendChild(img);
  } else {
    visual.innerHTML = `<div class="glyph">${KIND_GLYPH[item.kind] || '◇'}</div>`;
  }
  const projects = $('#triageProjects');
  for (const name of projectList) {
    const button = document.createElement('button');
    button.textContent = name;
    button.className = triage.project === name ? 'on' : '';
    button.addEventListener('click', () => { triage.project = name; renderTriage(); });
    projects.appendChild(button);
  }

  const apply = async (status) => {
    if (triage.busy) return;
    triage.busy = true;
    const current = triage.queue[triage.index];
    try {
      const res = await send({
        type: 'update-items',
        ids: [current.id],
        status,
        collection: triage.project || current.collection
      });
      if (!res || res.error) throw new Error(res?.error || '更新失败');
      current.status = status;
      if (triage.project) current.collection = triage.project;
      triage.index++;
      triage.busy = false;
      renderTriage();
    } catch (err) {
      triage.busy = false;
      toast(err?.message || '更新失败', 'error');
    }
  };
  $('#triageKeep').addEventListener('click', () => apply('kept'));
  $('#triageArchive').addEventListener('click', () => apply('archived'));
  $('#triageSkip').addEventListener('click', () => { triage.index++; renderTriage(); });
  $('#triageClose').addEventListener('click', () => closeTriage());

  triage._esc = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeTriage(); }
    else if (event.key.toLowerCase() === 'k') { event.preventDefault(); apply('kept'); }
    else if (event.key.toLowerCase() === 'a') { event.preventDefault(); apply('archived'); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); triage.index++; renderTriage(); }
  };
  document.addEventListener('keydown', triage._esc, true);
}

function newProject() {
  const name = prompt('新项目 / 主题名称');
  if (!name?.trim()) return;
  send({ type: 'add-collection', name: name.trim() }).then(async (res) => {
    if (res?.error) return toast(res.error, 'error');
    await load();
    state.view = 'project';
    state.project = name.trim();
    renderSidebar(); renderHead(); renderGrid();
    toast('项目已创建');
  });
}

function downloadText(text, mime, filename) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename, saveAs: false }, () => {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
}

function exportItems(format) {
  const list = filtered();
  const selected = list.filter((i) => state.selected.has(i.id));
  const items = selected.length ? selected : list;
  if (!items.length) return toast('没有可导出的素材', 'error');
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  if (format === 'csv') {
    const header = ['id', 'name', 'kind', 'project', 'status', 'star', 'tags', 'sourceUrl', 'pageUrl', 'relativePath', 'width', 'height', 'size', 'savedAt'];
    const esc = (v) => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [header.join(',')];
    for (const item of items) {
      rows.push([
        item.id, item.name, item.kind, item.collection, item.status, Number(item.star || 0), (item.tags || []).join('|'),
        item.sourceUrl, item.pageUrl, item.relativePath, item.width, item.height, item.size, item.savedAt
      ].map(esc).join(','));
    }
    downloadText('\ufeff' + rows.join('\r\n'), 'text/csv;charset=utf-8', `Ant-col-导出-${stamp}.csv`);
  } else {
    const lines = ['# Ant-col 蚁穴 · 视觉资产导出', '', `导出时间：${new Date().toLocaleString()}`, ''];
    for (const item of items) {
      lines.push(`## ${item.name || '未命名素材'}`);
      lines.push('');
      if (item.sourceUrl) lines.push(`- 来源：${item.sourceUrl}`);
      if (item.pageUrl && item.pageUrl !== item.sourceUrl) lines.push(`- 页面：${item.pageUrl}`);
      lines.push(`- 项目：${item.collection || '未归类'} · 状态：${STATUS_LABEL[item.status] || item.status}`);
      if (item.tags?.length) lines.push(`- 标签：${item.tags.join('、')}`);
      if (Number(item.star) > 0) lines.push(`- 评分：${'★'.repeat(Number(item.star))}`);
      if (item.annotation) lines.push(`- 备注：${item.annotation}`);
      if (item.relativePath) lines.push(`- 文件：\`${item.relativePath}\``);
      lines.push('');
    }
    downloadText(lines.join('\n'), 'text/markdown;charset=utf-8', `Ant-col-导出-${stamp}.md`);
  }
  toast(`已导出 ${items.length} 项`);
}

function bind() {
  for (const button of $$('#mainNav button')) {
    button.addEventListener('click', () => {
      state.view = button.dataset.view;
      state.project = '';
      state.tag = '';
      state.limit = 120;
      state.selected.clear();
      renderSidebar(); renderHead(); renderGrid();
    });
  }
  $('#triageBtn').addEventListener('click', startTriage);
  $('#newProjectBtn').addEventListener('click', newProject);
  $('#settingsBtn').addEventListener('click', () => send({ type: 'open-options' }));
  $('#openFolderBtn').addEventListener('click', async () => {
    const res = await send({ type: 'show-default-folder' });
    if (!res?.ok) toast('当前是素材库文件夹模式，请到设置页打开或复制路径');
  });
  $('#refreshBtn').addEventListener('click', load);
  $('#loadMoreBtn').addEventListener('click', () => { state.limit += 120; renderGrid(); });
  $('#selectAllBtn').addEventListener('click', () => {
    const list = filtered();
    if (state.selected.size === list.length && list.length) state.selected.clear();
    else for (const item of list) state.selected.add(item.id);
    renderGrid();
  });
  $('#clearSelectionBtn').addEventListener('click', () => { state.selected.clear(); renderGrid(); });
  $('#batchClearBtn').addEventListener('click', () => { state.selected.clear(); renderGrid(); });
  $('#batchProject').addEventListener('change', async (event) => {
    const project = event.target.value;
    if (!project) return;
    await updateItems([...state.selected], { collection: project }, '已更新项目归类（文件仍在原路径）');
  });
  $('#batchTagBtn').addEventListener('click', async () => {
    const tag = prompt('给选中素材加一个标签');
    if (!tag?.trim()) return;
    await updateItems([...state.selected], { addTags: [tag.trim()] }, '标签已添加');
  });
  $('#batchStar').addEventListener('change', async (event) => {
    const value = event.target.value;
    event.target.value = '';
    if (value === '') return;
    await updateItems([...state.selected], { star: Number(value) }, value === '0' ? '评分已清除' : '评分已更新');
  });
  $('#batchKeepBtn').addEventListener('click', () => updateItems([...state.selected], { status: 'kept' }, '已标记为已整理'));
  $('#batchArchiveBtn').addEventListener('click', () => updateItems([...state.selected], { status: 'archived' }, '已归档'));
  $('#exportMdBtn').addEventListener('click', () => exportItems('md'));
  $('#exportCsvBtn').addEventListener('click', () => exportItems('csv'));
  const search = $('#searchInput');
  let searchTimer = null;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = search.value.trim();
      state.limit = 120;
      state.selected.clear();
      renderHead(); renderGrid();
    }, 120);
  });
  $('#kindFilter').addEventListener('change', (event) => {
    state.kind = event.target.value;
    state.limit = 120;
    state.selected.clear();
    renderHead(); renderGrid();
  });
  $('#sortSelect').addEventListener('change', (event) => {
    state.sort = event.target.value;
    renderGrid();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) {
      event.preventDefault();
      search.focus();
    }
  });
  window.addEventListener('beforeunload', () => {
    for (const url of state.thumbUrls.values()) URL.revokeObjectURL(url);
  });
}

(async function init() {
  bind();
  await load();
  if (new URLSearchParams(location.search).has('test')) {
    window.__antColLibrary = { state, load, filtered, openDetail, startTriage, updateItems, exportItems };
  }
})();
