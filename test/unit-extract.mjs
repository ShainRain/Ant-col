/**
 * test/unit-extract.mjs — content/extract.js 纯函数单测
 *
 * 运行：node test/unit-extract.mjs
 *
 * 约束：不依赖 DOM 全局。所有 DOM 相关函数都用最小 fake 对象驱动；
 * 需要 getComputedStyle 的 backgroundImageUrl、需要真实布局的祖先遍历只做间接覆盖
 * （parseBackgroundImage / extractImageCandidate 的背景分支已在浏览器 e2e 中验证）。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';

// content/extract.js 是 classic content script（挂到 window.AntColExtract）。
// 在同一个 Node realm 里用 Function 执行，使测试注入的 DOM fake 全局对模块可见，
// 同时保留与浏览器一致的 classic script 语义。
const extractSource = fs.readFileSync(new URL('../content/extract.js', import.meta.url), 'utf8');
const windowShim = {};
const extractApi = new Function('window', `${extractSource}\n;return window.AntColExtract;`)(windowShim);
if (!extractApi) throw new Error('content/extract.js 未暴露 window.AntColExtract');

const {
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
} = extractApi;

let passed = 0;
const failures = [];

/**
 * @param {string} name
 * @param {() => void} fn
 */
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failures.push({ name, error });
  }
}

// ---------------------------------------------------------------------------
// fake DOM 工具
// ---------------------------------------------------------------------------

/**
 * @param {Record<string, string>} [attrs]
 * @param {Record<string, unknown>} [extra]
 */
function fakeElement(attrs = {}, extra = {}) {
  const node = {
    tagName: '',
    attrs,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    closest() {
      return null;
    },
    textContent: ''
  };
  return Object.assign(node, extra);
}

/**
 * @param {Record<string, unknown>} [options]
 * @returns {any}
 */
function fakeImg({ attrs = {}, baseURI = 'https://x/p/', ...rest } = {}) {
  const img = {
    tagName: 'IMG',
    baseURI,
    complete: true,
    naturalWidth: 0,
    naturalHeight: 0,
    clientWidth: 0,
    clientHeight: 0,
    currentSrc: '',
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    closest() {
      return null;
    }
  };
  return Object.assign(img, rest);
}

/** @param {Record<string, string>} attrs */
function fakeSource(attrs = {}) {
  return {
    tagName: 'SOURCE',
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    }
  };
}

/** @param {any[]} children */
function fakePicture(children = [], baseURI = 'https://x/p/') {
  return { tagName: 'PICTURE', children, baseURI };
}

/** 生成一个"closest 只命中某个 selector"的图片 fake。 */
function imgInside(picture, extra = {}) {
  return fakeImg({
    ...extra,
    closest: (selector) => (selector === 'picture' ? picture : null)
  });
}

// ---------------------------------------------------------------------------
// 0. 导出面
// ---------------------------------------------------------------------------

test('必需的 10 个函数全部导出', () => {
  const required = [
    pickFromSrcset,
    pickFromPicture,
    parseImageSet,
    backgroundImageUrl,
    lazySrcAttrs,
    isTrackingPixel,
    bestImageSource,
    bestTitleFromElement,
    extractImageCandidate,
    extractLinkCandidate
  ];
  for (const fn of required) assert.equal(typeof fn, 'function');
});

// ---------------------------------------------------------------------------
// 1. resolveUrl
// ---------------------------------------------------------------------------

test('resolveUrl: 相对地址按 base 绝对化', () => {
  assert.equal(resolveUrl('b.jpg', 'https://x.com/a/'), 'https://x.com/a/b.jpg');
  assert.equal(resolveUrl('/b.jpg', 'https://x.com/a/c.html'), 'https://x.com/b.jpg');
  assert.equal(resolveUrl('//cdn.x.com/b.png', 'https://x.com/a/'), 'https://cdn.x.com/b.png');
});

