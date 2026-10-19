/**
 * test/unit-url-rules.mjs — URL 放大规则表单测
 *
 * 运行：node test/unit-url-rules.mjs
 *
 * 覆盖：
 * - 规则表结构（56 条、站点唯一、pattern 可编译、replace 为函数、needsVerify / ignoreCheck 标记）
 * - 56 条规则逐条真实改写（含 deviantArt token 内嵌 JSON 的纯计算还原）
 * - 无命中 / 非 http(s) / 非法入参 / 幂等 / 不抛异常
 */

import assert from 'node:assert/strict';
import { URL_RULES, ENLARGE_RULE_COUNT, enlargeUrl, fallbackUrls } from '../background/url-rules.js';

let passed = 0;
const failures = [];
/** 被"命中"过的规则站点名，用于最后校验 56 条规则全部覆盖。 */
const hitSites = new Set();

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

/** 断言一次真实改写（站点名精确匹配）。 */
function expectRewrite(input, output, site) {
  const result = enlargeUrl(input);
  assert.equal(result.hit, true, `应命中规则：${input}`);
  assert.equal(result.site, site, `命中站点不符：${input}`);
  assert.equal(result.url, output, `改写结果不符：${input}`);
  hitSites.add(result.site);
}

// ---------------------------------------------------------------------------
// 1. 规则表结构
// ---------------------------------------------------------------------------

test('规则总数 56 且与 ENLARGE_RULE_COUNT 一致', () => {
  assert.ok(Array.isArray(URL_RULES));
  assert.equal(URL_RULES.length, 56);
  assert.equal(ENLARGE_RULE_COUNT, 56);
  assert.equal(ENLARGE_RULE_COUNT, URL_RULES.length);
});

test('每条规则结构完整、pattern 可编译、replace 为函数', () => {
  for (const rule of URL_RULES) {
    assert.equal(typeof rule.site, 'string');
    assert.ok(rule.site.length > 0);
    assert.ok(rule.pattern instanceof RegExp || typeof rule.pattern === 'string');
    assert.equal(typeof rule.replace, 'function');
    const regexp = rule.pattern instanceof RegExp ? rule.pattern : new RegExp(rule.pattern);
    assert.ok(regexp instanceof RegExp);
  }
});

test('站点名不重复', () => {
  const sites = URL_RULES.map((rule) => rule.site);
  assert.equal(new Set(sites).size, sites.length);
});

test('replace 对任意 URL 都不抛异常且返回字符串', () => {
  const bogus = 'https://example.com/not-a-real-image.jpg';
  for (const rule of URL_RULES) {
    let value;
    assert.doesNotThrow(() => {
      value = rule.replace(bogus, null);
    }, `规则 ${rule.site} 的 replace 抛异常`);
    assert.equal(typeof value, 'string', `规则 ${rule.site} 的 replace 未返回字符串`);
  }
});

test('需要联网校验的规则被标记 needsVerify', () => {
  const verifySites = URL_RULES.filter((rule) => rule.needsVerify === true).map((rule) => rule.site);
  assert.deepEqual(verifySites.sort(), [
    'Artstation',
    'Pinterest',
    'pixiv',
    'twitter',
    'wordpress 通用 2.0 (asnyc)'
  ]);
});

test('Eagle 中标记 ignoreCheck 的规则保留该字段', () => {
  const ignoreSites = URL_RULES.filter((rule) => rule.ignoreCheck === true).map((rule) => rule.site);
  assert.deepEqual(ignoreSites.sort(), ['Artstation', 'pixiv', '新浪微博 weibo']);
});

// ---------------------------------------------------------------------------
// 2. 56 条规则的真实改写
// ---------------------------------------------------------------------------

