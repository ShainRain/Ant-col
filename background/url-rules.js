/**
 * background/url-rules.js — URL 放大规则表（移植自 Eagle 扩展 js/lib/api/url-enlarger.js）
 *
 * 设计约束：
 * - 纯模块：不联网、不依赖 chrome / DOM，Node 可直接 import（供单测）。
 * - Eagle 中通过 fetch(HEAD) / Image() 做存在性校验的 replaceAsync 规则，
 *   这里统一改为纯字符串改写，并在规则上标记 needsVerify: true，
 *   由调用方（后台或页面）决定是否再做 HEAD / Image 校验并在失败时回退原图。
 * - pattern 支持 RegExp 或字符串（字符串按正则源码构造），与 Eagle 的 srcPattern 完全一致。
 * - 规则顺序即优先级：第一个命中的规则生效（与 Eagle isEnlargable + find 的顺序一致）。
 * - 规则表保持可变（未冻结）：调用方可以按站点开关 / 统计命中，但不要修改 pattern 类型。
 *
 * 安全边界：enlargeUrl 只处理 http(s) 绝对地址；data: / blob: / 相对地址原样返回且 hit=false。
 */

/** @typedef {{ site: string, pattern: RegExp | string, replace: (url: string, match?: RegExpExecArray | null) => string, needsVerify?: boolean, ignoreCheck?: boolean }} UrlRule */