test('resolveUrl: 绝对地址 / 空值 / 无 base', () => {
  assert.equal(resolveUrl('https://y/z.png', 'https://x/'), 'https://y/z.png');
  assert.equal(resolveUrl('  https://y/z.png  ', 'https://x/'), 'https://y/z.png');
  assert.equal(resolveUrl('', 'https://x/'), '');
  assert.equal(resolveUrl(null, 'https://x/'), '');
  assert.equal(resolveUrl(undefined, 'https://x/'), '');
  // Node 环境没有 location，相对地址无法绝对化 → 回退原值（浏览器里会走 baseOf/img.baseURI）
  assert.equal(resolveUrl('a.jpg'), 'a.jpg');
});

// ---------------------------------------------------------------------------
// 2. srcset
// ---------------------------------------------------------------------------

test('parseSrcsetCandidates: 解析密度 / 宽度描述符并绝对化', () => {
  assert.deepEqual(parseSrcsetCandidates('a.jpg 1x, b.jpg 2x', 'https://x/'), [
    { url: 'https://x/a.jpg', width: 0, density: 1 },
    { url: 'https://x/b.jpg', width: 0, density: 2 }
  ]);
  assert.deepEqual(parseSrcsetCandidates('a.jpg 400w, b.jpg 800w', 'https://x/'), [
    { url: 'https://x/a.jpg', width: 400, density: 0 },
    { url: 'https://x/b.jpg', width: 800, density: 0 }
  ]);
});

test('parseSrcsetCandidates: 去重 / 空值 / 脏数据不抛异常', () => {
  const deduped = parseSrcsetCandidates('a.jpg 1x, a.jpg 2x', 'https://x/');
  assert.equal(deduped.length, 1);
  // 同一 URL 重复出现时保留更高分辨率的描述符
  assert.equal(deduped[0].density, 2);
  assert.deepEqual(parseSrcsetCandidates('', 'https://x/'), []);
  assert.deepEqual(parseSrcsetCandidates(null, 'https://x/'), []);
  assert.deepEqual(parseSrcsetCandidates(undefined, 'https://x/'), []);
  assert.doesNotThrow(() => parseSrcsetCandidates(' , ,,, ', 'https://x/'));
  assert.doesNotThrow(() => parseSrcsetCandidates('a.jpg 999999999999w', 'https://x/'));
});

test('pickFromSrcset: 取最大候选（宽度优先于密度）', () => {
  assert.equal(pickFromSrcset('a.jpg 1x, b.jpg 2x', 'https://x/'), 'https://x/b.jpg');
  assert.equal(
    pickFromSrcset('a.jpg 400w, b.jpg 800w, c.jpg 1200w', 'https://x/'),
    'https://x/c.jpg'
  );
  assert.equal(pickFromSrcset('a.jpg 800w, b.jpg 1x', 'https://x/'), 'https://x/a.jpg');
  assert.equal(pickFromSrcset('a.jpg 1x, b.jpg 1.5x', 'https://x/'), 'https://x/b.jpg');
});

test('pickFromSrcset: 无候选返回空串', () => {
  assert.equal(pickFromSrcset('', 'https://x/'), '');
  assert.equal(pickFromSrcset(null, 'https://x/'), '');
  assert.equal(pickFromSrcset(undefined, 'https://x/'), '');
});

// ---------------------------------------------------------------------------
// 3. picture
// ---------------------------------------------------------------------------

test('pickFromPicture: 取 <source srcset> 最大候选', () => {
  const picture = fakePicture([fakeSource({ srcset: 's.jpg 1x, l.jpg 2x' })]);
  assert.equal(pickFromPicture(imgInside(picture)), 'https://x/p/l.jpg');
});

test('pickFromPicture: 多个 source 取全局最大', () => {
  const picture = fakePicture([
    fakeSource({ srcset: 'a.jpg 400w', media: '' }),
    fakeSource({ srcset: 'b.jpg 1600w', media: '' })
  ]);
  assert.equal(pickFromPicture(imgInside(picture)), 'https://x/p/b.jpg');
});