/** @type {{ site: string, input: string, output: string, note?: string }[]} */
const REWRITES = [
  {
    site: 'Reddit',
    input: 'https://preview.redd.it/abc-v2-xyz.jpg?width=640&format=pjpg&auto=webp',
    output: 'https://i.redd.it/xyz.jpg'
  },
  {
    site: 'behance',
    input: 'https://mir-s3-cdn-cf.behance.net/project_modules/max_1200/abc/def.jpg',
    output: 'https://mir-s3-cdn-cf.behance.net/project_modules/source/abc/def.jpg'
  },
  {
    site: 'behance',
    input: 'https://mir-s3-cdn-cf.behance.net/project_modules/1400/abc/def.jpg',
    // Eagle 原链会拼出 /project_modules//source//，这里归一为单斜杠（见 url-rules.js 注释）
    output: 'https://mir-s3-cdn-cf.behance.net/project_modules/source/abc/def.jpg'
  },
  {
    site: 'imgur',
    input: 'https://i.imgur.com/abc.jpg',
    output: 'https://i.imgur.com/abc.jpg?maxwidth=99999'
  },
  {
    site: 'imgur',
    input: 'https://i.imgur.com/abc.jpg?1',
    output: 'https://i.imgur.com/abc.jpg?maxwidth=99999'
  },
  {
    site: 'twitter',
    input: 'https://pbs.twimg.com/media/x?format=jpg&name=small',
    output: 'https://pbs.twimg.com/media/x?format=jpg&name=orig'
  },
  {
    site: 'Bluesky',
    input: 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:abc/bafy123@jpeg',
    output: 'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:abc/bafy123@jpeg'
  },
  {
    site: 'midjourney',
    input: 'https://cdn.midjourney.com/abc/uuid_0_0_640_N.webp',
    output: 'https://cdn.midjourney.com/abc/uuid_0_0.png'
  },
  {
    site: '花瓣网 (v4) - 增加了 ?auth_key 支援',
    input: 'https://gd-hbimg-edge.huabanimg.com/abc_sq235?auth_key=xyz',
    output: 'https://gd-hbimg-edge.huabanimg.com/abc?auth_key=xyz'
  },
  {
    site: '花瓣网 (v3)',
    input: 'https://gd-hbimg.huaban.com/abc_sq235.jpg',
    output: 'https://gd-hbimg.huaban.com/abc'
  },
  {
    site: '花瓣网 (v3)',
    input: 'https://gd-hbimg.huaban.com/abc_fw658webp',
    output: 'https://gd-hbimg.huaban.com/abc'
  },
  {
    site: '花瓣网 (v2)',
    input: 'https://hbimg.huaban.com/abc_sq75',
    output: 'https://hbimg.huaban.com/abc'
  },
  {
    site: '花瓣网 (v1)',
    input: 'https://hbimg.huabanimg.com/abc_sq75',
    output: 'https://hbimg.huabanimg.com/abc'
  },
  {
    site: '大作',
    input: 'https://x.bigurl.com/pc_236_webp_2x/abc.jpg',
    output: 'https://x.bigurl.com/pc_680_webp/abc.jpg'
  },
  {
    site: 'Lapa.ninja',
    input: 'https://cdn.lapaninja.com/a-thumb.jpg',
    output: 'https://cdn.lapaninja.com/a.jpg'
  },
  {
    site: 'Dribbble',
    input: 'https://cdn.dribbble.com/users/123/screenshots/456/abc_1x.jpg',
    output: 'https://cdn.dribbble.com/users/123/screenshots/456/abc.jpg'
  },
  {
    site: 'Pexels',
    input: 'https://images.pexels.com/photos/123/x.jpg?w=800',
    output: 'https://images.pexels.com/photos/123/x.jpg?auto=compress'
  },
  {
    site: 'Tenor',
    input: 'https://media.tenor.com/abc123/d/hello.gif',
    output: 'https://media.tenor.com/abc123/C/hello.gif'
  },
  {
    site: '新浪微博 weibo',
    input: 'https://wx1.sinaimg.cn/thumb150/abc.jpg',
    output: 'https://wx1.sinaimg.cn/large/abc.jpg'
  },
  {
    site: '百度贴吧',
    input: 'http://tiebapic.baidu.com/forum/abpic/item/abc.jpg',
    output: 'http://tiebapic.baidu.com/forum/pic/item/abc.jpg'
  },
  {
    site: '豆瓣相册',
    input: 'https://img9.doubanio.com/view/photo/l/public/p123.jpg',
    output: 'https://img9.doubanio.com/view/photo/orginal/public/p123.jpg'
  },
  {
    site: 'pixAI.Art',
    input: 'https://images-ng.pixai.art/images/thumb/abc',
    output: 'https://images-ng.pixai.art/images/orig/abc'
  },
  {
    site: 'Flickr',
    input: 'https://live.staticflickr.com/65535/12345_abc_n.jpg',
    output: 'https://live.staticflickr.com/65535/12345_abc_b.jpg'
  },
  {
    site: '颇可网 | poco.cn | 舊版, 相容性不確定',
    input: 'http://imgd.pocoimg.cn/a_120.jpg',
    output: 'http://imgd.pocoimg.cn/a.jpg'
  },
  {
    site: '颇可网 | poco.cn | 新版',
    input: 'https://img.pocoimg.cn/a_H120.jpg',
    output: 'https://img.pocoimg.cn/a.jpg'
  },
  {
    site: '蘑菇街',
    input: 'https://a.mogucdn.com/p1/abc_300x400.jpg',
    output: 'https://a.mogucdn.com/p1/abc_468x468.jpg'
  },
  {
    site: 'Pinterest',
    input: 'https://i.pinimg.com/236x/ab/cd/xyz.jpg',
    output: 'https://i.pinimg.com/originals/ab/cd/xyz.jpg'
  },
  {
    site: 'pixiv',
    input:
      'https://i.pximg.net/c/250x250_80_a2/img-master/img/2020/01/01/00/00/00/12345_p0_master1200.jpg',
    output: 'https://i.pximg.net/img-original/img/2020/01/01/00/00/00/12345_p0.jpg'
  },
  {
    site: '1688',
    input: 'https://cbu01.alicdn.com/img/ibank/abc.310x310.jpg',
    output: 'https://cbu01.alicdn.com/img/ibank/abc.jpg'
  },
  {
    site: '淘宝',
    input: 'https://img.alicdn.com/imgextra/i4/abc_430x430.jpg',
    output: 'https://img.alicdn.com/imgextra/i4/abc'
  },
  {
    site: '天猫',
    input: 'https://img.alicdn.com/imgextra/i4/abc_430x430q90.jpg',
    output: 'https://img.alicdn.com/imgextra/i4/abc'
  },
  {
    site: 'Amazon',
    input: 'https://m.media-amazon.com/images/I/71abc._AC_SL1500_.jpg',
    output: 'https://m.media-amazon.com/images/I/71abc.jpg'
  },
  {
    site: '京东',
    input: 'https://img13.360buyimg.com/n1/jfs/t1/abc.jpg!q90',
    output: 'https://img13.360buyimg.com/n0/jfs/t1/abc.jpg'
  },
  {
    site: 'Houzz',
    input: 'https://st.hzcdn.com/fimgs/abc-w100-h100-b0-p0.jpg',
    output: 'https://st.hzcdn.com/simgs/abc.jpg'
  },
  {
    site: 'HouseBeautiful',
    input: 'https://hips.hearstapps.com/x/y.jpg?w=1200&resize=980:*',
    output: 'https://hips.hearstapps.com/x/y.jpg?w=1200'
  },
  {
    site: 'Officesnapshots',
    input: 'https://officesnapshots.com/x/abc-800x600.jpg',
    output: 'https://officesnapshots.com/x/abc.jpg'
  },
  {
    site: 'Archilovers',
    input: 'https://cdn.archilovers.com/x/thumb1_abc.jpg',
    output: 'https://cdn.archilovers.com/x/abc.jpg'
  },
  {
    site: 'AD',
    input: 'https://media.architecturaldigest.com/photos/x/w_1200,h_800/abc.jpg',
    output: 'https://media.architecturaldigest.com/photos/x/w_5000/abc.jpg'
  },
  {
    site: 'Archdaily 中文版',
    input: 'https://images.adsttc.com.qtlcn.com/x/thumb_jpg/abc.jpg',
    output: 'https://images.adsttc.com.qtlcn.com/x/large_jpg/abc.jpg'
  },
  {
    site: 'ArchDaily 国际版',
    input: 'https://images.adsttc.com/x/slideshow/abc.jpg',
    output: 'https://images.adsttc.com/x/large_jpg/abc.jpg'
  },
  {
    site: 'Dezeen',
    input: 'https://static.dezeen.com/x/slideshow/abc-800x600.jpg',
    output: 'https://static.dezeen.com/x/large_jpg/abc.jpg'
  },
  {
    site: 'wordpress 通用 2.0 (asnyc)',
    input: 'https://site.com/wp-content/uploads/2018/01/abc-800x600.jpg?w=1200',
    output: 'https://site.com/wp-content/uploads/2018/01/abc.jpg'
  },
  {
    site: 'Squarespace 通用',
    input: 'https://static1.squarespace.com/static/abc/t/def/photo.jpg?format=750w',
    output: 'https://static1.squarespace.com/static/abc/t/def/photo.jpg?format=3000w'
  },
  {
    site: 'bilibili专栏',
    input: 'https://i0.hdslb.com/bfs/article/abc.jpg@1192w_1192h.webp',
    output: 'https://i0.hdslb.com/bfs/article/abc.jpg'
  },
  {
    site: 'AliyunOSS 通用',
    input: 'https://bucket.oss-cn-hangzhou.aliyuncs.com/a.jpg?x-oss-process=image/resize,w_200',
    output: 'https://bucket.oss-cn-hangzhou.aliyuncs.com/a.jpg'
  },
  {
    site: '小红书',
    input: 'https://sns-webpic-qc.xhscdn.com/202401/abc123def0/1040g0083123456789!nd_dft_wlteh_webp_3',
    output: 'https://sns-img-hw.xhscdn.com/1040g0083123456789'
  },
  {
    site: 'Medium',
    input: 'https://cdn-images-1.medium.com/max/1200/1*abc.png',
    output: 'https://cdn-images-1.medium.com/1*abc.png'
  },
  {
    site: 'Medium | 新版',
    input: 'https://miro.medium.com/v2/resize:fit:1400/1*abc.png',
    output: 'https://miro.medium.com/v2/1*abc.png'
  },
  {
    site: 'Artstation',
    input: 'https://cdna.artstation.com/p/assets/images/images/012/345/678/micro_square/abc.jpg',
    output: 'https://cdna.artstation.com/p/assets/images/images/012/345/678/large/abc.jpg'
  },
  {
    site: 'GameUI',
    input: 'https://image.gameuiux.cn/x/abc_list.png',
    output: 'https://image.gameuiux.cn/x/abc_detail.png'
  },
  {
    site: 'GameUI2',
    input: 'https://img.gameui.net/abc-1@100x100.webp',
    output: 'https://img.gameui.net/abc.webp'
  },
  {
    site: 'interiordesign',
    input: 'https://d4qwptktddc5f.cloudfront.net/easy_thumbnails/thumbs_abc.jpg?x=1',
    output: 'https://d4qwptktddc5f.cloudfront.net/abc.jpg'
  },
  {
    site: 'meiye',
    input: 'https://image.meiye.art/x/a.jpg?imageMogr2/thumbnail/200x&vframe=1',
    output: 'https://image.meiye.art/x/a.jpg'
  },
  {
    site: '即刻',
    input: 'https://cdn-ruguoapp.ruguoapp.com/x/a.jpg?imageMogr2/thumbnail/200x',
    output: 'https://cdn-ruguoapp.ruguoapp.com/x/a.jpg'
  },
  {
    site: '腾讯云 通用',
    input: 'https://bucket.cos.ap-shanghai.myqcloud.com/a.jpg?imageMogr2/thumbnail/200x',
    output: 'https://bucket.cos.ap-shanghai.myqcloud.com/a.jpg'
  },
  {
    site: '腾讯云 通用 #2',
    input: 'https://bucket.cos.myqcloud.com/a.jpg?imageView2/2/w/300',
    output: 'https://bucket.cos.myqcloud.com/a.jpg'
  }
];

