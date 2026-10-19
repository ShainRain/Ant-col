/**
 * content/extract.js — 页内元素识别与素材提取（移植自 Eagle 扩展 js/lib/api/element-inspector.js）
 *
 * 设计约束：
 * - 只依赖 DOM API（getComputedStyle / XMLSerializer / matchMedia / canvas），不依赖 chrome.*，
 *   可被 content script 动态 import，也可在 Node 中直接 import 做纯函数单测。
 * - 纯函数优先：解析类函数（srcset / image-set / 背景图 / 标题）不读全局状态；
 *   只有真正需要 DOM 的入口（backgroundImageUrl / extractImageCandidate）才访问节点。
 * - 所有导出函数都不抛异常，失败一律返回 '' / null / 空结构。
 * - 所有 URL 用 new URL(u, base) 绝对化，失败回退原值（与 Eagle absolutePath 的意图一致）。
 *
 * 与 Eagle 的差异：
 * - 不搬运 elemFromPoint / Shadow DOM 遍历 / 站点插件 getMetaAsync（属于采集面板与站点插件职责）。
 * - 不做 blob: → base64 转换（Ant-col 由 media.js 在页面内读取，失败则截图兜底）。
 * - extractImageCandidate 不主动过滤 tracking pixel（由调用方用 isTrackingPixel 决定），
 *   以便批量工作台能显示"被过滤掉的小图"。
 */

/** 常见懒加载属性（按优先级尝试） */
const LAZY_ATTRS = [
  'data-src',
  'data-original',
  'data-lazy-src',
  'data-actualsrc',
  'data-original-src',
  'data-lazy',
  'data-image',
  'data-img',
  'data-url',
  'data-hi-res-src',
  'data-highres',
  'data-full-src',
  'data-zoom-src',
  'data-large',
  'data-large-src',
  'data-src-large',
  'data-echo'
];

/** 懒加载 srcset 属性（普通 url 属性都取不到时再试） */
const LAZY_SRCSET_ATTRS = ['data-srcset', 'data-lazy-srcset', 'data-original-set'];

/** tracking pixel 判定阈值（与 Eagle 一致：单边 ≤5 或面积 <10） */
const TRACKING_MAX_SIDE = 5;
const TRACKING_MAX_AREA = 10;

/** 标题最大长度（避免整张卡片的文字被写成超长文件名） */
const MAX_TITLE_LENGTH = 300;

/** 背景图向上查找的最大层数（与 hover.js 的祖先遍历上限一致） */
const MAX_BACKGROUND_DEPTH = 5;

/** 链接类候选需要排除的协议 */
const NON_HTTP_LINK_RE = /^(javascript|mailto|tel|about|data|blob):/i;

// ---------------------------------------------------------------------------
// 基础工具（不访问 DOM 全局，全部可安全调用）
// ---------------------------------------------------------------------------

/**
 * 当前页面的 base URL；Node 环境（无 location/document）返回 ''。
 * @returns {string}
 */
function envBase() {
  try {
    if (typeof location !== 'undefined' && location && typeof location.href === 'string' && location.href) {
      return location.href;
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof document !== 'undefined' && document && typeof document.baseURI === 'string' && document.baseURI) {
      return document.baseURI;
    }
  } catch {
    /* ignore */
  }
  return '';
}

/** 当前文档标题；Node 环境返回 ''。 */
function pageTitle() {
  try {
    if (typeof document !== 'undefined' && document && typeof document.title === 'string') return document.title;
  } catch {
    /* ignore */
  }
  return '';
}

/**
 * 绝对化 URL。空值返回 ''；构造失败回退原值。
 * @param {unknown} value
 * @param {string} [baseUrl]
 * @returns {string}
 */
function resolveUrl(value, baseUrl) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return '';
  const base = baseUrl || envBase();
  try {
    return base ? new URL(raw, base).href : new URL(raw).href;
  } catch {
    return raw;
  }
}