test('pickFromPicture: 跳过 media 不匹配的 source', () => {
  const original = globalThis.matchMedia;
  globalThis.matchMedia = (query) => ({ matches: false, media: query });
  try {
    const picture = fakePicture([fakeSource({ srcset: 'wide.jpg 4000w', media: '(min-width: 1200px)' })]);
    const img = imgInside(picture, { currentSrc: 'https://x/p/small.jpg' });
    assert.equal(pickFromPicture(img), 'https://x/p/small.jpg');
  } finally {
    if (original === undefined) delete globalThis.matchMedia;
    else globalThis.matchMedia = original;
  }
});

test('pickFromPicture: 无 source 时回退 currentSrc → srcset → src', () => {
  assert.equal(pickFromPicture(fakeImg({ currentSrc: 'https://x/p/current.jpg' })), 'https://x/p/current.jpg');
  assert.equal(
    pickFromPicture(fakeImg({ attrs: { srcset: 'a.jpg 1x, b.jpg 3x' }, currentSrc: '' })),
    'https://x/p/b.jpg'
  );
  assert.equal(pickFromPicture(fakeImg({ attrs: { src: 'c.jpg' }, currentSrc: '' })), 'https://x/p/c.jpg');
  assert.equal(pickFromPicture(null), '');
});

// ---------------------------------------------------------------------------
// 4. image-set / 背景图
// ---------------------------------------------------------------------------

test('parseImageSet: 取最大密度候选', () => {
  assert.equal(
    parseImageSet('image-set(url("a.jpg") 1x, url("b.jpg") 2x)', 'https://x/'),
    'https://x/b.jpg'
  );
  assert.equal(
    parseImageSet('-webkit-image-set(url(a.png) 1x, "b.png" 3x)', 'https://x/'),
    'https://x/b.png'
  );
  assert.equal(
    parseImageSet('image-set(url(a.webp) 1x type("image/webp"), url(b.jpg) 2x)', 'https://x/'),
    'https://x/b.jpg'
  );
  assert.equal(parseImageSet('image-set(url(only.png) 2x)', 'https://x/'), 'https://x/only.png');
});

test('parseImageSet: 非 image-set / 畸形输入返回空串', () => {
  assert.equal(parseImageSet('url(a.jpg)', 'https://x/'), '');
  assert.equal(parseImageSet('none', 'https://x/'), '');
  assert.equal(parseImageSet('', 'https://x/'), '');
  assert.equal(parseImageSet(null, 'https://x/'), '');
  assert.equal(parseImageSet('image-set(url(a.jpg) 1x', 'https://x/'), '');
  assert.doesNotThrow(() => parseImageSet('image-set(', 'https://x/'));
});

test('parseBackgroundImage: 普通 url() 绝对化并过滤无效值', () => {
  assert.equal(parseBackgroundImage('url("https://x/a.png")', 'https://x/'), 'https://x/a.png');
  assert.equal(parseBackgroundImage('url( b.png )', 'https://x/'), 'https://x/b.png');
  assert.equal(parseBackgroundImage('url("b.png")', 'https://x/'), 'https://x/b.png');
  assert.equal(parseBackgroundImage('none', 'https://x/'), '');
  assert.equal(parseBackgroundImage('', 'https://x/'), '');
  assert.equal(parseBackgroundImage('url("about:blank")', 'https://x/'), '');
});

test('parseBackgroundImage: gradient 被跳过，取后续可用图层', () => {
  assert.equal(
    parseBackgroundImage('linear-gradient(red, blue), url(b.png)', 'https://x/'),
    'https://x/b.png'
  );
  assert.equal(parseBackgroundImage('url("data:image/svg+xml;utf8,<svg/>")', 'https://x/'), 'data:image/svg+xml;utf8,<svg/>');
});

test('parseBackgroundImage: 多个 url() 取第一个；image-set 取最大', () => {
  assert.equal(parseBackgroundImage('url(a.png), url(b.png)', 'https://x/'), 'https://x/a.png');
  assert.equal(
    parseBackgroundImage('image-set(url(a.png) 1x, url(b.png) 2x)', 'https://x/'),
    'https://x/b.png'
  );
});