for (const item of REWRITES) {
  test(`改写 ${item.site}: ${item.input}`, () => expectRewrite(item.input, item.output, item.site));
}

test('deviantArt: token 内嵌 JSON 反推原图宽高（纯计算，不联网）', () => {
  const payload = { obj: [[{ width: '<=1600', height: '<=1200' }]] };
  const token = `aaa.${Buffer.from(JSON.stringify(payload)).toString('base64')}.sig`;
  const input = `https://images-ctte.wixmp.com/f/abc/v1/fill/w_600,h_600,q_80/xyz.jpg?token=${token}`;
  expectRewrite(
    input,
    `https://images-ctte.wixmp.com/f/abc/v1/fill/w_1600,h_1200,q_100/xyz.jpg?token=${token}`,
    'deviantArt'
  );
});

test('deviantArt: token 非法 / 缺失时回退原值', () => {
  const input = 'https://images-ctte.wixmp.com/f/abc/v1/fill/w_600,h_600,q_80/xyz.jpg?token=bad.token.sig';
  const result = enlargeUrl(input);
  assert.equal(result.hit, true);
  assert.equal(result.site, 'deviantArt');
  assert.equal(result.url, input);
});

test('Archiproducts: Eagle 的替换链会改写路径（仅断言命中且结果变化）', () => {
  const input = 'https://img.edilportale.com/x/-thumbs/abc_s_/y.jpg';
  const result = enlargeUrl(input);
  assert.equal(result.hit, true);
  assert.equal(result.site, 'Archiproducts');
  assert.notEqual(result.url, input);
  hitSites.add(result.site);
});

