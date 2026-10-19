(() => {
  if (window.__antColVaultLoaded) return;
  window.__antColVaultLoaded = true;

  let lastPoint = { x: 0, y: 0 };
  let lastElement = null;
  let lastItem = null;
  let lastItemAt = 0;
  let captureActive = false;

  const MIN_SIZE = 24;

  function absolute(url) {
    try { return new URL(url, location.href).href; } catch { return url; }
  }

  function parseBackground(value) {
    if (!value || value === 'none') return '';
    const match = value.match(/url\((['"]?)(.*?)\1\)/i);
    if (!match) return '';
    return absolute(match[2]);
  }

  function fromImage(img) {
    const api = window.AntColExtract;
    const best = api?.bestImageSource ? api.bestImageSource(img) : null;
    const src = best?.src || img.currentSrc || img.src;
    if (!src || src.startsWith('blob:')) return null;
    if (img.naturalWidth && img.naturalWidth < MIN_SIZE && img.naturalHeight && img.naturalHeight < MIN_SIZE) return null;
    return {
      url: absolute(src),
      kind: 'image',
      title: (api?.bestTitleFromElement ? api.bestTitleFromElement(img, document.title) : '') || img.title || img.alt || '',
      alt: img.alt || '',
      width: img.naturalWidth || 0,
      height: img.naturalHeight || 0,
      thumbnailURL: best?.thumbnailURL || '',
      pageUrl: location.href,
      pageTitle: document.title
    };
  }

  function fromVideo(video) {
    const src = video.currentSrc || video.src;
    const poster = video.poster ? absolute(video.poster) : '';
    if (src && !src.startsWith('blob:')) {
      return {
        url: absolute(src),
        kind: 'video',
        title: video.title || '',
        alt: '',
        width: video.videoWidth || 0,
        height: video.videoHeight || 0,
        pageUrl: location.href,
        pageTitle: document.title
      };
    }
    if (poster) {
      return {
        url: poster,
        kind: 'image',
        title: video.title || '视频封面',
        alt: '',
        width: 0,
        height: 0,
        pageUrl: location.href,
        pageTitle: document.title
      };
    }
    return null;
  }

  function fromCanvas(canvas) {
    try {
      return {
        url: canvas.toDataURL('image/png'),
        kind: 'image',
        title: '',
        alt: '',
        width: canvas.width,
        height: canvas.height,
        pageUrl: location.href,
        pageTitle: document.title
      };
    } catch {
      return null;
    }
  }

  function pick(element) {
    if (!element || element.nodeType !== 1) return null;
    const img = element.closest('img');
    if (img) return fromImage(img);
    const video = element.closest('video');
    if (video) return fromVideo(video);
    const canvas = element.closest('canvas');
    if (canvas) return fromCanvas(canvas);
    let node = element;
    for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
      const bg = window.AntColExtract?.backgroundImageUrl
        ? window.AntColExtract.backgroundImageUrl(node)
        : parseBackground(getComputedStyle(node).backgroundImage);
      if (bg && !bg.startsWith('data:image/svg')) {
        return {
          url: bg,
          kind: 'image',
          title: window.AntColExtract?.bestTitleFromElement?.(node, document.title) || node.title || '',
          alt: '',
          width: 0,
          height: 0,
          pageUrl: location.href,
          pageTitle: document.title
        };
      }
    }
    return null;
  }

  document.addEventListener('pointermove', (event) => {
    lastPoint = { x: event.clientX, y: event.clientY };
    lastElement = event.target;
  }, { passive: true, capture: true });

  document.addEventListener('mouseover', (event) => {
    const item = pick(event.target);
    if (item) {
      lastItem = item;
      lastItemAt = Date.now();
    }
  }, { passive: true, capture: true });

  function currentItem() {
    const element = document.elementFromPoint(lastPoint.x, lastPoint.y) || lastElement;
    const item = pick(element) || (Date.now() - lastItemAt < 6000 ? lastItem : null);
    if (item) {
      item.pageUrl = location.href;
      item.pageTitle = document.title;
    }
    return item;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'vv-get-hovered') {
      sendResponse(currentItem());
      return false;
    }
    if (message?.type === 'vv-toast') {
      if (window.top === window) showToast(message.text, message.tone);
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === 'vv-start-element-capture') {
      if (window.top === window) startCapture();
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  // ---------- toast ----------

  let toastHost = null;
  let toastTimer = null;

  function ensureToastHost() {
    if (toastHost && document.documentElement.contains(toastHost)) return toastHost;
    toastHost = document.createElement('div');
    toastHost.id = 'ant-col-toast-host';
    toastHost.style.cssText = 'position:fixed;z-index:2147483647;right:22px;bottom:22px;pointer-events:none;';
    const shadow = toastHost.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        .toast {
          display: flex; align-items: center; gap: 10px;
          max-width: 340px; padding: 11px 14px;
          border-radius: 14px;
          background: rgba(8,9,10, .94);
          color: #f7f9f9; font: 13px/1.45 system-ui, "Segoe UI", "Microsoft YaHei", sans-serif;
          box-shadow: 0 12px 40px rgba(0,0,0,.38), 0 1px 0 rgba(255,255,255,.08) inset;
          backdrop-filter: blur(16px);
          transform: translateY(10px) scale(.97); opacity: 0;
          transition: transform .18s ease, opacity .18s ease;
          border: 1px solid rgba(255,255,255,.1);
        }
        .toast.show { transform: translateY(0) scale(1); opacity: 1; }
        .dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; background: #ffffff; }
        .toast.error .dot { background: #ffffff; }
        .toast.info .dot { background: #ffffff; }
        .text { white-space: pre-wrap; }
      </style>
      <div class="toast"><span class="dot"></span><span class="text"></span></div>
    `;
    document.documentElement.appendChild(toastHost);
    return toastHost;
  }

  function showToast(text, tone = 'success') {
    if (!text) return;
    const host = ensureToastHost();
    const shadow = host.shadowRoot;
    const toast = shadow.querySelector('.toast');
    shadow.querySelector('.text').textContent = String(text).slice(0, 220);
    toast.className = `toast ${tone}`;
    requestAnimationFrame(() => toast.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  // 供同一隔离世界的其他内容脚本（拖拽直存等）复用
  window.__antColToast = showToast;

  // ---------- element capture ----------

  function startCapture() {
    if (captureActive) return;
    captureActive = true;

    const host = document.createElement('div');
    host.id = 'ant-col-capture-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;cursor:crosshair;pointer-events:none;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .mask { position: fixed; inset: 0; background: transparent; cursor: crosshair; }
        .box { position: fixed; border: 2px solid #ffffff; border-radius: 4px; pointer-events: none;
               box-shadow: 0 0 0 9999px rgba(8,9,10, .22); transition: all .05s linear; }
        .hint { position: fixed; left: 50%; top: 18px; transform: translateX(-50%);
                background: rgba(8,9,10, .94); color: #f7f9f9; padding: 8px 14px; border-radius: 10px;
                font: 12px/1.4 system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; pointer-events: none;
                border: 1px solid rgba(255,255,255,.1); }
      </style>
      <div class="mask"></div>
      <div class="box" style="display:none"></div>
      <div class="hint">点击要截取的元素 · Esc 取消</div>
    `;
    document.documentElement.appendChild(host);
    const box = shadow.querySelector('.box');

    let target = null;

    const onMove = (event) => {
      const el = document.elementFromPoint(event.clientX, event.clientY);
      if (!el || el === host) return;
      target = el;
      const rect = el.getBoundingClientRect();
      box.style.display = 'block';
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${Math.max(1, rect.width)}px`;
      box.style.height = `${Math.max(1, rect.height)}px`;
    };

    const cleanup = () => {
      captureActive = false;
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      host.remove();
    };

    const onClick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!target) return;
      const el = target;
      const rect = el.getBoundingClientRect();
      cleanup();
      // 若元素不在视口内，先滚动到中间再截
      const inView = rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth;
      if (!inView) {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        setTimeout(() => sendRect(el), 260);
      } else {
        sendRect(el);
      }
    };

    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup();
      }
    };

    function sendRect(el) {
      const rect = el.getBoundingClientRect();
      try {
        chrome.runtime.sendMessage({
          type: 'element-selected',
          rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
          dpr: window.devicePixelRatio || 1
        });
        showToast('已截取所选元素', 'success');
      } catch {
        showToast('截图失败，请重试', 'error');
      }
    }

    // 如果鼠标已经停在元素上，先确定目标
    target = document.elementFromPoint(lastPoint.x, lastPoint.y);
    if (target) onMove({ clientX: lastPoint.x, clientY: lastPoint.y });
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  }
})();