test('backgroundImageUrl: Node 环境无 getComputedStyle 时返回空串，不抛异常', () => {
  assert.equal(backgroundImageUrl(fakeElement()), '');
  assert.equal(backgroundImageUrl(null), '');
  assert.doesNotThrow(() => backgroundImageUrl({ tagName: 'DIV' }));
});

test('backgroundImageUrl: 使用 ownerDocument.defaultView.getComputedStyle', () => {
  const node = fakeElement(
    {},
    {
      ownerDocument: {
        defaultView: {
          getComputedStyle: () => ({ backgroundImage: 'url(https://cdn.x.com/bg.jpg)' })
        }
      }
    }
  );
  assert.equal(backgroundImageUrl(node), 'https://cdn.x.com/bg.jpg');
});

// ---------------------------------------------------------------------------
// 5. 懒加载 / tracking pixel
// ---------------------------------------------------------------------------

test('lazySrcAttrs: 按优先级返回第一个非空绝对 URL', () => {
  assert.equal(
    lazySrcAttrs(fakeImg({ attrs: { 'data-src': 'https://x/big.jpg', src: 'https://x/small.jpg' } })),
    'https://x/big.jpg'
  );
  assert.equal(lazySrcAttrs(fakeImg({ attrs: { 'data-original': 'https://x/o.jpg' } })), 'https://x/o.jpg');
  assert.equal(
    lazySrcAttrs(fakeImg({ attrs: { 'data-lazy-src': '', 'data-actualsrc': 'https://x/a.jpg' } })),
    'https://x/a.jpg'
  );
});

test('lazySrcAttrs: 无 url 属性时回退 data-srcset，完全为空返回空串', () => {
  assert.equal(
    lazySrcAttrs(fakeImg({ attrs: { 'data-srcset': 'a.jpg 1x, b.jpg 2x' } })),
    'https://x/p/b.jpg'
  );
  assert.equal(lazySrcAttrs(fakeImg()), '');
  assert.equal(lazySrcAttrs(null), '');
});

test('isTrackingPixel: 单边 ≤5 或面积 <10 判 true', () => {
  assert.equal(isTrackingPixel({ naturalWidth: 1, naturalHeight: 1, complete: true }), true);
  assert.equal(isTrackingPixel({ naturalWidth: 2, naturalHeight: 3, complete: true }), true);
  assert.equal(isTrackingPixel({ naturalWidth: 6, naturalHeight: 1, complete: true }), true);
  assert.equal(isTrackingPixel({ naturalWidth: 0, naturalHeight: 0, complete: true }), true);
});

test('isTrackingPixel: 正常图片 / 未加载完 / 空值判 false', () => {
  assert.equal(isTrackingPixel({ naturalWidth: 100, naturalHeight: 100, complete: true }), false);
  assert.equal(isTrackingPixel({ naturalWidth: 0, naturalHeight: 0, complete: false }), false);
  assert.equal(isTrackingPixel(null), false);
  assert.equal(isTrackingPixel(undefined), false);
});

// ---------------------------------------------------------------------------
// 6. bestImageSource
// ---------------------------------------------------------------------------

test('bestImageSource: srcset 最大图 + 最小图缩略图', () => {
  const img = fakeImg({ attrs: { srcset: 'a.jpg 400w, b.jpg 1200w' }, currentSrc: 'https://x/p/a.jpg' });
  assert.deepEqual(bestImageSource(img), {
    src: 'https://x/p/b.jpg',
    thumbnailURL: 'https://x/p/a.jpg'
  });
});

test('bestImageSource: picture 的 source 优先于 img 自身 srcset', () => {
  const picture = fakePicture([fakeSource({ srcset: 'p1.jpg 800w, p2.jpg 2400w' })]);
  const img = imgInside(picture, { attrs: { srcset: 's.jpg 400w' } });
  assert.equal(bestImageSource(img).src, 'https://x/p/p2.jpg');
});