test('officesnapshots wordpress: 被前面的 Officesnapshots 规则遮蔽，按规则函数单独验证', () => {
  // 顺序与 Eagle 一致：Officesnapshots 的广域 pattern 先命中，因此这条规则实际不会被走到。
  const rule = URL_RULES.find((item) => item.site === 'officesnapshots wordpress');
  assert.ok(rule);
  assert.equal(
    rule.replace('https://officesnapshots.com/wp-content/uploads/2018/01/abc-800x600-scaled.jpg', null),
    'https://officesnapshots.com/wp-content/uploads/2018/01/abc.jpg'
  );
  hitSites.add(rule.site);
});

test('规则顺序：同一 URL 命中多个 pattern 时取第一个（花瓣 v4 优先于 v1/v2）', () => {
  const result = enlargeUrl('https://gd-hbimg-edge.huabanimg.com/abc_sq235?auth_key=1');
  assert.equal(result.site, '花瓣网 (v4) - 增加了 ?auth_key 支援');
});

test('56 条规则全部有真实改写用例覆盖', () => {
  const expected = URL_RULES.map((rule) => rule.site).sort();
  const covered = [...hitSites].sort();
  assert.deepEqual(covered, expected);
});

// ---------------------------------------------------------------------------
// 3. 边界与健壮性
// ---------------------------------------------------------------------------