const RULES = [
  {
    site: 'Reddit',
    pattern: 'https://preview.redd.it/(.*)',
    replace: (url) => {
      try {
        return (
          'https://i.redd.it/' +
          new URL(url)
            .pathname.split('/')
            .pop()
            .replace(/^.*-v\d+-/, '')
        );
      } catch {
        return url.split('?')[0].replace('preview.redd.it', 'i.redd.it');
      }
    }
  },
  {
    site: 'deviantArt',
    pattern: /https:\/\/images\S+\.wixmp\.com\/f\/\S+\/v1\/fill\/\S+\?token\S+/,
    // Eagle 用 token 里内嵌的 JSON 反推原图宽高；纯计算，不联网。
    replace: (url) => {
      try {
        const token = new URL(url).searchParams.get('token');
        if (!token) return url;
        const payload = decodeBase64UrlJson(token.split('.')[1]);
        const box = payload?.obj?.[0]?.[0];
        if (!box?.width || !box?.height) return url;
        const width = String(box.width).replace('<=', '');
        const height = String(box.height).replace('<=', '');
        return url.replace(/\/w_\d+,h_\d+,q_\d+/, `/w_${width},h_${height},q_100`);
      } catch {
        return url;
      }
    }
  },
  {
    site: 'behance',
    pattern: /(.*)behance.net\/(project_modules|projects)\/(.*)/,
    // 注：Eagle 原写法把 "/source/" 直接拼进 project_modules/${r}/，会产出
    // "/project_modules//source//" 这类双斜杠路径（CDN 视为不同 key，通常 404）。
    // 这里归一为单斜杠；其余替换串与 Eagle 逐条一致。
    replace: (url) => {
      const source = '/source/';
      return url
        .replace('/max_1200/', source)
        .replace(/\/max_\d+(_webp)?\//, source)
        .replace('/2800_opt_1/', source)
        .replace('/1400_opt_1/', source)
        .replace('/disp/', source)
        .replace(/project_modules\/\d+\//, 'project_modules/source/')
        .replace(/projects\/\d+\//, 'projects/source/');
    }
  },
  {
    site: 'imgur',
    pattern: /(.*)i\.imgur\.com\/(.*)/,
    // Eagle 仅在已有 query 时替换；这里对无 query 的情况补上 maxwidth（否则规则等于空转）。
    replace: (url) => (url.includes('?') ? url.replace(/\?(.*)/, '?maxwidth=99999') : `${url}?maxwidth=99999`)
  },
  {
    site: 'twitter',
    pattern: /(.*)twimg.com(.*)name=(.*)/,
    // Eagle 会并行 HEAD 探测 format=jpg / format=webp；纯模块只做 name=orig 改写。
    needsVerify: true,
    replace: (url) => url.replace(/name=(.*)/, 'name=orig')
  },
  {
    site: 'Bluesky',
    pattern: 'https://cdn.bsky.app/img/feed_thumbnail/plain/(.*)@jpeg',
    replace: (url) => url.replace('feed_thumbnail', 'feed_fullsize')
  },
  {
    site: 'midjourney',
    pattern: 'https://cdn.midjourney.com/(.*)',
    replace: (url) => url.replace(/_\d+_N/, '').replace(/\.webp/, '.png')
  },
  {
    site: '花瓣网 (v4) - 增加了 ?auth_key 支援',
    pattern: 'https://gd-hbimg-edge.huaban(img)?.com/(.*)',
    replace: (url) =>
      url
        .replace(/_\/fw[^?]*(?=\?|$)/, '')
        .replace(/_sq\d+\/format[^?]*(?=\?|$)/, '')
        .replace(/\/format\/[^?]*(?=\?|$)/, '')
        .replace(/_sq\d+\w*(?=\?|$)/, '')
        .replace(/_fw\d+\w*(?=\?|$)/, '')
        .replace(/small\//, '')
  },
  {
    site: '花瓣网 (v3)',
    pattern: 'https://gd-hbimg.huaban(img)?.com/(.*)',
    replace: (url) =>
      url
        .replace(/_\/fw(.*)/, '')
        .replace(/_sq\d+\/format(.*)/, '')
        .split('/format/')[0]
        .replace(/_sq235$/, '')
        .replace(/_sq75$/, '')
        .replace(/_sq(.*)$/, '')
        .replace(/_fw[\d]+[w]*$/, '')
        .split('_fw')[0]
        .split('/fw/')[0]
        .replace(/small\//, '')
  },
  {
    site: '花瓣网 (v2)',
    pattern: '(.*)hbimg.huaban.com/(.*)',
    replace: (url) =>
      url
        .replace(/_\/fw(.*)/, '')
        .replace(/_sq\d+\/format(.*)/, '')
        .split('/format/')[0]
        .replace(/_sq235$/, '')
        .replace(/_sq75$/, '')
        .replace(/_sq(.*)$/, '')
        .replace(/_fw[\d]+[w]*$/, '')
        .split('_fw')[0]
        .split('/fw/')[0]
  },
  {
    site: '花瓣网 (v1)',
    pattern: '//hbimg[.]*/*',
    replace: (url) =>
      url
        .split('/format/')[0]
        .replace(/_sq235$/, '')
        .replace(/_sq75$/, '')
        .replace(/_fw[\d]+[w]*$/, '')
        .split('_fw')[0]
        .split('/fw/')[0]
  },
  {
    site: '大作',
    pattern: '(.*)bigurl(.*)',
    replace: (url) =>
      url.replace('pc_236_webp_2x', 'pc_680_webp').replace('pc_236_webp', 'pc_680_webp')
  },
  {
    site: 'Lapa.ninja',
    pattern: '(.*)cdn.lapaninja.com(.*)',
    replace: (url) => url.replace('-thumb.jpg', '.jpg')
  },
  {
    site: 'Dribbble',
    pattern: 'https://cdn.dribbble.com/*',
    replace: (url) =>
      url.includes('userupload') || (url.includes('screenshots') && url.includes('media'))
        ? url.split('?')[0]
        : url.includes('screenshots') && url.includes('.gif')
          ? url.split('?')[0].replace('_4x', '')
          : url.includes('/videos/')
            ? url.replace('_large_preview', '')
            : url.includes('/attachments/')
              ? url
              : url.replace(/_1x/g, '').replace(/_teaser/g, '')
  },
  {
    site: 'Pexels',
    pattern: 'https?://images.pexels.com/*',
    replace: (url) => `${url.split('?')[0]}?auto=compress`
  },
  {
    site: 'Tenor',
    pattern: 'https://media.tenor.com/*',
    replace: (url) => url.replace(/(d|M)\//, 'C/')
  },
  {
    site: '新浪微博 weibo',
    pattern: /(.*)\/\/.*[.]sinaimg[.]cn\/([a-z]*)(\d+)\//,
    ignoreCheck: true,
    replace: (url) => (url.includes('.mp4') ? url : url.replace(/(cn)\/([a-z]*)(\d+)\//, 'cn/large/'))
  },
  {
    site: '百度贴吧',
    pattern: 'https?://tiebapic[.]baidu[.]com/forum.*',
    replace: (url) => {
      const abpic = url.match(/^(http:\/\/tiebapic\.baidu\.com\/forum\/)ab(pic\/item\/[\w.]+)/i);
      if (/\/sys\/portrait/.test(url)) return url.replace(/\/sys\/portrait/, '/sys/portraitl');
      if (abpic) return abpic[1] + abpic[2];
      const sign = url.match(/\/sign=\w+\/([\w.]+)$/);
      if (sign) return `http://tiebapic.baidu.com/forum/pic/item/${sign[1]}`;
      return url;
    }
  },
  {
    site: '豆瓣相册',
    pattern: /https?:\/\/img[\d]*\.doubanio\.com\/.*/,
    replace: (url) =>
      url
        .replace(/[/]s[/]/, '/orginal/')
        .replace(/[/]m[/]/, '/orginal/')
        .replace(/[/]l[/]/, '/orginal/')
        .replace(/[/]sqs[/]/, '/orginal/')
  },
  {
    site: 'pixAI.Art',
    pattern: 'https://images-ng.pixai.art/images/thumb/*',
    replace: (url) => url.replace('/thumb/', '/orig/')
  },
  {
    site: 'Flickr',
    pattern: '.*[.]staticflickr[.]com.*',
    replace: (url) => url.replace(/_[nms]\.jpg$/, '_b.jpg')
  },
  {
    site: '颇可网 | poco.cn | 舊版, 相容性不確定',
    pattern: 'http?://img[d].*pocoimg*',
    replace: (url) => url.replace(/_\d{3}.jpg$/, '.jpg')
  },
  {
    site: '颇可网 | poco.cn | 新版',
    pattern: 'https://(.*).pocoimg.cn/(.*)',
    replace: (url) => url.replace(/_H\d+./, '.')
  },
  {
    site: '蘑菇街',
    pattern: 'https?://.*[.]mogucdn[.]com/.*.jpg',
    replace: (url) => `${url.replace(/_[\d]{3}x[\d]+.jpg$/, '_468x468.jpg').split('.jpg')[0]}.jpg`
  },
  {
    site: 'Pinterest',
    pattern: 'https://(.*).pinimg.com/(.*).(jpg|png|webp)',
    // Eagle 会 HEAD 探测 .jpg/.png/.webp/.gif 哪个可用；纯模块只做尺寸目录改写。
    needsVerify: true,
    replace: (url) => {
      try {
        if (url.includes('75x75_RS') || !/\.(jpg|png|webp)/.test(url)) return url;
        return url
          .replace(/[0-9]+x/g, 'originals')
          .replace('/enabled/', '/')
          .replace('/enabled_lo/', '/')
          .replace('/enabled_hi/', '/')
          .replace('/vwebp/', '/')
          .replace('/control/', '/');
      } catch {
        return url;
      }
    }
  },
  {
    site: 'pixiv',
    pattern: /(.*)\/\/i\.pximg\.net\/(.*)/,
    ignoreCheck: true,
    // Eagle 会探测 .jpg / .png 哪个存在；纯模块保留原扩展名。
    needsVerify: true,
    replace: (url) =>
      url
        .replace(/c\/\d+x\d+_\d+(_[A-z0-9]{2}){0,1}\//, '')
        .replace(/img-master/, 'img-original')
        .replace(/custom-thumb/, 'img-original')
        .replace(/_(master|square|custom)1200/, '')
  },
  {
    site: '1688',
    pattern: 'https?://cbu01.alicdn.com/img/ibank/.*..*x.*.jpg',
    replace: (url) => url.replace(/\.\d+x.*\./, '.')
  },
  {
    site: '淘宝',
    pattern: /.(?:taobao|tb|ali)cdn(.+)_\d+x\d+.jpg(.*)/,
    replace: (url) => url.replace(/_\d+x\d+.jpg(_\.webp)?/, '')
  },
  {
    site: '天猫',
    pattern: /.(?:taobao|tb|ali)cdn(.+)_\d+x\d+\S\d+.jpg(.*)/,
    replace: (url) => url.replace(/_\d+x\d+\S\d+.jpg(_\.webp)?/, '')
  },
  {
    site: 'Amazon',
    pattern: 'https://(images-na.ssl-images|images-fe.ssl-images|m.media)-amazon.com/images/(.*)',
    replace: (url) => url.replace(/\._\S+\./, '.')
  },
  {
    site: '京东',
    pattern: 'https://.*.360buyimg.com.*',
    replace: (url) =>
      url
        .replace(/\/n\d+\//, '/n0/')
        .replace(/s\d+x\d+_?/, '')
        .split('!cc')[0]
        .split('!q')[0]
        .replace(/.jpg.avif/, '.jpg')
  },
  {
    site: 'Houzz',
    pattern: 'https://st.hzcdn.com/fimgs/*',
    replace: (url) =>
      url.replace(/_/, '_14-').replace('fimgs', 'simgs').replace(/-w\d+-h\d+-b0-p0/, '')
  },
  {
    site: 'HouseBeautiful',
    pattern: 'https://hips[.]hearstapps[.]com/.*',
    replace: (url) => url.replace(/[.]jpg{1,}/, '.jpg').split('&resize=')[0]
  },
  {
    site: 'Officesnapshots',
    pattern: 'https://officesnapshots[.]com/.*',
    replace: (url) => url.replace(/-\d{3,4}x\d{3,4}/, '')
  },
  {
    site: 'Archilovers',
    pattern: 'https://cdn.archilovers.com/.*',
    replace: (url) => url.replace(/(\S_\d+_|thumb\d_)/, '')
  },
  {
    site: 'AD',
    pattern: 'https://media[.]architecturaldigest[.]com/.*',
    replace: (url) => url.replace(/w_\d+/, 'w_5000').replace(/,h_\d+/, '')
  },
  {
    site: 'Archdaily 中文版',
    pattern: 'https?://images[.]adsttc[.]com[.]qtlcn[.]com/.*',
    replace: (url) =>
      url
        .replace(/thumb_jpg/, 'large_jpg')
        .replace('/medium_jpg/', '/large_jpg/')
        .replace('/newsletter/', '/large_jpg/')
  },
  {
    site: 'ArchDaily 国际版',
    pattern: 'https?://images[.]adsttc[.]com/.*',
    replace: (url) =>
      url
        .replace(/slideshow/, 'large_jpg')
        .replace(/thumb_jpg/, 'large_jpg')
        .replace('/medium_jpg/', '/large_jpg/')
        .replace('/newsletter/', '/large_jpg/')
  },
  {
    site: 'Dezeen',
    pattern: 'https://static[.]dezeen[.]com/.*',
    replace: (url) =>
      url
        .replace(/slideshow/, 'large_jpg')
        .replace(/thumb_jpg/, 'large_jpg')
        .replace(/-\d+x\d+.jpg/, '.jpg')
  },
  {
    site: 'Archiproducts',
    pattern: 'https://img[.]edilportale[.]com/.*',
    replace: (url) => url.replace(/-thumbs.*.[a-z]_/, 's/').replace(/news.*.[a-z]_/, 'news/')
  },
  {
    site: 'officesnapshots wordpress',
    pattern: 'https://officesnapshots.com/wp-content/uploads/(.*)',
    replace: (url) => url.replace(/-\d+x\d+-(.*)\./, '.').split('?w=')[0]
  },
  {
    site: 'wordpress 通用 2.0 (asnyc)',
    pattern: '/wp-content/uploads/.*',
    // Eagle 会 HEAD 探测去掉尺寸后缀的地址是否存在；纯模块直接返回改写结果。
    needsVerify: true,
    replace: (url) => url.replace(/-\d+x\d+/, '').split('?w=')[0]
  },
  {
    site: 'Squarespace 通用',
    pattern: 'https://static[0-9][.]squarespace[.]com/.*',
    replace: (url) => url.replace(/format=[0-9]{3,4}w/, 'format=3000w')
  },
  {
    site: 'bilibili专栏',
    pattern: 'https://(.*).hdslb.com/(.*)@(.*).(webp|avif)',
    replace: (url) => url.split('@')[0]
  },
  {
    site: 'AliyunOSS 通用',
    pattern: /\?x-oss-process=\S+/,
    replace: (url) => {
      try {
        const parsed = new URL(url);
        parsed.searchParams.delete('x-oss-process');
        return parsed.toString();
      } catch {
        return url;
      }
    }
  },
  {
    site: '小红书',
    pattern: 'https?://sns-webpic(?:-qc)?[.]xhscdn[.]com/(.*)',
    // sns-webpic-qc 是带鉴权的 403 域名；sns-img-hw / sns-img-bd 是公开 CDN。
    // 注意：sns-img-al 已失效（403），不要再用。
    replace: (url) =>
      url
        .replace(
          /:\/\/[^/]+(\.xhscdn\.com\/+)[0-9]+\/+[0-9a-f]{10,}\/+([^/.?#!]+)(?:[?#!].*)?/,
          '://sns-img-hw$1$2'
        )
        .split('!')[0]
  },
  {
    site: 'Medium',
    pattern: 'https://cdn-images-[0-9][.]medium[.]com/.*',
    replace: (url) => url.replace(/\/max\/\d{2,4}/, '')
  },
  {
    site: 'Medium | 新版',
    pattern: 'https://miro.medium.com/v2/(.*)',
    replace: (url) => url.replace(/\/[^/]*:[^/]*\//g, '/')
  },
  {
    site: 'Artstation',
    pattern: 'https://cdn(.*).artstation.com/(.*)',
    ignoreCheck: true,
    // Eagle 会在 large / 4k 之间探测；纯模块优先改写为 large。
    needsVerify: true,
    replace: (url) =>
      url
        .replace(/\d{14}\//, '')
        .replace(/large/, 'large')
        .replace(/micro_square/, 'large')
        .replace(/smaller_square/, 'large')
        .replace(/small_square/, 'large')
  },
  {
    site: 'GameUI',
    pattern: 'https://image.gameuiux.cn.*',
    replace: (url) => url.replace(/_list/, '_detail')
  },
  {
    site: 'GameUI2',
    pattern: 'https://img.gameui.net/*',
    replace: (url) => {
      if (url.match(/(-1@\d+x\d+)/)) return url.replace(/(-1@\d+x\d+)\.webp/g, '.webp');
      if (url.match(/(@\d+x\d+)\.webp/)) return url.replace(/(@\d+x\d+)\.webp/g, '.webp');
      return url;
    }
  },
  {
    site: 'interiordesign',
    pattern: 'https://d4qwptktddc5f[.]cloudfront[.]net/.*',
    replace: (url) =>
      url.replace(/easy_thumbnails\/thumbs_/, '').replace(/[.]jpg.*/, '.jpg')
  },
  {
    site: 'meiye',
    pattern: '(.*)image.meiye.art/(.*)',
    replace: (url) => url.split('?imageMogr2')[0].split('?vframe')[0]
  },
  {
    site: '即刻',
    pattern: 'https://cdn(.*)[.]ruguoapp[.]com/.*',
    replace: (url) => url.split('?imageMogr2')[0]
  },
  {
    site: '腾讯云 通用',
    pattern: 'https://(.*)?imageMogr2(.*)',
    replace: (url) => {
      if (url.includes('sign-algorithm=')) return url;
      return url.includes('?imageMogr2') ? url.split('?imageMogr2')[0] : url;
    }
  },
  {
    site: '腾讯云 通用 #2',
    pattern: 'https://(.*)?imageView2(.*)',
    replace: (url) => {
      if (url.includes('q-sign-algorithm=')) return url;
      return url.includes('?imageView2') ? url.split('?imageView2')[0] : url;
    }
  }
];

/** 全部放大规则（顺序即优先级） @type {UrlRule[]} */
export const URL_RULES = RULES;

/** 规则总数（Eagle 原表为 56 条） */
export const ENLARGE_RULE_COUNT = RULES.length;

/**
 * base64url（可带 padding）→ JSON 对象。仅用于 deviantArt token 解析，纯计算。
 * @param {string} segment
 */
function decodeBase64UrlJson(segment) {
  const normalized = String(segment || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  let percent = '';
  for (let i = 0; i < binary.length; i++) {
    percent += `%${binary.charCodeAt(i).toString(16).padStart(2, '0')}`;
  }
  return JSON.parse(decodeURIComponent(percent));
}

/**
 * 字符串 pattern → RegExp 的编译缓存（批量扫描时避免反复构造正则；
 * 只按 pattern 源码缓存，不改变匹配语义）。
 * @type {Map<string, RegExp | null>}
 */
const REGEXP_CACHE = new Map();

/**
 * 把规则 pattern 统一成正则；字符串按正则源码构造（与 Eagle 的 RegExp(srcPattern) 一致）。
 * @param {RegExp | string} pattern
 * @returns {RegExp | null}
 */
function toRegExp(pattern) {
  if (pattern instanceof RegExp) return pattern;
  const source = String(pattern);
  if (REGEXP_CACHE.has(source)) return REGEXP_CACHE.get(source) || null;
  let compiled;
  try {
    compiled = new RegExp(source);
  } catch {
    compiled = null;
  }
  REGEXP_CACHE.set(source, compiled);
  return compiled;
}

/**
 * 命中测试：返回 exec 结果（无 capture 的字符串规则也能拿到 match 数组）。
 * @param {UrlRule} rule
 * @param {string} url
 * @returns {RegExpExecArray | null}
 */
function matchRule(rule, url) {
  const regexp = toRegExp(rule.pattern);
  if (!regexp) return null;
  // 防御：规则表允许外部注入带 g/y 的 RegExp，重置游标避免跨调用状态污染。
  if (regexp.global || regexp.sticky) regexp.lastIndex = 0;
  try {
    return regexp.exec(url);
  } catch {
    return null;
  }
}

/**
 * 按规则表顺序放大一个 URL。纯函数、不联网、不抛异常。
 *
 * @param {string} url 原始地址（应为 http(s) 绝对地址）
 * @returns {{ url: string, hit: boolean, site: string | null }}
 *   - url：放大后的地址；无命中 / 改写异常 / 改写结果为空时与原值相同
 *   - hit：是否命中规则（命中但改写结果不变时为 true，便于统计"无效规则"）
 *   - site：命中的规则站点名，未命中为 null
 */
export function enlargeUrl(url) {
  const input = typeof url === 'string' ? url : url == null ? '' : String(url);
  if (!input) return { url: input, hit: false, site: null };
  // data:/blob:/相对地址不参与放大（与 Eagle convertURL 的前置过滤一致）
  if (!/^https?:\/\//i.test(input)) return { url: input, hit: false, site: null };

  for (const rule of URL_RULES) {
    const match = matchRule(rule, input);
    if (!match) continue;
    let next = input;
    try {
      const value = rule.replace(input, match);
      if (typeof value === 'string' && value.trim()) next = value;
    } catch {
      next = input;
    }
    return { url: next, hit: true, site: rule.site };
  }
  return { url: input, hit: false, site: null };
}

/**
 * 命中规则后的备用下载地址（例如小红书 sns-img-hw 失败时换 sns-img-bd）。
 * 纯函数、不联网；调用方按顺序重试即可。
 *
 * @param {string} url 已放大后的 URL
 * @returns {string[]} 备用 URL 列表（不含入参本身）
 */
export function fallbackUrls(url) {
  const input = typeof url === 'string' ? url : url == null ? '' : String(url);
  if (!/^https?:\/\//i.test(input)) return [];
  const list = [];
  if (/^https?:\/\/sns-img-hw\.xhscdn\.com\//i.test(input)) {
    list.push(input.replace('://sns-img-hw.xhscdn.com/', '://sns-img-bd.xhscdn.com/'));
  }
  return list;
}