test('bestImageSource: 懒加载属性优先于 currentSrc / src', () => {
  const img = fakeImg({
    attrs: { 'data-src': 'https://x/big.jpg', src: 'https://x/placeholder.gif' },
    currentSrc: 'https://x/placeholder.gif'
  });
  assert.deepEqual(bestImageSource(img), { src: 'https://x/big.jpg', thumbnailURL: '' });
});

test('bestImageSource: 跳过 blob: 与超短 data: 占位图', () => {
  const img = fakeImg({
    attrs: { src: 'https://x/real.jpg' },
    currentSrc: 'blob:https://x/1234'
  });
  assert.equal(bestImageSource(img).src, 'https://x/real.jpg');

  const inline = fakeImg({ attrs: { src: 'data:image/gif;base64,R0lGODlhAQABAIAAAP' } });
  assert.equal(bestImageSource(inline).src, 'data:image/gif;base64,R0lGODlhAQABAIAAAP');
});

test('bestImageSource: 空 img / 无任何源', () => {
  assert.deepEqual(bestImageSource(null), { src: '', thumbnailURL: '' });
  assert.deepEqual(bestImageSource(fakeImg()), { src: '', thumbnailURL: '' });
});

// ---------------------------------------------------------------------------
// 7. 标题启发式
// ---------------------------------------------------------------------------

test('bestTitleFromElement: title → alt → 链接文本 → 文档标题', () => {
  assert.equal(bestTitleFromElement(fakeElement({ title: 'Sunset' }), 'Doc'), 'Sunset');
  assert.equal(bestTitleFromElement(fakeElement({ alt: 'Alt text' }), 'Doc'), 'Alt text');
  const anchor = fakeElement({}, { textContent: 'Link text' });
  const node = fakeElement({}, { closest: (selector) => (selector === 'a' ? anchor : null) });
  assert.equal(bestTitleFromElement(node, 'Doc'), 'Link text');
  assert.equal(bestTitleFromElement(fakeElement(), 'Doc'), 'Doc');
  assert.equal(bestTitleFromElement(null, 'Doc'), 'Doc');
});

test('bestTitleFromElement: hash / UUID / 纯数字长串回退文档标题', () => {
  assert.equal(
    bestTitleFromElement(fakeElement({ title: 'd41d8cd98f00b204e9800998ecf8427e' }), 'Doc'),
    'Doc'
  );
  assert.equal(
    bestTitleFromElement(fakeElement({ title: '123e4567-e89b-12d3-a456-426614174000' }), 'Doc'),
    'Doc'
  );
  assert.equal(bestTitleFromElement(fakeElement({ title: '1234567890' }), 'Doc'), 'Doc');
  // 短数字 / 正常含数字的标题不应误伤
  assert.equal(bestTitleFromElement(fakeElement({ title: '123456789' }), 'Doc'), '123456789');
  assert.equal(bestTitleFromElement(fakeElement({ title: 'Post 2024' }), 'Doc'), 'Post 2024');
});

test('bestTitleFromElement: 非法 title 会跳到 alt', () => {
  assert.equal(
    bestTitleFromElement(fakeElement({ title: '0123456789abcdef0123456789abcdef', alt: '封面图' }), 'Doc'),
    '封面图'
  );
});

test('bestTitleFromElement: 折叠空白、去控制字符、限长', () => {
  assert.equal(bestTitleFromElement(fakeElement({ title: '  A   B  ' }), 'Doc'), 'A B');
  assert.equal(bestTitleFromElement(fakeElement({ title: 'A\tB\nC' }), 'Doc'), 'A B C');
  assert.equal(bestTitleFromElement(fakeElement({ title: 'x'.repeat(500) }), 'Doc').length, 300);
});

// ---------------------------------------------------------------------------
// 8. extractImageCandidate
// ---------------------------------------------------------------------------