test('无匹配的 http 地址原样返回且 hit=false', () => {
  for (const url of [
    'https://example.com/photo.jpg',
    'https://i.redd.it/abc.jpg',
    'https://cdn.bsky.app/img/feed_thumbnail/plain/x/y@png'
  ]) {
    const result = enlargeUrl(url);
    assert.equal(result.url, url);
    assert.equal(result.hit, false);
    assert.equal(result.site, null);
  }
});

test('data: / blob: / 协议相对地址不参与放大', () => {
  for (const url of [
    'data:image/png;base64,AAAA',
    'blob:https://example.com/8f14e45f',
    '//i.imgur.com/abc.jpg'
  ]) {
    const result = enlargeUrl(url);
    assert.equal(result.url, url);
    assert.equal(result.hit, false);
    assert.equal(result.site, null);
  }
});

test('空值与非字符串入参不抛异常', () => {
  assert.deepEqual(enlargeUrl(''), { url: '', hit: false, site: null });
  assert.deepEqual(enlargeUrl(null), { url: '', hit: false, site: null });
  assert.deepEqual(enlargeUrl(undefined), { url: '', hit: false, site: null });
  assert.deepEqual(enlargeUrl(42), { url: '42', hit: false, site: null });
  assert.deepEqual(enlargeUrl({}), { url: '[object Object]', hit: false, site: null });
});

test('超长 / 畸形 URL 不抛异常', () => {
  const longUrl = `https://i.imgur.com/${'a'.repeat(20000)}.jpg`;
  assert.doesNotThrow(() => enlargeUrl(longUrl));
  assert.doesNotThrow(() => enlargeUrl('not a url at all'));
  assert.doesNotThrow(() => enlargeUrl('https://'));
  assert.doesNotThrow(() => enlargeUrl('https://a b c/中文.jpg'));
});

test('幂等：重复调用结果一致；连续放大不会累积改动', () => {
  const input = 'https://preview.redd.it/abc-v2-xyz.jpg';
  const first = enlargeUrl(input);
  const second = enlargeUrl(input);
  assert.deepEqual(first, second);
  assert.equal(enlargeUrl(first.url).url, first.url);
});

test('不修改规则表本身', () => {
  const before = URL_RULES.length;
  const sites = URL_RULES.map((rule) => rule.site);
  enlargeUrl('https://i.imgur.com/abc.jpg');
  enlargeUrl('https://example.com/x.jpg');
  assert.equal(URL_RULES.length, before);
  assert.deepEqual(
    URL_RULES.map((rule) => rule.site),
    sites
  );
});

test('小红书 CDN：sns-img-al 已失效，改用 sns-img-hw 且提供 bd 备用', () => {
  const out = enlargeUrl('https://sns-webpic.xhscdn.com/202401/abc123def0/1040g0083123456789!nd_dft_wlteh_webp_3');
  assert.equal(out.url, 'https://sns-img-hw.xhscdn.com/1040g0083123456789');
  assert.deepEqual(fallbackUrls(out.url), ['https://sns-img-bd.xhscdn.com/1040g0083123456789']);
  assert.deepEqual(fallbackUrls('https://example.com/x.jpg'), []);
  // 已经是公开 CDN 的地址不再二次改写
  assert.equal(enlargeUrl('https://sns-img-hw.xhscdn.com/1040g0083123456789').hit, false);
});

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------

if (failures.length > 0) {
  for (const { name, error } of failures) {
    console.error(`FAIL ${name}`);
    console.error(`     ${error && error.message ? error.message : error}`);
  }
  console.error(`unit-url-rules: ${passed} passed, ${failures.length} failed`);
  process.exitCode = 1;
} else {
  console.log(`unit-url-rules: ${passed} passed`);
}