/** 元素的 baseURI（没有则回退 envBase）。 */
function baseOf(el) {
  try {
    if (el && typeof el.baseURI === 'string' && el.baseURI) return el.baseURI;
  } catch {
    /* ignore */
  }
  return envBase();
}

/** 元素 tagName（统一大写；兼容 fake 对象）。 */
function tagNameOf(el) {
  try {
    const raw = el && (el.tagName || el.nodeName);
    return raw ? String(raw).toUpperCase() : '';
  } catch {
    return '';
  }
}

/** 读属性：优先 getAttribute，其次同名属性（便于单测用最小 fake 对象）。 */
function getAttr(el, name) {
  if (!el) return '';
  try {
    if (typeof el.getAttribute === 'function') {
      const value = el.getAttribute(name);
      if (value != null && value !== '') return String(value);
    }
  } catch {
    /* ignore */
  }
  try {
    const direct = el[name];
    if (typeof direct === 'string' && direct) return direct;
  } catch {
    /* ignore */
  }
  return '';
}

/** closest 的安全包装。 */
function closestOf(el, selector) {
  try {
    if (el && typeof el.closest === 'function') return el.closest(selector) || null;
  } catch {
    /* ignore */
  }
  return null;
}

/** getComputedStyle 的安全包装（优先 ownerDocument.defaultView，Node 下返回 null）。 */
function computedStyle(node) {
  if (!node) return null;
  try {
    const view = node.ownerDocument && node.ownerDocument.defaultView;
    if (view && typeof view.getComputedStyle === 'function') return view.getComputedStyle(node);
  } catch {
    /* ignore */
  }
  try {
    if (typeof getComputedStyle === 'function') return getComputedStyle(node);
  } catch {
    /* ignore */
  }
  return null;
}

/** 清洗标题文本：折叠空白、去掉控制字符、限长。 */
function cleanTitle(value) {
  const text = value == null ? '' : String(value);
  const cleaned = text
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > MAX_TITLE_LENGTH ? cleaned.slice(0, MAX_TITLE_LENGTH).trim() : cleaned;
}

/**
 * 判断候选文本是否像"文件名噪声"（hash / UUID / 纯数字长串），
 * 命中则应回退文档标题（对应 Eagle #getBestTitle 里的多组正则）。
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeFileNameNoise(text) {
  const value = String(text || '').trim();
  if (!value) return true;
  // 16~64 位纯 hex（md5 32 位 / sha1 40 位 / 其它 hash）
  if (/^[0-9a-f]{16,64}$/i.test(value)) return true;
  // 标准 UUID
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return true;
  // 纯数字长串（≥10 位，通常是 ID / 时间戳）
  if (/^\d{10,}$/.test(value)) return true;
  return false;
}

/**
 * 把字符串按"顶层逗号"切分（跳过括号与引号内部），用于 srcset / image-set。
 * @param {string} text
 * @returns {string[]}
 */