test('extractImageCandidate: img + srcset + 外围链接', () => {
  const anchor = fakeElement(
    { href: '/photo/1' },
    {
      textContent: 'Photo title',
      baseURI: 'https://x/p/',
      closest: () => null
    }
  );
  const img = fakeImg({
    attrs: { srcset: 'a.jpg 400w, b.jpg 1200w', src: 'a.jpg', alt: 'Alt text' },
    currentSrc: 'https://x/p/a.jpg',
    naturalWidth: 1200,
    naturalHeight: 800,
    closest: (selector) => (selector === 'a' ? anchor : null)
  });
  assert.deepEqual(extractImageCandidate(img, { docTitle: 'Doc' }), {
    kind: 'image',
    url: 'https://x/p/b.jpg',
    thumbnailURL: 'https://x/p/a.jpg',
    title: 'Alt text',
    alt: 'Alt text',
    width: 1200,
    height: 800,
    linkUrl: 'https://x/photo/1'
  });
});

test('extractImageCandidate: 只有 src 时 thumbnailURL 为空串', () => {
  const img = fakeImg({ attrs: { src: 'https://x/only.jpg' } });
  assert.deepEqual(extractImageCandidate(img, { docTitle: 'Doc' }), {
    kind: 'image',
    url: 'https://x/only.jpg',
    thumbnailURL: '',
    title: 'Doc',
    alt: '',
    width: 0,
    height: 0,
    linkUrl: ''
  });
});

test('extractImageCandidate: picture/source 无内层 img 时直接用 srcset', () => {
  const picture = fakePicture([fakeSource({ srcset: 'p1.jpg 1x, p2.jpg 2x' })]);
  const candidate = extractImageCandidate(picture, { docTitle: 'Doc' });
  assert.ok(candidate);
  assert.equal(candidate.kind, 'image');
  assert.equal(candidate.url, 'https://x/p/p2.jpg');
  assert.equal(candidate.title, 'Doc');
  assert.equal(candidate.width, 0);
});

test('extractImageCandidate: canvas 导出 data URL', () => {
  const canvas = {
    tagName: 'CANVAS',
    width: 320,
    height: 200,
    toDataURL: () => 'data:image/png;base64,AAAA',
    getAttribute: () => null,
    closest: () => null
  };
  const candidate = extractImageCandidate(canvas, { docTitle: 'Doc' });
  assert.ok(candidate);
  assert.equal(candidate.url, 'data:image/png;base64,AAAA');
  assert.equal(candidate.width, 320);
  assert.equal(candidate.height, 200);
});

test('extractImageCandidate: 内联 SVG 序列化为 base64 data URL', () => {
  const OriginalSerializer = globalThis.XMLSerializer;
  class FakeSerializer {
    serializeToString() {
      return '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
    }
  }
  globalThis.XMLSerializer = FakeSerializer;
  try {
    const svg = fakeElement({}, { tagName: 'SVG', closest: () => null });
    const candidate = extractImageCandidate(svg, { docTitle: 'Doc' });
    assert.ok(candidate);
    assert.ok(candidate.url.startsWith('data:image/svg+xml;base64,'));
    const decoded = Buffer.from(candidate.url.split(',')[1], 'base64').toString('utf8');
    assert.ok(decoded.includes('<svg'));
  } finally {
    if (OriginalSerializer === undefined) delete globalThis.XMLSerializer;
    else globalThis.XMLSerializer = OriginalSerializer;
  }
});

test('extractImageCandidate: 背景图元素（fake getComputedStyle）', () => {
  const style = {
    backgroundImage: 'url(https://cdn.x.com/bg.jpg)',
    backgroundRepeat: 'no-repeat',
    backgroundSize: 'cover'
  };
  const node = fakeElement(
    {},
    {
      tagName: 'DIV',
      baseURI: 'https://x/p/',
      clientWidth: 640,
      clientHeight: 480,
      closest: () => null,
      ownerDocument: { defaultView: { getComputedStyle: () => style } }
    }
  );
  const candidate = extractImageCandidate(node, { docTitle: 'Doc' });
  assert.ok(candidate);
  assert.equal(candidate.url, 'https://cdn.x.com/bg.jpg');
  assert.equal(candidate.width, 640);
  assert.equal(candidate.height, 480);
});

