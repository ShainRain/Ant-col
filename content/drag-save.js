(() => {
  if (window.__antColDragLoaded) return;
  window.__antColDragLoaded = true;

  let dragged = null;
  let dragActive = false;
  let quickCache = null;
  let quickAt = 0;

  let dropHost = null;
  let dropCard = null;
  let dropShadow = null;
  let hideDropTimer = null;

  let panelHost = null;
  let panelShadow = null;
  let panelState = null;
  let panelEsc = null;
  let panelCloseTimer = null;

  let chooserHost = null;
  let chooserState = null;
  let chooserEsc = null;

  const DEFAULT_COLLECTION = '灵感收集';
  const COLLECTIONS = () => {
    const list = Array.isArray(quickCache?.collections) && quickCache.collections.length
      ? quickCache.collections
      : [DEFAULT_COLLECTION];
    return [...new Set(list.map((s) => String(s || '').trim()).filter(Boolean))];
  };
  const DEFAULT_NAME = () => quickCache?.defaultCollection || COLLECTIONS()[0] || DEFAULT_COLLECTION;

  const abs = (url) => {
    try { return new URL(url, location.href).href; } catch { return url; }
  };
  const hostOf = (url) => {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return '网页'; }
  };
  const isEditable = (el) => !!el?.closest?.('[contenteditable="true"],[contenteditable=""],[contenteditable="plaintext-only"]');

  function describe(target) {
    const el = target?.nodeType === 1 ? target : target?.parentElement;
    if (!el || isEditable(el)) return null;

    const img = el.closest('img');
    if (img) {
      const src = img.currentSrc || img.src;
      if (!src) return null;
      const anchor = img.closest('a');
      const link = anchor?.href && /^(https?:|file:)/i.test(anchor.href) ? abs(anchor.href) : '';
      return {
        kind: 'image',
        url: abs(src),
        previewUrl: abs(src),
        title: img.alt || img.title || '',
        alt: img.alt || '',
        width: img.naturalWidth || 0,
        height: img.naturalHeight || 0,
        linkUrl: link,
        anchorTitle: (anchor?.textContent || '').trim(),
        pageUrl: location.href,
        pageTitle: document.title
      };
    }

    const video = el.closest('video');
    if (video) {
      const src = video.currentSrc || video.src;
      const poster = video.poster ? abs(video.poster) : '';
      if (!src && !poster) return null;
      const playable = src && !src.startsWith('blob:');
      return {
        kind: playable ? 'video' : 'image',
        url: playable ? abs(src) : poster,
        previewUrl: poster || (playable ? abs(src) : ''),
        title: video.title || (playable ? '' : '视频封面'),
        alt: '',
        width: video.videoWidth || 0,
        height: video.videoHeight || 0,
        linkUrl: '',
        pageUrl: location.href,
        pageTitle: document.title
      };
    }

    const a = el.closest('a');
    if (a?.href && /^(https?:|file:)/i.test(a.href)) {
      const inner = a.querySelector('img');
      return {
        kind: 'link',
        url: abs(a.href),
        linkUrl: abs(a.href),
        previewUrl: inner ? abs(inner.currentSrc || inner.src) : '',
        title: (a.textContent || '').trim() || a.title || '',
        alt: '',
        width: inner?.naturalWidth || 0,
        height: inner?.naturalHeight || 0,
        pageUrl: location.href,
        pageTitle: document.title
      };
    }

    return null;
  }

  async function loadQuick(force = false) {
    if (!force && quickCache && Date.now() - quickAt < 15000) return quickCache;
    try {
      const state = await chrome.runtime.sendMessage({ type: 'quick-state' });
      if (state && !state.error) {
        quickCache = state;
        quickAt = Date.now();
      }
    } catch { /* ignore */ }
    return quickCache;
  }

  // ---------- drag start / dock page ----------

  function onDragStart(event) {
    if (!event.dataTransfer) return;
    if (event.target?.closest?.('#ant-col-drop-host,#ant-col-drag-panel-host,#ant-col-folder-chooser-host')) return;
    const item = describe(event.target);
    if (!item) return;
    dragged = item;
    dragActive = true;
    try { event.dataTransfer.setData('application/x-ant-col-item', JSON.stringify(item)); } catch { /* ignore */ }
    try { event.dataTransfer.effectAllowed = 'copyMove'; } catch { /* ignore */ }
    loadQuick();
    setTimeout(() => {
      if (dragged === item && dragActive) showDropPage(item);
    }, 30);
  }

  function onDragEnd() {
    dragActive = false;
    setTimeout(() => {
      if (!panelHost && !chooserHost) hideDropPage();
    }, 140);
  }

  document.addEventListener('dragstart', onDragStart, true);
  document.addEventListener('dragend', onDragEnd, true);
  window.addEventListener('blur', () => { if (!panelHost && !chooserHost) hideDropPage(); });

  function folderIcon(size = 16) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="M3 6.75A2.75 2.75 0 0 1 5.75 4h4.1c.7 0 1.36.27 1.86.76L13 6h5.25A2.75 2.75 0 0 1 21 8.75v8.5A2.75 2.75 0 0 1 18.25 20H5.75A2.75 2.75 0 0 1 3 17.25V6.75Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  }

  function ensureDropPage() {
    if (dropHost?.isConnected) return;
    dropHost = document.createElement('div');
    dropHost.id = 'ant-col-drop-host';
    dropHost.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;display:none;';
    dropShadow = dropHost.attachShadow({ mode: 'open' });
    dropShadow.innerHTML = `
      <style>
        :host { all: initial; }
        .wrap {
          position: fixed; inset: 0; display: grid; place-items: center;
          pointer-events: none;
        }
        .card {
          width: min(540px, calc(100vw - 36px));
          min-height: 292px;
          background: #08090a;
          color: #f7f9f9;
          border: 1px solid rgba(255,255,255,.14);
          border-radius: 7px;
          box-shadow: 0 30px 90px rgba(0,0,0,.42), 0 2px 0 rgba(255,255,255,.8) inset;
          display: flex;
          padding: 10px;
          gap: 8px;
          box-sizing: border-box;
          pointer-events: none;
          opacity: 0;
          transform: translateY(10px) scale(.985);
          transition: opacity .16s ease, transform .18s cubic-bezier(.2,.8,.2,1);
          font: 12px/1.45 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
        }
        .card.show { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
        .left {
          width: 57%;
          border: 1px dashed #727a7e;
          border-radius: 5px;
          background: #111315;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 12px;
          box-sizing: border-box;
          transition: background .14s, border-color .14s;
          cursor: copy;
        }
        .left.over, .folder-item.over {
          background: rgba(255,255,255, .14);
          border-color: #f7f9f9 !important;
        }
        .art { width: 104px; height: 84px; color: #727a7e; }
        .hint { font-size: 10.5px; color: #a4aaad; text-align: center; line-height: 1.55; }
        .hint b { display: block; color: #f7f9f9; font-size: 12px; margin-top: 2px; font-weight: 650; }
        .right {
          width: 43%;
          display: flex;
          flex-direction: column;
          min-width: 0;
          padding: 3px 2px;
        }
        .list-title {
          font-size: 9px; letter-spacing: .12em; color: #727a7e;
          padding: 4px 8px 5px; text-transform: uppercase;
        }
        .folders {
          flex: 1; overflow-y: auto; min-height: 0; padding-right: 2px;
          scrollbar-width: thin;
        }
        .folder-item {
          display: flex; align-items: center; gap: 7px;
          height: 32px; padding: 0 8px; border-radius: 5px;
          color: #a4aaad; font-size: 11px; cursor: copy;
          border: 1px solid transparent;
          transition: background .12s, color .12s, border-color .12s;
        }
        .folder-item:hover { background: #191c1f; color: #f7f9f9; }
        .folder-item .ico { display: inline-flex; color: #a4aaad; }
        .folder-item.over .ico { color: #f7f9f9; }
        .folder-item .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .folder-item .badge {
          margin-left: auto; font-size: 8px; letter-spacing: .08em; color: #c8ccce;
          border: 1px solid rgba(255,255,255,.18); border-radius: 999px; padding: 1px 5px;
        }
        .empty { color: #c8ccce; font-size: 10px; padding: 10px 8px; }
        .choose {
          display: flex; align-items: center; gap: 7px;
          padding: 11px 8px 4px; margin-top: 6px;
          border-top: 1px solid #2a2e31;
          color: #a4aaad; font-size: 10.5px; cursor: copy;
          border-radius: 0 0 7px 7px;
          transition: color .12s, background .12s;
        }
        .choose:hover, .choose.over { color: #f7f9f9; background: #191c1f; }
        .plus {
          width: 17px; height: 17px; border-radius: 50%; border: 1px solid currentColor;
          display: grid; place-items: center; font-size: 13px; line-height: 1; flex: 0 0 auto;
        }
      </style>
      <div class="wrap">
        <div class="card" data-drop="collection" data-collection="">
          <div class="left" data-drop="collection" data-collection="">
            <svg class="art" viewBox="0 0 120 96" fill="none" aria-hidden="true">
              <path d="M14 30c0-4.4 3.6-8 8-8h22l8 8h48c4.4 0 8 3.6 8 8v38c0 4.4-3.6 8-8 8H22c-4.4 0-8-3.6-8-8V30Z" fill="#ffffff" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
              <path d="M14 38h92" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
              <circle cx="61" cy="60" r="18" stroke="currentColor" stroke-width="2.2"/>
              <path d="M61 42c-6 5-9 11-9 18s3 13 9 18M61 42c6 5 9 11 9 18s-3 13-9 18M44 60h34" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            <div class="hint">拖拽到这里添加到<b class="target">灵感收集</b></div>
          </div>
          <div class="right">
            <div class="list-title">收藏夹</div>
            <div class="folders"></div>
            <div class="choose" data-drop="choose">
              <span class="plus">＋</span><span>建立或选择文件夹</span>
            </div>
          </div>
        </div>
      </div>
    `;
    dropCard = dropShadow.querySelector('.card');
    document.documentElement.appendChild(dropHost);

    dropCard.addEventListener('dragover', (event) => {
      if (!dragged) return;
      event.preventDefault();
      event.stopPropagation();
      try { event.dataTransfer.dropEffect = 'copy'; } catch { /* ignore */ }
      const target = event.target.closest('[data-drop]');
      dropShadow.querySelectorAll('.over').forEach((el) => el.classList.remove('over'));
      if (target) target.classList.add('over');
    });
    dropCard.addEventListener('dragleave', (event) => {
      if (event.target === dropCard) {
        dropShadow.querySelectorAll('.over').forEach((el) => el.classList.remove('over'));
      }
    });
    dropCard.addEventListener('drop', (event) => {
      if (!dragged) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.target.closest('[data-drop]');
      dropShadow.querySelectorAll('.over').forEach((el) => el.classList.remove('over'));
      if (!target) return;
      const item = dragged;
      if (target.dataset.drop === 'choose') {
        hideDropPage();
        showFolderChooser(item, (name) => openPanel(item, name));
        return;
      }
      const name = target.dataset.collection || DEFAULT_NAME();
      hideDropPage();
      openPanel(item, name);
    });
  }

  function renderDropCollections() {
    if (!dropShadow) return;
    const collections = COLLECTIONS();
    const defaultName = DEFAULT_NAME();
    const target = dropShadow.querySelector('.target');
    if (target) target.textContent = defaultName;
    const card = dropShadow.querySelector('.card');
    if (card) card.dataset.collection = defaultName;
    const left = dropShadow.querySelector('.left');
    if (left) left.dataset.collection = defaultName;
    const folders = dropShadow.querySelector('.folders');
    if (!folders) return;
    folders.innerHTML = '';
    if (!collections.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '还没有收藏夹';
      folders.appendChild(empty);
      return;
    }
    for (const name of collections) {
      const item = document.createElement('div');
      item.className = 'folder-item';
      item.dataset.drop = 'collection';
      item.dataset.collection = name;
      item.innerHTML = `<span class="ico">${folderIcon(15)}</span><span class="name"></span>${name === defaultName ? '<span class="badge">默认</span>' : ''}`;
      item.querySelector('.name').textContent = name;
      folders.appendChild(item);
    }
  }

  function showDropPage(item) {
    ensureDropPage();
    clearTimeout(hideDropTimer);
    renderDropCollections();
    loadQuick().then(() => renderDropCollections());
    dropHost.style.display = 'block';
    dropCard.classList.add('show');
    // 拖拽页不显示素材缩略图，保留原生拖拽影像
    void item;
  }

  function hideDropPage() {
    if (!dropHost) return;
    dropCard?.classList.remove('show');
    clearTimeout(hideDropTimer);
    hideDropTimer = setTimeout(() => {
      if (!panelHost && !chooserHost && dropHost) dropHost.style.display = 'none';
    }, 170);
  }

  // ---------- folder chooser ----------

  function closeChooser(immediate = false) {
    if (!chooserHost) return;
    if (chooserEsc) {
      document.removeEventListener('keydown', chooserEsc, true);
      chooserEsc = null;
    }
    const host = chooserHost;
    chooserHost = null;
    chooserState = null;
    if (immediate) host.remove();
    else {
      host.style.opacity = '0';
      host.style.transition = 'opacity .12s';
      setTimeout(() => host.remove(), 130);
    }
  }

  function showFolderChooser(item, onSelect) {
    closeChooser(true);
    const collections = COLLECTIONS();
    let selected = DEFAULT_NAME();
    if (!collections.includes(selected)) selected = collections[0] || DEFAULT_COLLECTION;

    chooserHost = document.createElement('div');
    chooserHost.id = 'ant-col-folder-chooser-host';
    chooserHost.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
    const shadow = chooserHost.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .backdrop { position: fixed; inset: 0; background: rgba(8,9,10, .36); backdrop-filter: blur(3px); }
        .card {
          position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
          width: min(380px, calc(100vw - 32px)); background: #08090a; color: #f7f9f9;
          border: 1px solid rgba(255,255,255,.14); border-radius: 7px; box-shadow: 0 28px 80px rgba(0,0,0,.4);
          padding: 16px; box-sizing: border-box;
          font: 12px/1.45 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
        }
        h3 { margin: 0 0 3px; font-size: 14px; letter-spacing: -.01em; }
        .sub { color: #a4aaad; font-size: 10.5px; margin-bottom: 12px; }
        .rows { display: flex; flex-direction: column; gap: 4px; max-height: 190px; overflow-y: auto; }
        .row {
          display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 9px;
          border: 1px solid transparent; border-radius: 8px; color: #727a7e; cursor: pointer;
        }
        .row:hover { background: #191c1f; color: #f7f9f9; }
        .row.on { background: rgba(255,255,255, .14); border-color: #f7f9f9; color: #f7f9f9; }
        .row .ico { color: #a4aaad; display: inline-flex; }
        .row.on .ico { color: #f7f9f9; }
        .row .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sep { height: 1px; background: #2a2e31; margin: 10px 0; }
        input {
          width: 100%; box-sizing: border-box; border: 1px solid rgba(255,255,255,.14); background: #111315; color: #f7f9f9;
          border-radius: 8px; padding: 8px 10px; font: inherit; font-size: 11.5px; outline: none;
        }
        input:focus { border-color: #f7f9f9; box-shadow: 0 0 0 2px rgba(255,255,255, .14); }
        .actions { display: flex; gap: 8px; margin-top: 12px; }
        .actions button { border: 0; border-radius: 8px; padding: 9px 12px; font: inherit; font-size: 11.5px; cursor: pointer; }
        .cancel { background: #191c1f; color: #727a7e; }
        .ok { flex: 1; background: #f7f9f9; color: #08090a; font-weight: 650; }
        .status { min-height: 14px; margin-top: 7px; font-size: 10px; color: #ffffff; }
      </style>
      <div class="backdrop" data-act="cancel"></div>
      <div class="card">
        <h3>选择收藏夹</h3>
        <div class="sub">素材会保存到所选收藏夹下</div>
        <div class="rows"></div>
        <div class="sep"></div>
        <input class="new" placeholder="或输入新收藏夹名称" maxlength="40" />
        <div class="status"></div>
        <div class="actions">
          <button class="cancel" data-act="cancel">取消</button>
          <button class="ok" data-act="ok">保存到所选收藏夹</button>
        </div>
      </div>
    `;
    document.documentElement.appendChild(chooserHost);

    const rows = shadow.querySelector('.rows');
    const input = shadow.querySelector('.new');
    const status = shadow.querySelector('.status');
    const draw = () => {
      rows.innerHTML = '';
      collections.forEach((name) => {
        const row = document.createElement('div');
        row.className = `row${name === selected ? ' on' : ''}`;
        row.innerHTML = `<span class="ico">${folderIcon(15)}</span><span class="name"></span>`;
        row.querySelector('.name').textContent = name;
        row.addEventListener('click', () => {
          selected = name;
          input.value = '';
          draw();
        });
        rows.appendChild(row);
      });
    };
    draw();

    const cancel = () => closeChooser();
    shadow.querySelectorAll('[data-act="cancel"]').forEach((el) => el.addEventListener('click', cancel));
    shadow.querySelector('[data-act="ok"]').addEventListener('click', async () => {
      let name = input.value.trim() || selected;
      if (!name) {
        status.textContent = '请输入收藏夹名称';
        return;
      }
      if (!COLLECTIONS().includes(name)) {
        status.textContent = '正在创建收藏夹…';
        try {
          const res = await chrome.runtime.sendMessage({ type: 'add-collection', name });
          if (res?.error) throw new Error(res.error);
          if (Array.isArray(res?.collections)) {
            quickCache = { ...(quickCache || {}), collections: res.collections };
            quickAt = Date.now();
          }
        } catch (err) {
          status.textContent = err?.message || '创建收藏夹失败';
          return;
        }
      }
      closeChooser();
      onSelect(name);
    });

    chooserEsc = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeChooser();
      }
    };
    document.addEventListener('keydown', chooserEsc, true);
    setTimeout(() => input.focus(), 40);
    void item;
  }

  // ---------- save panel ----------

  function targetLabel(collection) {
    const root = quickCache?.root;
    const settings = quickCache?.settings || {};
    const useFolder = root && settings.targetMode !== 'downloads';
    const base = useFolder
      ? (root.permission === 'granted' ? root.name : `${root.name}（需授权）`)
      : `下载 / ${settings.downloadsSubfolder || 'Ant-col素材'}`;
    if (!collection || collection === DEFAULT_NAME()) return base;
    return `${base} / ${collection}`;
  }

  function closePanel(immediate = false) {
    if (panelEsc) {
      document.removeEventListener('keydown', panelEsc, true);
      panelEsc = null;
    }
    clearTimeout(panelCloseTimer);
    panelCloseTimer = null;
    closeChooser(true);
    if (!panelHost) return;
    const host = panelHost;
    panelHost = null;
    panelShadow = null;
    panelState = null;
    if (immediate) host.remove();
    else {
      host.style.opacity = '0';
      host.style.transition = 'opacity .12s';
      setTimeout(() => host.remove(), 130);
    }
  }

  function openPanel(item, collectionName) {
    closePanel(true);
    const collections = COLLECTIONS();
    let collection = String(collectionName || DEFAULT_NAME());
    if (!collections.includes(collection)) collection = DEFAULT_NAME();

    panelState = {
      item,
      mode: item.kind === 'link' ? 'link' : 'image',
      tags: [],
      titleEdited: false,
      collection,
      busy: false
    };

    panelHost = document.createElement('div');
    panelHost.id = 'ant-col-drag-panel-host';
    panelHost.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
    panelShadow = panelHost.attachShadow({ mode: 'open' });
    panelShadow.innerHTML = `
      <style>
        :host { all: initial; }
        .backdrop { position: fixed; inset: 0; background: rgba(8,9,10, .42); backdrop-filter: blur(3px); }
        .panel {
          position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
          width: min(440px, calc(100vw - 30px)); max-height: min(88vh, 760px); overflow-y: auto;
          background: #08090a; color: #f7f9f9;
          border: 1px solid rgba(255,255,255,.14);
          border-radius: 7px;
          box-shadow: 0 30px 90px rgba(0,0,0,.42);
          padding: 16px; box-sizing: border-box;
          font: 13px/1.45 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
        }
        .phead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .brand { display: flex; align-items: center; gap: 7px; font-size: 12px; letter-spacing: .06em; }
        .brand .dot { width: 9px; height: 9px; border-radius: 2px; background: #f7f9f9; }
        .brand b { font-size: 13px; letter-spacing: .02em; }
        .brand .crumb { color: #a4aaad; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; }
        .x { border: 0; background: transparent; color: #a4aaad; font-size: 22px; line-height: 1; width: 30px; height: 30px; border-radius: 5px; cursor: pointer; }
        .x:hover { background: #191c1f; color: #f7f9f9; }
        .preview {
          position: relative; height: 158px; border-radius: 10px; overflow: hidden;
          background: #111315;
          background-image: linear-gradient(45deg, rgba(0,0,0,.03) 25%, transparent 25%, transparent 75%, rgba(0,0,0,.03) 75%), linear-gradient(45deg, rgba(0,0,0,.03) 25%, transparent 25%, transparent 75%, rgba(0,0,0,.03) 75%);
          background-size: 18px 18px; background-position: 0 0, 9px 9px;
          display: grid; place-items: center; margin-bottom: 12px;
        }
        .preview img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
        .glyph { font-size: 34px; color: #727a7e; }
        .linkbadge {
          position: absolute; left: 9px; top: 9px; font-size: 9px; letter-spacing: .12em;
          background: rgba(17,19,21, .82); color: #ffffff; border-radius: 999px; padding: 3px 8px;
        }
        .dims {
          position: absolute; right: 9px; bottom: 9px; font-size: 9px;
          background: rgba(17,19,21, .72); color: #ffffff; border-radius: 6px; padding: 3px 6px;
        }
        .field { display: flex; flex-direction: column; gap: 5px; margin-top: 10px; }
        .field > span { font-size: 9.5px; letter-spacing: .1em; color: #a4aaad; text-transform: uppercase; }
        input.title, textarea.note {
          width: 100%; box-sizing: border-box; border: 1px solid rgba(255,255,255,.14); background: #111315; color: #f7f9f9;
          border-radius: 5px; padding: 8px 10px; font: inherit; outline: none;
        }
        input.title { font-size: 13px; font-weight: 600; }
        textarea.note { resize: vertical; min-height: 42px; max-height: 120px; font-size: 12px; }
        input.title:focus, textarea.note:focus, .tagbox:focus-within { border-color: #f7f9f9; box-shadow: 0 0 0 2px rgba(255,255,255, .14); }
        .modes { display: flex; gap: 6px; margin-top: 9px; }
        .modes button {
          flex: 1; border: 1px solid rgba(255,255,255,.14); background: #111315; color: #a4aaad;
          border-radius: 5px; padding: 7px 8px; font-size: 11px; cursor: pointer;
        }
        .modes button.on { border-color: #f7f9f9; background: rgba(255,255,255, .14); color: #f7f9f9; font-weight: 650; }
        .modes[hidden] { display: none; }
        .tagbox {
          display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
          border: 1px solid rgba(255,255,255,.14); background: #111315; border-radius: 5px; padding: 4px 6px;
        }
        .chips { display: flex; flex-wrap: wrap; gap: 4px; }
        .chip {
          display: inline-flex; align-items: center; gap: 4px; background: rgba(255,255,255, .14);
          color: #fff; border-radius: 4px; padding: 2px 6px; font-size: 10.5px;
        }
        .chip button { border: 0; background: none; color: inherit; padding: 0; cursor: pointer; opacity: .7; }
        .tagin { border: 0; background: transparent; padding: 3px 0; flex: 1; min-width: 90px; font-size: 11px; outline: none; box-shadow: none !important; }
        .suggest { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
        .suggest button {
          border: 1px solid rgba(255,255,255,.14); background: transparent; color: #a4aaad;
          border-radius: 999px; padding: 2px 8px; font-size: 10px; cursor: pointer;
        }
        .suggest button:hover { border-color: #f7f9f9; color: #fff; }
        .dest {
          display: flex; align-items: center; gap: 7px; margin-top: 12px; padding: 8px 10px;
          background: #111315; border: 1px solid rgba(255,255,255,.14); border-radius: 5px; font-size: 10.5px; color: #a4aaad;
        }
        .dest b { color: #f7f9f9; font-weight: 600; max-width: 230px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .dest .change { margin-left: auto; border: 0; background: transparent; color: #f7f9f9; font-size: 10px; cursor: pointer; text-decoration: underline; }
        .status { min-height: 18px; margin-top: 8px; font-size: 10.5px; color: #ffffff; }
        .status.ok { color: #f7f9f9; }
        .actions { display: flex; gap: 8px; margin-top: 4px; }
        .actions button { border: 0; border-radius: 5px; padding: 10px 14px; font: inherit; font-size: 12px; cursor: pointer; }
        .cancel { background: #191c1f; color: #f7f9f9; }
        .save { flex: 1; background: #f7f9f9; color: #08090a; font-weight: 650; }
        .save:disabled { opacity: .45; cursor: default; box-shadow: none; }
      </style>
      <div class="backdrop" data-act="close"></div>
      <div class="panel" role="dialog" aria-modal="true" aria-label="保存到素材库">
        <div class="phead">
          <div class="brand"><span class="dot"></span><b>Ant-col</b><span class="crumb">保存素材</span></div>
          <button class="x" data-act="close" title="关闭">×</button>
        </div>
        <div class="preview">
          <img class="pimg" alt="" hidden />
          <div class="glyph">◨</div>
          <div class="linkbadge" hidden>链接卡片</div>
          <div class="dims" hidden></div>
        </div>
        <label class="field"><span>名称</span><input class="title" maxlength="120" /></label>
        <div class="modes" hidden>
          <button data-mode="image">保存图片</button>
          <button data-mode="link">保存为链接卡片</button>
        </div>
        <div class="field">
          <span>标签</span>
          <div class="tagbox"><div class="chips"></div><input class="tagin" placeholder="输入后回车" /></div>
        </div>
        <div class="suggest"></div>
        <label class="field"><span>备注</span><textarea class="note" rows="2" placeholder="可选"></textarea></label>
        <div class="dest"><span>收藏夹</span><b class="collection"></b><button class="change">更换</button></div>
        <div class="status"></div>
        <div class="actions">
          <button class="cancel" data-act="close">取消</button>
          <button class="save" data-act="save">保存到素材库</button>
        </div>
      </div>
    `;
    document.documentElement.appendChild(panelHost);

    const q = (sel) => panelShadow.querySelector(sel);
    const img = q('.pimg');
    const glyph = q('.glyph');
    const badge = q('.linkbadge');
    const dims = q('.dims');
    const title = q('.title');
    const modes = q('.modes');
    const chips = q('.chips');
    const tagIn = q('.tagin');
    const suggest = q('.suggest');
    const note = q('.note');
    const collectionEl = q('.collection');
    const status = q('.status');
    const saveBtn = q('.save');

    const setStatus = (text, ok = false) => {
      status.textContent = text || '';
      status.className = `status${ok ? ' ok' : ''}`;
    };
    const setPreview = () => {
      const preview = panelState.item.previewUrl || (panelState.item.kind !== 'link' ? panelState.item.url : '');
      if (preview) {
        img.src = preview;
        img.hidden = false;
        glyph.hidden = true;
        img.onerror = () => { img.hidden = true; glyph.hidden = false; };
      } else {
        img.hidden = true;
        glyph.hidden = false;
        glyph.textContent = panelState.mode === 'link' ? '↗' : panelState.item.kind === 'video' ? '▶' : '◨';
      }
      const w = panelState.item.width;
      const h = panelState.item.height;
      if (w && h) {
        dims.textContent = `${w} × ${h}`;
        dims.hidden = false;
      } else {
        dims.hidden = true;
      }
    };
    const updateDest = () => {
      collectionEl.textContent = panelState.collection;
      collectionEl.title = targetLabel(panelState.collection);
      saveBtn.textContent = `保存到「${panelState.collection}」`;
    };
    const setMode = (mode) => {
      if (mode === 'link' && !panelState.item.linkUrl) return;
      panelState.mode = mode;
      badge.hidden = mode !== 'link';
      glyph.textContent = mode === 'link' ? '↗' : panelState.item.kind === 'video' ? '▶' : '◨';
      panelShadow.querySelectorAll('[data-mode]').forEach((button) => button.classList.toggle('on', button.dataset.mode === mode));
      if (!panelState.titleEdited) {
        const next = mode === 'link'
          ? (panelState.item.anchorTitle || panelState.item.title || panelState.item.pageTitle || '')
          : (panelState.item.title || panelState.item.alt || panelState.item.pageTitle || '');
        if (next) title.value = next;
      }
      setPreview();
    };
    const renderTags = () => {
      chips.innerHTML = '';
      for (const tag of panelState.tags) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = tag;
        const remove = document.createElement('button');
        remove.textContent = '×';
        remove.title = '移除';
        remove.addEventListener('click', () => {
          panelState.tags = panelState.tags.filter((t) => t !== tag);
          renderTags();
        });
        chip.appendChild(remove);
        chips.appendChild(chip);
      }
    };
    const addTag = (raw) => {
      for (const part of String(raw || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean)) {
        if (!panelState.tags.includes(part) && panelState.tags.length < 12) panelState.tags.push(part.slice(0, 48));
      }
      renderTags();
    };
    const renderSuggestions = () => {
      suggest.innerHTML = '';
      const tags = quickCache?.allTags || [];
      for (const tag of tags.slice(0, 12)) {
        if (panelState.tags.includes(tag.name)) continue;
        const button = document.createElement('button');
        button.textContent = tag.name;
        button.addEventListener('click', () => {
          addTag(tag.name);
          renderSuggestions();
        });
        suggest.appendChild(button);
      }
    };

    const close = () => closePanel();
    panelShadow.querySelectorAll('[data-act="close"]').forEach((el) => el.addEventListener('click', close));
    q('.change').addEventListener('click', () => {
      showFolderChooser(panelState.item, (name) => {
        panelState.collection = name;
        updateDest();
        setStatus('');
      });
    });
    panelShadow.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));

    title.addEventListener('input', () => { panelState.titleEdited = true; });
    tagIn.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        addTag(tagIn.value);
        tagIn.value = '';
        renderSuggestions();
      } else if (event.key === 'Backspace' && !tagIn.value && panelState.tags.length) {
        panelState.tags.pop();
        renderTags();
        renderSuggestions();
      }
    });
    tagIn.addEventListener('blur', () => {
      if (tagIn.value.trim()) {
        addTag(tagIn.value);
        tagIn.value = '';
        renderSuggestions();
      }
    });

    const doSave = async () => {
      const state = panelState;
      if (!state || state.busy) return;
      const item = state.item;
      const mode = state.mode;
      const finalTitle = (title.value || '').trim() || item.title || item.alt || item.pageTitle || '未命名素材';
      const payload = {
        kind: mode === 'link' ? 'link' : item.kind,
        url: mode === 'link' ? item.linkUrl : item.url,
        linkUrl: item.linkUrl || '',
        title: finalTitle,
        alt: item.alt || '',
        width: item.width || 0,
        height: item.height || 0,
        pageUrl: item.pageUrl || location.href,
        pageTitle: item.pageTitle || document.title
      };
      state.busy = true;
      saveBtn.disabled = true;
      saveBtn.textContent = '保存中…';
      setStatus('正在下载并写入素材库…');
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'save',
          items: [payload],
          meta: { tags: state.tags.slice(), note: note.value.trim(), collection: state.collection }
        });
        if (!response || response.error) throw new Error(response?.error || '保存失败');
        const result = response.items?.[0];
        if (!result) throw new Error('保存失败');
        if (result.status === 'saved') {
          setStatus(`已保存${result.item?.relativePath ? ` · ${result.item.relativePath}` : ''}`, true);
          saveBtn.textContent = '已保存';
          clearTimeout(panelCloseTimer);
          panelCloseTimer = setTimeout(() => closePanel(), 950);
          return;
        }
        if (result.status === 'duplicate') {
          setStatus(`这个收藏夹里已有相同内容${result.existing?.relativePath ? ` · ${result.existing.relativePath}` : ''}`);
        } else {
          setStatus(result.error || '保存失败');
        }
      } catch (err) {
        setStatus(err?.message || '保存失败');
      } finally {
        if (state && !saveBtn.textContent.includes('已保存')) {
          state.busy = false;
          saveBtn.disabled = false;
          if (panelState === state) updateDest();
        }
      }
    };
    saveBtn.addEventListener('click', doSave);

    title.value = panelState.mode === 'link'
      ? (panelState.item.anchorTitle || panelState.item.title || panelState.item.pageTitle || '')
      : (panelState.item.title || panelState.item.alt || panelState.item.pageTitle || '');
    modes.hidden = !(panelState.item.kind === 'image' && panelState.item.linkUrl);
    if (!modes.hidden) setMode('image');
    else setMode(panelState.item.kind === 'link' ? 'link' : 'image');
    renderTags();
    updateDest();
    setPreview();
    setStatus('');
    loadQuick().then(() => {
      if (!panelState) return;
      renderSuggestions();
      updateDest();
    });

    setTimeout(() => title.focus(), 40);
    panelEsc = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (chooserHost) closeChooser();
        else closePanel();
      }
    };
    document.addEventListener('keydown', panelEsc, true);
  }
})();