function splitTopLevel(text) {
  const source = String(text || '');
  const parts = [];
  let buffer = '';
  let quote = '';
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      buffer += char;
      if (char === quote && source[i - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      buffer += char;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      parts.push(buffer);
      buffer = '';
      continue;
    }
    buffer += char;
  }
  parts.push(buffer);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** 候选比较：有 width 的按 width，单边有 width 的优先；否则按 density。 */
function compareCandidates(a, b) {
  const aw = Number(a?.width) || 0;
  const bw = Number(b?.width) || 0;
  if (aw && bw) return aw - bw;
  if (aw) return 1;
  if (bw) return -1;
  return (Number(a?.density) || 0) - (Number(b?.density) || 0);
}

/** 取最大候选。 */
function pickMax(candidates) {
  let best = null;
  for (const candidate of candidates) {
    if (!best || compareCandidates(candidate, best) > 0) best = candidate;
  }
  return best;
}

/** 取最小候选。 */
function pickMin(candidates) {
  let best = null;
  for (const candidate of candidates) {
    if (!best || compareCandidates(candidate, best) < 0) best = candidate;
  }
  return best;
}

/** 占位图判断：blob: 与超短 data:image（1x1 gif 等）。 */
function isPlaceholderUrl(url) {
  const value = String(url || '').trim();
  if (!value) return true;
  const lower = value.toLowerCase();
  if (lower.startsWith('blob:')) return true;
  if (lower.startsWith('data:image') && lower.length <= 200) return true;
  return false;
}

/** 背景图候选是否可用（过滤 gradient / about:blank / overlay，与 Eagle 一致）。 */
function isUsableBackgroundUrl(value) {
  const lower = String(value || '').trim().toLowerCase();
  if (!lower || lower === 'none') return false;
  if (lower.includes('gradient')) return false;
  if (lower.includes('about:blank')) return false;
  if (lower.includes('overlay')) return false;
  return true;
}

// ---------------------------------------------------------------------------
// srcset / picture / image-set
// ---------------------------------------------------------------------------

/**
 * 解析 srcset 字符串为候选列表（url 已绝对化，宽度/密度取自描述符）。
 *
 * 支持 `a.jpg 1x, b.jpg 2x`、`a.jpg 800w`、混写，以及带空格/引号的 URL。
 *
 * @param {string | null | undefined} srcset
 * @param {string} [baseUrl]
 * @returns {{ url: string, width: number, density: number }[]}
 */
function parseSrcsetCandidates(srcset, baseUrl) {
  const text = srcset == null ? '' : String(srcset).trim();
  if (!text) return [];
  const base = baseUrl || envBase();
  /** @type {Map<string, { url: string, width: number, density: number }>} */
  const byUrl = new Map();

  for (const part of splitTopLevel(text)) {
    const tokens = part.split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const url = resolveUrl(tokens[0], base);
    if (!url) continue;

    let width = 0;
    let density = 0;
    for (let i = 1; i < tokens.length; i++) {
      const descriptor = tokens[i];
      if (/^\d+w$/i.test(descriptor)) {
        const parsed = Number.parseInt(descriptor, 10);
        if (parsed > 0) width = parsed;
      } else if (/^\d+(?:\.\d+)?x$/i.test(descriptor)) {
        const parsed = Number.parseFloat(descriptor);
        if (parsed > 0) density = parsed;
      }
    }

    // 同一 URL 重复出现时保留分辨率更高的描述符，避免丢掉最大候选
    const candidate = { url, width, density };
    const existing = byUrl.get(url);
    if (!existing || compareCandidates(candidate, existing) > 0) byUrl.set(url, candidate);
  }
  return [...byUrl.values()];
}

/**
 * 从 srcset 取"最大候选"的绝对 URL；没有候选返回 ''。
 * @param {string | null | undefined} srcset
 * @param {string} [baseUrl]
 * @returns {string}
 */
function pickFromSrcset(srcset, baseUrl) {
  try {
    const best = pickMax(parseSrcsetCandidates(srcset, baseUrl));
    return best ? best.url : '';
  } catch {
    return '';
  }
}

/** 取元素所在的 <picture>。 */
function pictureOf(img) {
  const byClosest = closestOf(img, 'picture');
  if (byClosest) return byClosest;
  const parent = img && img.parentElement;
  return parent && tagNameOf(parent) === 'PICTURE' ? parent : null;
}

/** 取 <picture> 下的直接 <source> 子节点。 */
function pictureSourcesOf(picture) {
  if (!picture) return [];
  try {
    const children = picture.children ? Array.from(picture.children) : [];
    return children.filter((child) => tagNameOf(child) === 'SOURCE');
  } catch {
    return [];
  }
}

/**
 * source 的 media 是否命中。无法判断（Node / 无 matchMedia）时保守视为命中，
 * 避免在单测或旧环境里丢掉高分辨率候选。
 */
function mediaMatches(source) {
  const media = getAttr(source, 'media');
  if (!media) return true;
  try {
    if (typeof matchMedia === 'function') return matchMedia(media).matches;
  } catch {
    /* ignore */
  }
  try {
    const view = source && source.ownerDocument && source.ownerDocument.defaultView;
    if (view && typeof view.matchMedia === 'function') return view.matchMedia(media).matches;
  } catch {
    /* ignore */
  }
  return true;
}

/**
 * 取 <picture> 内所有命中的 <source> 的最大候选；没有则回退 img 的 srcset /
 * currentSrc / src。返回绝对 URL，找不到返回 ''。
 * @param {HTMLImageElement | null | undefined} img
 * @returns {string}
 */
function pickFromPicture(img) {
  try {
    if (!img) return '';
    const base = baseOf(img);
    const candidates = [];
    for (const source of pictureSourcesOf(pictureOf(img))) {
      if (!mediaMatches(source)) continue;
      candidates.push(...parseSrcsetCandidates(getAttr(source, 'srcset'), base));
    }
    const best = pickMax(candidates);
    if (best) return best.url;

    // 回退链：img 自身 srcset → currentSrc → src
    const srcsetBest = pickFromSrcset(getAttr(img, 'srcset'), base);
    if (srcsetBest) return srcsetBest;
    const current = resolveUrl(getAttr(img, 'currentSrc'), base);
    if (current) return current;
    return resolveUrl(getAttr(img, 'src'), base);
  } catch {
    return '';
  }
}

/** 找到 image-set( / -webkit-image-set( 的左括号下标；找不到返回 -1。 */
function findImageSetOpenParen(text) {
  const match = /(-webkit-)?image-set\s*\(/i.exec(text);
  if (!match) return -1;
  return match.index + match[0].length - 1;
}

/** 从 openIndex 的左括号开始读取配平的括号内容（返回到右括号之间的字符串）。 */
function readBalancedParens(text, openIndex) {
  if (!text || text[openIndex] !== '(') return '';
  let depth = 0;
  let quote = '';
  for (let i = openIndex; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote && text[i - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex + 1, i);
    }
  }
  return '';
}

/** 取 image-set 单个候选里的 URL 文本。 */
function firstUrlToken(part) {
  const text = String(part || '').trim();
  if (!text) return '';
  const urlFn = /url\(\s*(['"]?)([\s\S]*?)\1\s*\)/i.exec(text);
  if (urlFn) return urlFn[2].trim();
  const quoted = /^(['"])([\s\S]*?)\1/.exec(text);
  if (quoted) return quoted[2].trim();
  const bare = text.split(/\s+/)[0];
  if (!bare || /^type\(/i.test(bare)) return '';
  return bare;
}

/** 取 image-set 单个候选的分辨率描述符（如 2x），没有则 0。 */
function densityOf(part) {
  const match = /(?:^|\s)(\d+(?:\.\d+)?)x(?=\s|$)/i.exec(String(part || ''));
  if (!match) return 0;
  const parsed = Number.parseFloat(match[1]);
  return parsed > 0 ? parsed : 0;
}

/**
 * 解析 CSS image-set(...) 并返回最大候选的绝对 URL；不是 image-set 或解析失败返回 ''。
 * 兼容 -webkit-image-set、url() 与裸字符串两种写法、type()/分辨率描述符。
 * @param {string | null | undefined} value
 * @param {string} [baseUrl]
 * @returns {string}
 */
function parseImageSet(value, baseUrl) {
  try {
    const text = value == null ? '' : String(value);
    const openIndex = findImageSetOpenParen(text);
    if (openIndex < 0) return '';
    const inner = readBalancedParens(text, openIndex);
    if (!inner) return '';
    const base = baseUrl || envBase();
    const candidates = [];
    const seen = new Set();
    for (const part of splitTopLevel(inner)) {
      const url = firstUrlToken(part);
      if (!url) continue;
      const resolved = resolveUrl(url, base);
      if (!resolved || seen.has(resolved)) continue;
      seen.add(resolved);
      candidates.push({ url: resolved, width: 0, density: densityOf(part) });
    }
    const best = pickMax(candidates);
    return best ? best.url : '';
  } catch {
    return '';
  }
}

/**
 * 解析 background-image 计算值：支持普通 url() 与 image-set()，过滤 gradient /
 * about:blank / overlay，返回第一个可用候选的绝对 URL。
 * @param {string | null | undefined} value getComputedStyle(node).backgroundImage
 * @param {string} [baseUrl]
 * @returns {string}
 */
function parseBackgroundImage(value, baseUrl) {
  try {
    const raw = value == null ? '' : String(value).trim();
    if (!raw || raw === 'none') return '';
    if (/image-set\s*\(/i.test(raw)) {
      const fromSet = parseImageSet(raw, baseUrl);
      if (fromSet) return fromSet;
    }
    const base = baseUrl || envBase();
    const urlFn = /url\(\s*(['"]?)([\s\S]*?)\1\s*\)/gi;
    let matched;
    while ((matched = urlFn.exec(raw))) {
      const candidate = matched[2].trim();
      if (!isUsableBackgroundUrl(candidate)) continue;
      return resolveUrl(candidate, base);
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * 取节点计算样式里的背景图 URL（已绝对化），没有则 ''。
 * @param {Element | null | undefined} node
 * @returns {string}
 */
function backgroundImageUrl(node) {
  try {
    const style = computedStyle(node);
    if (!style) return '';
    return parseBackgroundImage(style.backgroundImage, baseOf(node));
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// 懒加载 / tracking pixel / 最佳图源
// ---------------------------------------------------------------------------

/**
 * 读取常见懒加载属性，返回第一个非空绝对 URL；没有则尝试 data-srcset 类属性。
 * @param {HTMLImageElement | null | undefined} img
 * @returns {string}
 */
function lazySrcAttrs(img) {
  try {
    if (!img) return '';
    const base = baseOf(img);
    for (const name of LAZY_ATTRS) {
      const value = getAttr(img, name).trim();
      if (!value) continue;
      const resolved = resolveUrl(value, base);
      if (resolved) return resolved;
    }
    for (const name of LAZY_SRCSET_ATTRS) {
      const best = pickFromSrcset(getAttr(img, name), base);
      if (best) return best;
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * 判定 tracking pixel：naturalWidth/Height ≤5，或面积 <10。
 * 图片尚未加载完（complete === false）时不判定，返回 false。
 *
 * 注意：懒加载图片（只有 data-src、尚未真正加载）naturalWidth 为 0，也会被判为 true；
 * 调用方应先用 bestImageSource 取到真实地址、或先判断 img.complete。
 * @param {HTMLImageElement | null | undefined} img
 * @returns {boolean}
 */
function isTrackingPixel(img) {
  try {
    if (!img) return false;
    if (img.complete === false) return false;
    const width = Number(img.naturalWidth) || 0;
    const height = Number(img.naturalHeight) || 0;
    if (width <= TRACKING_MAX_SIDE && height <= TRACKING_MAX_SIDE) return true;
    if (width > 0 && height > 0 && width * height < TRACKING_MAX_AREA) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * 综合 picture / srcset / 懒加载 / currentSrc / src，返回最佳图源。
 *
 * 优先级（高 → 低）：picture > source[srcset] 最大图 → img[srcset] 最大图 →
 * 懒加载属性 → currentSrc → src；跳过 blob: 与超短 data: 占位图。
 *
 * @param {HTMLImageElement | null | undefined} img
 * @returns {{ src: string, thumbnailURL: string }}
 *   src：最佳图绝对 URL；thumbnailURL：srcset/picture 里的最小候选，没有则 ''
 */
function bestImageSource(img) {
  try {
    if (!img) return { src: '', thumbnailURL: '' };
    const base = baseOf(img);

    const pictureCandidates = [];
    for (const source of pictureSourcesOf(pictureOf(img))) {
      if (!mediaMatches(source)) continue;
      pictureCandidates.push(...parseSrcsetCandidates(getAttr(source, 'srcset'), base));
    }
    const srcsetCandidates = parseSrcsetCandidates(getAttr(img, 'srcset'), base);
    const allCandidates = [...pictureCandidates, ...srcsetCandidates];

    const ordered = [];
    const pictureBest = pickMax(pictureCandidates);
    if (pictureBest) ordered.push(pictureBest.url);
    const srcsetBest = pickMax(srcsetCandidates);
    if (srcsetBest) ordered.push(srcsetBest.url);
    const lazy = lazySrcAttrs(img);
    if (lazy) ordered.push(lazy);
    const current = resolveUrl(getAttr(img, 'currentSrc'), base);
    if (current) ordered.push(current);
    const src = resolveUrl(getAttr(img, 'src'), base);
    if (src) ordered.push(src);

    let best = '';
    for (const candidate of ordered) {
      if (isPlaceholderUrl(candidate)) continue;
      best = candidate;
      break;
    }
    if (!best) best = ordered.find(Boolean) || '';

    const min = pickMin(allCandidates);
    return { src: best, thumbnailURL: min ? min.url : '' };
  } catch {
    return { src: '', thumbnailURL: '' };
  }
}

// ---------------------------------------------------------------------------
// 标题
// ---------------------------------------------------------------------------

/**
 * 标题启发式：el.title → el.alt → 最近 <a> 的文本 → 文档标题。
 * 候选像 hash / UUID / 纯数字长串（如 32 位 hex、≥10 位数字）时回退文档标题。
 *
 * @param {Element | null | undefined} el
 * @param {string} [docTitle] 文档标题（默认读 document.title）
 * @returns {string}
 */
function bestTitleFromElement(el, docTitle) {
  const fallback = cleanTitle(docTitle == null ? pageTitle() : docTitle);
  try {
    if (!el) return fallback;
    const candidates = [];
    const title = cleanTitle(getAttr(el, 'title'));
    if (title) candidates.push(title);
    const alt = cleanTitle(getAttr(el, 'alt'));
    if (alt) candidates.push(alt);
    const anchor = closestOf(el, 'a');
    if (anchor) {
      const text = cleanTitle(anchor.textContent);
      if (text) candidates.push(text);
    }
    for (const candidate of candidates) {
      if (looksLikeFileNameNoise(candidate)) continue;
      return candidate;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// 候选提取
// ---------------------------------------------------------------------------

/** 找到元素对应的 <img>（img 本身 / picture 内 / source 所在 picture 内 / 最近 img）。 */
function resolveImageElement(el) {
  const tag = tagNameOf(el);
  if (tag === 'IMG') return el;
  if (tag === 'PICTURE') {
    try {
      return el.querySelector ? el.querySelector('img') : null;
    } catch {
      return null;
    }
  }
  if (tag === 'SOURCE') {
    const picture = closestOf(el, 'picture');
    try {
      return picture && picture.querySelector ? picture.querySelector('img') : null;
    } catch {
      return null;
    }
  }
  return closestOf(el, 'img');
}

/** 取 picture / source 自身的 srcset 候选（不含 img 回退）。 */
function pictureSourceUrl(el) {
  const tag = tagNameOf(el);
  if (tag !== 'PICTURE' && tag !== 'SOURCE') return '';
  const picture = tag === 'PICTURE' ? el : closestOf(el, 'picture');
  const base = baseOf(el);
  const candidates = [];
  for (const source of pictureSourcesOf(picture)) {
    if (!mediaMatches(source)) continue;
    candidates.push(...parseSrcsetCandidates(getAttr(source, 'srcset'), base));
  }
  const best = pickMax(candidates);
  return best ? best.url : '';
}

/** 图片尺寸：natural → client → width/height 属性。 */
function imageSize(img) {
  const naturalWidth = Number(img && img.naturalWidth) || 0;
  const naturalHeight = Number(img && img.naturalHeight) || 0;
  const clientWidth = Number(img && img.clientWidth) || 0;
  const clientHeight = Number(img && img.clientHeight) || 0;
  const attrWidth = Number.parseInt(getAttr(img, 'width'), 10) || 0;
  const attrHeight = Number.parseInt(getAttr(img, 'height'), 10) || 0;
  return {
    width: naturalWidth || clientWidth || attrWidth,
    height: naturalHeight || clientHeight || attrHeight
  };
}

/** 外围 <a> 的绝对 href；没有可用的 http(s) 链接返回 ''。 */
function linkUrlOf(el, base) {
  const anchor = tagNameOf(el) === 'A' ? el : closestOf(el, 'a');
  if (!anchor) return '';
  const href = resolveUrl(getAttr(anchor, 'href'), base || baseOf(anchor));
  if (!href) return '';
  return /^https?:\/\//i.test(href) ? href : '';
}

/** 向上（含自身）最多 MAX_BACKGROUND_DEPTH 层找背景图。 */
function nearestBackgroundImage(el) {
  let node = el;
  for (let depth = 0; node && depth <= MAX_BACKGROUND_DEPTH; depth += 1) {
    const url = backgroundImageUrl(node);
    if (url) return { node, url };
    node = node.parentElement || null;
  }
  return null;
}

/** UTF-8 文本 → base64（不依赖已废弃的 unescape）。 */
function base64Utf8(text) {
  if (typeof btoa !== 'function' || typeof TextEncoder === 'undefined') return '';
  const bytes = new TextEncoder().encode(String(text));
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** SVG 节点序列化为 data:image/svg+xml;base64,...；失败返回 ''。 */
function svgDataUrl(node) {
  try {
    if (!node) return '';
    const view = node.ownerDocument && node.ownerDocument.defaultView;
    const Serializer =
      (view && typeof view.XMLSerializer === 'function' && view.XMLSerializer) ||
      (typeof XMLSerializer === 'function' ? XMLSerializer : null);
    if (!Serializer) return '';
    const markup = new Serializer().serializeToString(node);
    if (!markup || !markup.includes('<svg')) return '';
    const base64 = base64Utf8(markup);
    return base64 ? `data:image/svg+xml;base64,${base64}` : '';
  } catch {
    return '';
  }
}

/** canvas 导出 data URL；失败返回 ''。 */
function canvasDataUrl(node) {
  try {
    if (!node || typeof node.toDataURL !== 'function') return '';
    const url = node.toDataURL('image/png');
    return typeof url === 'string' && url.startsWith('data:image') ? url : '';
  } catch {
    return '';
  }
}

/**
 * 从页内元素提取图片候选。
 *
 * 支持 img / picture / source / canvas / svg / 背景图（含最多 5 层祖先）。
 * 找不到任何图源返回 null；不会抛异常。
 *
 * @param {Element | null | undefined} el
 * @param {{ docTitle?: string }} [options]
 * @returns {{ kind: 'image', url: string, thumbnailURL: string, title: string,
 *   alt: string, width: number, height: number, linkUrl: string } | null}
 */
function extractImageCandidate(el, options = {}) {
  try {
    if (!el) return null;
    const docTitle = options && options.docTitle != null ? options.docTitle : pageTitle();
    const base = baseOf(el);

    // 1) img / picture / source → 最佳图源
    const img = resolveImageElement(el);
    if (img) {
      const source = bestImageSource(img);
      if (source.src) {
        const size = imageSize(img);
        return {
          kind: 'image',
          url: source.src,
          thumbnailURL: source.thumbnailURL || '',
          title: bestTitleFromElement(img, docTitle),
          alt: cleanTitle(getAttr(img, 'alt')),
          width: size.width,
          height: size.height,
          linkUrl: linkUrlOf(img, base)
        };
      }
    }

    // 2) picture / source 没有对应 img 时，直接用 srcset 候选
    const fromPicture = pictureSourceUrl(el);
    if (fromPicture) {
      return {
        kind: 'image',
        url: fromPicture,
        thumbnailURL: '',
        title: bestTitleFromElement(el, docTitle),
        alt: '',
        width: 0,
        height: 0,
        linkUrl: linkUrlOf(el, base)
      };
    }

    // 3) 内联 SVG（含点击 SVG 内部节点的情况）
    const svg = tagNameOf(el) === 'SVG' ? el : closestOf(el, 'svg');
    const svgUrl = svg ? svgDataUrl(svg) : '';
    if (svgUrl) {
      return {
        kind: 'image',
        url: svgUrl,
        thumbnailURL: '',
        title: bestTitleFromElement(svg, docTitle),
        alt: '',
        width: 0,
        height: 0,
        linkUrl: linkUrlOf(svg, base)
      };
    }

    // 4) canvas
    const canvas = tagNameOf(el) === 'CANVAS' ? el : closestOf(el, 'canvas');
    const canvasUrl = canvas ? canvasDataUrl(canvas) : '';
    if (canvasUrl) {
      return {
        kind: 'image',
        url: canvasUrl,
        thumbnailURL: '',
        title: bestTitleFromElement(canvas, docTitle),
        alt: '',
        width: Number(canvas.width) || 0,
        height: Number(canvas.height) || 0,
        linkUrl: linkUrlOf(canvas, base)
      };
    }

    // 5) 背景图（自身 + 祖先）
    const background = nearestBackgroundImage(el);
    if (background) {
      const node = background.node;
      return {
        kind: 'image',
        url: background.url,
        thumbnailURL: '',
        title: bestTitleFromElement(node, docTitle),
        alt: '',
        width: Number(node.clientWidth) || 0,
        height: Number(node.clientHeight) || 0,
        linkUrl: linkUrlOf(node, base)
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 从 <a> 提取链接候选。
 *
 * url 与 linkUrl 都是链接的绝对 href（与采集 payload 的 linkUrl 字段兼容）；
 * href 为空、纯片段（#anchor）或非 http(s)（javascript:/mailto:/tel: 等）时返回 null。
 *
 * @param {HTMLAnchorElement | null | undefined} anchor
 * @param {{ docTitle?: string }} [options]
 * @returns {{ kind: 'link', url: string, linkUrl: string, title: string } | null}
 */
function extractLinkCandidate(anchor, options = {}) {
  try {
    if (!anchor) return null;
    const rawHref = getAttr(anchor, 'href').trim();
    // 纯片段链接不是可保存的素材，直接忽略
    if (!rawHref || rawHref.startsWith('#')) return null;
    const base = baseOf(anchor);
    const href = resolveUrl(rawHref, base);
    if (!href || NON_HTTP_LINK_RE.test(href)) return null;
    const docTitle = options && options.docTitle != null ? options.docTitle : pageTitle();
    return {
      kind: 'link',
      url: href,
      linkUrl: href,
      title: bestTitleFromElement(anchor, docTitle)
    };
  } catch {
    return null;
  }
}

// classic content script 注入点：manifest 直接加载本文件，供 hover.js / drag-save.js 使用
if (typeof window !== 'undefined') {
  window.AntColExtract = {
    resolveUrl,
    parseSrcsetCandidates,
    pickFromSrcset,
    pickFromPicture,
    parseImageSet,
    parseBackgroundImage,
    backgroundImageUrl,
    lazySrcAttrs,
    isTrackingPixel,
    bestImageSource,
    bestTitleFromElement,
    extractImageCandidate,
    extractLinkCandidate
  };
}