test('extractImageCandidate: 祖先节点的背景图（最多 5 层）', () => {
  const noneStyle = { backgroundImage: 'none' };
  const bgStyle = { backgroundImage: 'url(https://cdn.x.com/parent-bg.jpg)' };
  const parent = fakeElement(
    {},
    {
      tagName: 'DIV',
      baseURI: 'https://x/p/',
      clientWidth: 320,
      clientHeight: 200,
      parentElement: null,
      closest: () => null
    }
  );
  const view = {
    getComputedStyle: (node) => (node === parent ? bgStyle : noneStyle)
  };
  parent.ownerDocument = { defaultView: view };
  const child = fakeElement(
    {},
    {
      tagName: 'SPAN',
      baseURI: 'https://x/p/',
      parentElement: parent,
      closest: () => null,
      ownerDocument: { defaultView: view }
    }
  );
  const candidate = extractImageCandidate(child, { docTitle: 'Doc' });
  assert.ok(candidate);
  assert.equal(candidate.url, 'https://cdn.x.com/parent-bg.jpg');
  assert.equal(candidate.width, 320);
});

test('extractImageCandidate: 找不到图源返回 null，不抛异常', () => {
  assert.equal(extractImageCandidate(null), null);
  assert.equal(extractImageCandidate(undefined), null);
  assert.equal(extractImageCandidate(fakeElement()), null);
  assert.doesNotThrow(() => extractImageCandidate(fakeElement({ src: 'https://x/a.jpg' })));
});

// ---------------------------------------------------------------------------
// 9. extractLinkCandidate
// ---------------------------------------------------------------------------

test('extractLinkCandidate: 绝对 href + 链接文本', () => {
  const anchor = fakeElement(
    { href: 'https://e.com/x' },
    {
      tagName: 'A',
      textContent: 'Example',
      baseURI: 'https://e.com/',
      closest(selector) {
        return selector === 'a' ? this : null;
      }
    }
  );
  assert.deepEqual(extractLinkCandidate(anchor, { docTitle: 'Doc' }), {
    kind: 'link',
    url: 'https://e.com/x',
    linkUrl: 'https://e.com/x',
    title: 'Example'
  });
});

test('extractLinkCandidate: 相对 href 用 baseURI 绝对化', () => {
  const anchor = fakeElement(
    { href: '/path/page' },
    {
      tagName: 'A',
      textContent: 'Page',
      baseURI: 'https://e.com/root/',
      closest(selector) {
        return selector === 'a' ? this : null;
      }
    }
  );
  assert.equal(extractLinkCandidate(anchor).url, 'https://e.com/path/page');
});

test('extractLinkCandidate: title 属性优先，非 http 链接返回 null', () => {
  const titled = fakeElement(
    { href: 'https://e.com/x', title: 'Titled' },
    {
      tagName: 'A',
      textContent: 'Text',
      baseURI: 'https://e.com/',
      closest(selector) {
        return selector === 'a' ? this : null;
      }
    }
  );
  assert.equal(extractLinkCandidate(titled).title, 'Titled');

  for (const href of ['javascript:void(0)', 'mailto:a@b.com', 'tel:123456', '#anchor', '']) {
    const anchor = fakeElement(
      { href },
      {
        tagName: 'A',
        textContent: 'x',
        baseURI: 'https://e.com/',
        closest: () => null
      }
    );
    assert.equal(extractLinkCandidate(anchor), null, `href=${href} 应返回 null`);
  }
  assert.equal(extractLinkCandidate(null), null);
});

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------

if (failures.length > 0) {
  for (const { name, error } of failures) {
    console.error(`FAIL ${name}`);
    console.error(`     ${error && error.message ? error.message : error}`);
  }
  console.error(`unit-extract: ${passed} passed, ${failures.length} failed`);
  process.exitCode = 1;
} else {
  console.log(`unit-extract: ${passed} passed`);
}
