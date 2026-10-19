# Ant-col 蚁穴 · 当前实现审计基线

> 用途：为「与 Eagle 对比 / 后续优化方案」提供可落地到代码行的现状基线。
> 审计对象：`D:\DeepSeek Harness\Ant-Col`，git `a5b366a`（`chore(release): bump version to 1.2.1`），工作区干净。
> 版本：`manifest.json:5` = `1.2.1`，`package.json:1` = `1.2.1`。
> 审计方式：只读静态审计（read/grep/glob + 只读 `Measure-Object`），**未修改任何源码、未运行 `test/e2e.js`、未执行任何会写入用户目录的脚本、未使用 REA MCP**。
> 统计口径：16 个运行期文件共 **4773 行**（`background/` 10 个文件、`content/` 2 个、`popup/`、`options/`、`library/library.js`、`manifest.json`；不含 CSS/HTML/e2e）。

---

## 0. 速览

### 0.1 运行期文件

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `manifest.json` | 76 | MV3 声明、权限、快捷键、菜单入口 |
| `background/service-worker.js` | 511 | 消息总线、右键菜单、命令、Library 状态与更新、导出 |
| `background/save.js` | 379 | 保存编排：抓取→hash→去重→命名→落盘→索引→缩略图 |
| `background/naming.js` | 148 | 名称清洗、站点名、文件名模板、ID、扩展名、时间 |
| `background/config.js` | 43 | 默认设置、类型目录、超时/批量常量 |
| `background/store.js` | 182 | settings/index/stats（chrome.storage.local）+ root handle（IndexedDB） |
| `background/fs-writer.js` | 127 | File System Access 写入、`_index.json` 镜像 |
| `background/downloads-writer.js` | 103 | 下载目录模式（data/blob URL → chrome.downloads） |
| `background/media.js` | 180 | fetch（Referer/凭证）、data URL、SHA-256、尺寸、缩放、裁剪 |
| `background/screenshot.js` | 127 | 可见/整页滚动拼接截图、活动标签页 |
| `background/thumb-store.js` | 72 | 缩略图 IndexedDB（`ant-col-thumbs`） |
| `content/hover.js` | 299 | 悬停识别、toast、元素框选 |
| `content/drag-save.js` | 957 | 拖拽收藏页 + 收藏夹选择 + 保存面板 |
| `popup/popup.js` | 523 | 本页批量扫描与保存、最近记录 |
| `options/options.js` | 243 | 设置、选文件夹/重新授权/移除、导出/清空索引 |
| `library/library.js` | 803 | 独立素材库（索引视图、搜索、triage、批量、详情、导出） |

### 0.2 数据流

```
采集（content/drag-save, content/hover, commands, contextMenus, popup scan）
  → chrome.runtime.sendMessage({type:'save', items, meta})
  → save.js: saveItems() → resolveTarget()（folder / downloads）
      → fetchMedia()（media.js） / decodeDataUrl（截图）/ linkCardHtml（链接）
      → sha256Hex(bytes) → 去重键（sha256 + collectionPath / linkUrl + collectionPath）
      → makeBaseName()（naming.js） → relPath = [项目/]类型/YYYY-MM/文件名.ext
      → writeRecord()：fs-writer（文件夹模式）或 downloads-writer（下载模式）
      → appendIndexMirror()（仅文件夹模式） → appendIndex()（chrome.storage）
      → putThumb()（IndexedDB，仅 image/*）
      → refreshBadge() / toast
整理（library.html）
  → sendMessage({type:'library-state'}) → buildLibraryState() → getIndex()
  → 搜索/筛选/排序（全内存）→ 网格/详情/批量/triage
  → sendMessage({type:'update-items'}) → updateIndexEntries()
      → 文件夹模式：rewrite sidecar + rewrite _index.json（其余模式跳过）
```

### 0.3 存储介质一览

| 数据 | 位置 | 键/Store | 定义处 |
| --- | --- | --- | --- |
| 设置 | `chrome.storage.local` | `settings` | `store.js:7,60-70` |
| 索引（最多 8000 条） | `chrome.storage.local` | `index` | `store.js:8,10,76-99` |
| 统计 | `chrome.storage.local` | `stats` | `store.js:9,134-155` |
| 素材库目录句柄 | IndexedDB `ant-col-db` / `kv` | `rootHandle` | `store.js:3-9,159-171` |
| 缩略图 Blob | IndexedDB `ant-col-thumbs` / `thumbs` | `id` | `thumb-store.js:1-3,21-42` |
| 素材文件 + 同名 sidecar + `_index.json` | 用户文件夹（FSA）或 `下载/<subfolder>` | 文件 | `fs-writer.js:3,44-115`；`save.js:149-184` |

---

## 1. 采集链路与 payload 字段

### 1.1 入口总表

| # | 入口 | 触发 | 处理器 | 说明 |
| --- | --- | --- | --- | --- |
| 1 | 页面内拖拽 | `document` 捕获阶段 `dragstart` | `content/drag-save.js:195-208,217-218` | 弹出居中「收藏页」；拖到左侧/项目行 → 保存面板；点「建立或选择文件夹」→ 收藏夹选择器 |
| 2 | 悬停保存 | `Alt+S`（`commands.save-hovered`） | `service-worker.js:107-125` → `tabs.sendMessage('vv-get-hovered')` → `hover.js:127-139` | 取鼠标位置 `elementFromPoint`；6 秒内缓存兜底 |
| 3 | 右键图片 | 上下文菜单 `save-image` | `service-worker.js:45-46,62-72` | `info.srcUrl` |
| 4 | 右键视频 | `save-video` | `service-worker.js:47,62-72` | 同上传 `kind:'video'` |
| 5 | 右键链接 | `save-link` | `service-worker.js:48,73-82` | 保存为 `.html` 链接卡片；标题取选区文字 |
| 6 | 右键本页存为链接卡片 | `save-page-link` | `service-worker.js:51,83-92` | 标题 = 页面标题 |
| 7 | 批量保存本页图片 | 菜单 `batch-save` / 快捷键 `save-page-images` / 工具栏图标 | `service-worker.js:50,93-94,132-134,140-146` → popup | 打不开 popup 时退化为 toast 提示 |
| 8 | 可见区域截图 | `Alt+Shift+S` / 菜单 | `service-worker.js:52,95-96,126-127` → `captureAndSave` | `chrome.tabs.captureVisibleTab` |
| 9 | 元素截图 | `Alt+Shift+E` / 菜单 | `service-worker.js:53,99-100,128-129` → `hover.js:206-298` 框选 | 点击元素后回传 rect，后台裁剪 |
| 10 | 整页截图 | `Alt+Shift+F` / 菜单 | `service-worker.js:54,97-98,130-131` → `screenshot.js:70-122` | 滚动拼接；失败回退可见区域 |
| 11 | popup 批量扫描 | popup 打开自动扫描 | `popup.js:170-312` | `chrome.scripting.executeScript` 注入 `collectImages` |

快捷键声明：`manifest.json:55-75`（`save-hovered` Alt+S、三档截图、`save-page-images`）；菜单重建于 `service-worker.js:43-55`（`onInstalled`/`onStartup` 都会 `removeAll` 再建）。

### 1.2 payload 字段（逐个入口）

统一由 `saveItems(rawItems, meta)` 接收（`save.js:339`），`meta = { tags, note, collection, status? }`（`save.js:83-84,106`；`status` 无调用方传入）。

**拖拽面板**（`drag-save.js:886-902`）：

```js
items: [{ kind, url, linkUrl, title, alt, width, height, pageUrl, pageTitle }]
meta:  { tags: string[], note: string, collection: string }
```

- `kind` 由识别结果决定：`image` / `video` / `link`（`drag-save.js:133-137,156-167`）；面板可把「图片+linkUrl」改成 `link`（`drag-save.js:786-799,933`）。
- `blob:` 图片会先在页面内转成 data URL 再上送（`drag-save.js:43-55,881-885`）。
- 不发送 `mime`/`ext`/`previewUrl`（`previewUrl` 只用于面板预览，`drag-save.js:760-780`）。

**Alt+S 悬停**（`hover.js:28-68,99-108`）：

```js
{ url, kind:'image'|'video', title, alt, width, height, pageUrl, pageTitle }
```

- `blob:` 被跳过（`hover.js:26,43`）；`<video>` 无可用 src 时改存 poster（`hover.js:55-66`）；`<canvas>` 走 `toDataURL`（`hover.js:70-85`）；CSS 背景图向上最多 5 层（`hover.js:96-110`）。
- 后台补齐 `pageUrl/pageTitle` 并 `meta:{tags:[],note:''}`（`service-worker.js:120-124`）→ 落到默认项目。

**右键**（`service-worker.js:64-91`）：

```js
{ url: info.srcUrl, kind, pageUrl, pageTitle, title:'', alt:'' }                       // 图/视频
{ kind:'link', url: info.linkUrl, linkUrl: info.linkUrl, pageUrl, pageTitle, title }   // 链接
{ kind:'link', url: pageUrl, linkUrl: pageUrl, pageUrl, pageTitle, title: pageTitle }  // 本页卡片
```

**截图**（`service-worker.js:179-189`）：

```js
{ kind:'screenshot', dataUrl, url:'', pageUrl, pageTitle, title: pageTitle||'截图',
  width, height, captureMode }   // captureMode: visible | full | element | visible-fallback
```

**popup 批量**（`popup.js:380-392`）：

```js
items: [{ url, kind, title, alt, width, height, pageUrl, pageTitle }]
meta:  { tags: string[], note: string }     // 无 collection → 默认项目
```

### 1.3 内容脚本识别规则

- 拖拽识别 `describe()`（`drag-save.js:120-179`）：`<img>` → 图片；`<video>` → 可播放则视频、否则封面；`<a>` 内单图/CSS 背景图 → 图片并保留 `linkUrl`；`<a>` 无图 → 链接；容器内恰好 1 张图 → 图片；祖先 3 层内 CSS 背景图 → 图片；`contenteditable` 内忽略（`:40,122`）。
- 悬停识别 `pick()`（`hover.js:87-112`）：`img` → `video` → `canvas` → 向上 5 层 `backgroundImage`。
- 拖拽只监听**页面内** `dragstart`，没有 `document` 级 `dragover/drop` 处理外部来源；从桌面/其他窗口拖入未接入（`drag-save.js:217-219` 是唯一注册点；搜索 `drop` 仅出现在收藏页 shadow root 内部 `:348-378`）。
- `hover.js` 注入 `all_frames:true`（`manifest.json:47`），`drag-save.js` 只注入主框架（`manifest.json:49-53`）。

### 1.4 截图链路细节

- 可见/元素：`captureVisible(windowId, 'png')`（`screenshot.js:5-11`），元素用 `cropImage(dataUrl, rect, dpr)` 裁剪（`media.js:151-167`，越界会被 clamp 到截图范围内 `:157-158`）。
- 整页：注入 `prepareFullPage` 隐藏 `fixed/sticky`、滚动到顶（`screenshot.js:13-38`）；以 `viewport-2` 为步长循环、每个 tile 至少等 220ms，随后 360ms（`:90-108`）；`MAX_HEIGHT=16000`（`:81`）、`guard<80` 个 tile（`:93`）；`OffscreenCanvas` 白底合成（`:85-88`）。失败回退可见区域并标记 `visible-fallback`（`service-worker.js:162-168`）。
- 截图格式设置 `screenshotFormat: 'png'|'jpg'`（`config.js:13`），`jpg` 时在保存阶段用 `resizeImage(bytes, mime, 100000, quality/100)` 重编码（`save.js:255-262`）；`OffscreenCanvas` 不可用时静默保持 PNG（`media.js:134-142`）。
- 截图保存时 `ext` 先写死 `png`（`save.js:254`），MIME 取 data URL 头（`save.js:251-253`）。

### 1.5 批量扫描（popup）

- 注入函数 `collectImages(minSize, includeBackground)`（`popup.js:170-246`）：扫 `img`（含可见性/面积）、`video`（src 或 poster）、CSS 背景图（最多前 4000 个元素，尺寸 ≥40×40，排除 `img/video/canvas/svg` 子节点），按 `visible` + `area` 排序，**上限 300**（`:245`）。
- 页面限制：仅 `http(s)/file`（`popup.js:264-272`）；`file://` 需用户开启「允许访问文件网址」。
- 尺寸过滤：注入时用 `width<min && height<min` 才丢弃（`popup.js:181`），保存前又用 `width>=min || height>=min` 过滤（`popup.js:297-300`）——两处逻辑不一致（AND vs OR）。
- 显示 ≤12 项时自动全选（`popup.js:308-310`）。
- 批量保存固定落默认项目（无 collection 选择），meta 只带 tags/note（`popup.js:392`）。

### 1.6 与 Eagle 扩展 payload 的异同

Eagle 侧字段见 `docs/archive/eagle-research.md:129-157`（`version/type/src/title/url/tags/folderID(s)/annotation/star/behavior/base64/images`）。

| Eagle 字段 | Ant-col 对应 | 差异 |
| --- | --- | --- |
| `type` | `kind` | Eagle 用 `image/screen capture/save-url/import-images`；Ant-col 用 `image/video/screenshot/link` |
| `src` | `url` | 一致（素材地址） |
| `url`（来源页） | `pageUrl` | 一致 |
| `folderID/folderIDs` | `collection`（单值，名称而非 ID） | **无文件夹树/ID**，只有扁平项目名；`collectionPath` 是落盘子目录 |
| `tags` | `tags` | 一致（扁平） |
| `annotation` | `annotation`（面板 `note`） | 一致 |
| `star` | 无 | 缺评分 |
| `behavior` | 无 | 无来源行为标记 |
| `version` | 无（`ping` 消息可返回版本，`service-worker.js:479-480`，但无调用方） | 无兼容版本协商 |
| `base64` | `dataUrl`（仅截图） | 截图走同一 payload |
| `images`（批量 JSON 串） | `items[]` 直接传数组（结构化消息） | 无需 JSON 编码 |
| `forceOpenCollectModal` | 无（Ant-col 拖拽固定先出收藏页） | — |

---

## 2. 落盘策略

### 2.1 目标解析（三种模式）

`resolveTarget()`（`save.js:24-36`）：

| 设置 `targetMode` | 条件 | 结果 |
| --- | --- | --- |
| `folder` | 无句柄 | 抛 `TargetError('还没有选择素材库文件夹，请到设置里选择')`（`:28`） |
| `folder` | 权限非 granted | 抛 `TargetError('素材库文件夹授权已失效，请到设置里重新授权')`（`:29`） |
| `auto`（默认） | 句柄存在且 granted | folder 模式（`:32-34`） |
| `auto` | 否则 | **静默回退** downloads（`:35`） |
| `downloads` | — | downloads（`:35`） |

默认设置见 `config.js:4-23`（`targetMode:'auto'`、`downloadsSubfolder:'Ant-col素材'`、`filenameTemplate:'{date}_{time}_{site}_{name}'`、`collections:['灵感收集','日常审美','帮催作品']`、`defaultCollection:'灵感收集'`）。

### 2.2 路径组装

`saveOne()`（`save.js:307-311`）：

```js
base    = makeBaseName({ date, site, name, template: settings.filenameTemplate })  // :307
folder  = KIND_FOLDER[item.kind] || KIND_FOLDER.file                              // :308  (config.js:25-31)
month   = timestampParts(new Date()).month                                       // :309  → "YYYY-MM" (naming.js:73)
prefix  = collection?.path ? `${collection.path}/` : ''                          // :310
relPath = `${prefix}${folder}/${month}/${base}.${ext}`                           // :311
```

| 维度 | 取值 | 依据 |
| --- | --- | --- |
| 根目录 | 用户选的素材库文件夹；否则 `下载/<downloadsSubfolder>` | `fs-writer.js:5-10`；`downloads-writer.js:50-51` |
| 项目子目录 | **默认项目**（`defaultCollection` 或 `collections[0]`）**不建目录**；其他项目建 `sanitizeSegment(name,40).replace(/[\\/]+/g,'-')` 同名目录 | `save.js:38-48` |
| 类型目录 | `图片/视频/截图/链接/文件` | `config.js:25-31`；`save.js:308` |
| 年月分桶 | `YYYY-MM`（本地时区） | `naming.js:65-76`；`save.js:309-311` |
| 文件名 | 模板替换 + 清洗；≤110 字符 | `naming.js:78-92` |
| 扩展名 | 见 2.4 | `save.js:246,254,261,272,281` |

实际产物示例（`test/out/downloads/Ant-col素材/`）：
`图片/2026-10/20261019_173604_local_art-1.jpg` + 同名 `.json`；非默认项目 `日常审美/图片/2026-10/...`；链接 `链接/2026-10/....html`；截图 `截图/2026-10/....png`。

### 2.3 `naming.js` 变量与拼接实现

`makeBaseName()`（`naming.js:78-92`）：

```js
t = timestampParts(date)              // date=YYYYMMDD, time=HHMMSS, month=YYYY-MM, display=YYYY-MM-DD HH:MM
values = {
  date: t.date,
  time: t.time,
  site: sanitizeSegment(site, 24).replace(/\s+/g,'-'),
  name: sanitizeSegment(name, 56).replace(/\s+/g,'-'),
  month: t.month
}
base = template.replace(/\{(date|time|site|name|month)\}/g, (_,k) => values[k] || '')
base = base.replace(RESERVED,' ').replace(/\s+/g,'-').replace(/-{2,}/g,'-').replace(/^[-_]+|[-_]+$/g,'')
if (!base) base = `${t.date}_${t.time}`
if (base.length > 110) base = base.slice(0,110).replace(/[-_]+$/g,'')
```

- 支持的变量固定 5 个：`{date}` `{time}` `{site}` `{name}` `{month}`；未知占位符原样保留（正则不匹配）。
- 未在模板中使用的变量不参与；模板为空回退默认（`naming.js:87`）。
- 清洗链：`sanitizeSegment()` 先去零宽字符/emoji → 非法字符 `<>:"/\|?*` 与控制字符换空格 → 压缩空格 → 去首尾 `.`/空白；空则 `untitled`；超长截断（`naming.js:5-15`）；`RESERVED`/`ZERO_WIDTH`/`EMOJI` 定义在 `:1-3`。
- 站点名 `siteFromUrl()`：`file:` → `本地文件`；`localhost`/IP → `local`；处理 `co.uk/com.cn` 一类二级后缀，取主域（`naming.js:17-37`）。
- 显示名 `displayName()`：`title → alt → slugFromUrl(url) → pageTitle`，逐个 `stripExt`+`sanitizeSegment(...,56)`；全空时按类型给 `截图/链接/素材`（`naming.js:56-63`）。
- `slugFromUrl()`：取 path 末段去扩展名；纯 16 位以上十六进制或纯 10 位以上数字视为无信息返回空（`naming.js:43-54`）。
- ID：`(Date.now().toString(36) + Math.random().toString(36).slice(2,7)).toUpperCase()`（`naming.js:94-96`）。

### 2.4 扩展名与 MIME

- 图片/视频：优先用调用方 `ext`（当前无调用方传）；否则 `extFromMime(mime, url)`（`save.js:281`）——先查 MIME 映射表（`naming.js:100-117`），再回退 URL 后缀（`:119-120`），再按 `image/*`、`video/*` 派生，兜底 `bin`（`:121-123`）。
- `mime` 来自 `fetchMedia` 的 `content-type`（`media.js:83,90`）；payload 传入的 `item.mime` 优先（`save.js:243,280`）。
- 截图：`image/png`（data URL 头），`jpg` 设置下转 `image/jpeg`，扩展名 `png`/`jpg`（`save.js:251-262`）。
- 链接：`text/html` → `.html`（`save.js:271-272`）。
- 写入时 `new Blob([bytes], {type: mime || 'application/octet-stream'})`（`fs-writer.js:50`）；下载模式 data URL 的 MIME 同源（`downloads-writer.js:60`）。

### 2.5 Referer / 防盗链

`fetchMedia()`（`media.js:40-94`）：

```js
credentials: 'include', cache: 'force-cache', redirect: 'follow',
headers: { Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,audio/*,*/*;q=0.8' }
```

- `useReferrer && /^https?:/i.test(pageUrl)` 时 `fetch(url, {referrer: pageUrl, referrerPolicy:'no-referrer-when-downgrade'})`；该次 fetch 抛错则**去掉 referrer 重试一次**（`media.js:64-69`）。
- 返回 `text/html` 或 `application/json` 时判定为「拿到网页而非素材（可能有防盗链）」并抛 `NOT_MEDIA`（`media.js:84-86`）。
- 只做这一层识别，**没有**换 referer/origin/UA、没有页面内二次抓取（`blob:` 明确报错引导改用右键或截图，`media.js:46-48`）。
- 225MB 上限（`MAX_BYTES = 220*1024*1024`，`media.js:3,88`）；45s 超时（`config.js:42`）。
- `useReferrer` 默认 `true`（`config.js:15`），设置页可关（`options.html:124`）。

### 2.6 写入、重名与失败回退

**文件夹模式**（`save.js:152-165` + `fs-writer.js`）：

- `getDirectoryHandle(part,{create:true})` 逐级建目录（`fs-writer.js:16-22`）。
- `ensureUniqueName(dir, base, ext)`：存在同名则 `base-2.ext`、`base-3.ext`… 最多到 `-999`（`fs-writer.js:33-42,111`）。
- `writeItemFiles()` 用唯一名重新拼 `finalRel` 写回 `record.relativePath`（`save.js:153-159`）。
- sidecar：`finalRel.replace(/\.[^.]+$/,'.json')`，内容 `sidecarFor(record)` 缩进 2（`save.js:162-164`）。
- `record.mode='folder'`、`absolutePath = ${root.name}/${finalRel}`（`save.js:160-161`）。

**下载模式**（`save.js:168-183` + `downloads-writer.js`）：

- 路径 `subfolder/relPath`，`conflictAction:'uniquify'`、`saveAs:false`（`downloads-writer.js:68-73`）。
- <2MB 用 `data:` URL，≥2MB 用 `URL.createObjectURL`（3s 后 revoke）（`downloads-writer.js:54-65,78`）。
- 下载完成等待：监听 `downloads.onChanged` + 轮询兜底，120s 超时（`downloads-writer.js:12-48`；`config.js:43`）。
- `record.absolutePath = item.filename`（浏览器给的绝对路径）；`record.relativePath` **保留期望路径**（`save.js:172-174`）。
- sidecar 走第二次 `downloadText`，失败被吞掉（`save.js:175-182`）。

**失败表现**：

- 单个 item 抛错 → `results.push({status:'error', item, error, code})`，整批继续（`save.js:354-360`）。
- `fetchMedia` 错误码：`NO_URL/BLOB_URL/TIMEOUT/FETCH_FAILED/HTTP_ERROR/NOT_MEDIA/TOO_LARGE/INVALID_DATA_URL`（`media.js:24-27,41-48,74-88`）。
- popup 展示 `已保存 N 项 / 跳过重复 / 失败`（`popup.js:404-408`）；拖拽面板展示错误文案（`drag-save.js:913-917`）；`afterSave` 走 toast/通知（`service-worker.js:194-210,212-227`）。
- **没有重试按钮**、没有失败队列、没有断点续传。

### 2.7 下载模式 vs 文件夹模式差异

| 维度 | 文件夹模式（FSA） | 下载模式（chrome.downloads） |
| --- | --- | --- |
| 写入 API | `createWritable()`（`fs-writer.js:44-54`） | data/blob URL + `downloads.download`（`downloads-writer.js:50-80`） |
| 重名处理 | 预检查 + `-2/-3`（`fs-writer.js:33-42`） | 浏览器 `uniquify`（`downloads-writer.js:71`） |
| `relativePath` 准确性 | 回写真实唯一名（`save.js:159`） | **保留期望名**，可能与实际文件名不一致（`save.js:174`） |
| `absolutePath` 语义 | `root.name/rel` 字符串（`save.js:161`） | 浏览器绝对路径（`save.js:173`） |
| `_index.json` 镜像 | 写（`save.js:315-317`） | **不写** |
| sidecar 位置 | 与原文件同目录，整体原子性较好 | 第二次下载，可能重名/失败被吞 |
| 元数据回写（改状态/项目） | 重写 sidecar + 整个镜像（`service-worker.js:357-369`） | **完全跳过**（`:360`） |
| 定位文件 | 不支持（仅返回路径串；`reveal` 对非 downloads 无效，`service-worker.js:468-474`） | `downloads.show(id)` 或打开下载文件夹 |

---

## 3. 去重与索引

### 3.1 SHA-256 计算范围

- 计算对象：**最终写入的字节** `bytes`（`save.js:288` → `media.js:96-99`）。
  - 图片/视频：`fetchMedia` 返回的响应体（`save.js:275-279`）。
  - 截图：data URL 解码后的字节；若 `jpg` 设置则先重编码再 hash（`save.js:251-262`）。
  - 链接：生成的 HTML 卡片字节（`save.js:270`）。
- **不含项目/标签/来源**；项目通过去重键后缀参与（见 3.2）。
- `sha256` 是保存时一次计算，之后不再校验；文件被外部修改不会发现。

### 3.2 去重键

```js
const dedupeKey = `${sha}::${collection?.path || ''}`;          // save.js:289
// 链接：const key = `${(item.linkUrl||item.url||'').trim()}::${collection?.path||''}`  // save.js:292
```

- 已存在集合来自索引：`knownHashes = index.filter(e=>e.sha256).map(e => [sha::collectionPath, e])`；`knownLinks` 类似（`save.js:344-345`）。
- 命中返回 `{status:'duplicate', existing}`，不写文件（`save.js:293-296`）。
- 命中后把新记录写回本地 Map（`save.js:328-334`），供同批后续 item 去重。
- 设计意图（README:35）：同一张图可进不同项目 → 键里带 `collectionPath`。
- **注意**：索引里 `collectionPath` 只在保存时写入；库内换项目不更新它（见 6.2 债#14），因此「移动后再存同一张图」不会去重、而「存回旧项目」会误判重复。

### 3.3 写入顺序与时机

每个 item 的落盘顺序（`save.js:314-326`）：

1. `writeRecord()` 写主文件（+ sidecar）。
2. 文件夹模式：`appendIndexMirror(root, written)`（`save.js:315-317`）。
3. `appendIndex([written])`（`save.js:318`）→ 内部串行链 + 排序 + 8000 上限 + stats 累加（`store.js:81-99,146-155`）。
4. `mime` 以 `image/` 开头 → 360px、q0.74 缩略图写 IndexedDB；缩放失败且原图 <1.5MB 则直接存原图（`save.js:320-326`）。
5. 更新内存去重 Map（`:328-334`）。

并发：`concurrency = min(3, total)`（`save.js:349`），逐条 `save-progress` 广播（`:362-364`，popup 关闭时被忽略，`popup.js:496-502`）。

失败/顺序风险：第 1 步成功、第 2/3 步失败时，文件已在盘上但索引/镜像没有记录（错误被 `saveItems` 捕获为整条 item error，`save.js:354-360`），且 `appendIndexMirror` 的失败会直接中断该 item 的后续步骤。

### 3.4 `_index.json`

- 文件名常量 `INDEX_FILE='_index.json'`（`fs-writer.js:3`），位于素材库根目录。
- 结构：**完整索引记录数组**（不是 sidecar），按 `savedAtMs` 升序、缩进 2 写盘（`fs-writer.js:86-96,98-105`）。记录字段与 chrome.storage 索引一致（含 `savedAtMs/savedDisplay/mode/absolutePath/downloadId` 等 sidecar 没有的字段）。
- 写入时机：
  - 保存（仅文件夹模式）：`appendIndexMirror()` **每条都整体读→parse→合并→整体重写**（`fs-writer.js:86-96`，内部 `mirrorChain` 串行，`:84-85`）。
  - 库内更新（仅文件夹模式）：`writeIndexMirror(root, updated.filter(mode==='folder'))` 整体覆盖（`service-worker.js:365-368`）。
- 读取时机：仅 `root-changed` 消息（选文件夹/重新授权）→ `importFolderIndex()` 读取并 `appendIndex(valid)`（`service-worker.js:401-412,463-467`）。校验条件只有 `e && e.id && e.schema`（`:406`）。
- 下载模式**没有镜像**；sidecar 也没有任何读取方（`readText` 唯一调用点是 `readIndexMirror`，`fs-writer.js:60-82`）。

### 3.5 chrome.storage 索引与 stats

- `getIndex()` 读 `chrome.storage.local['index']`，非数组返回 `[]`（`store.js:76-79`）。
- `appendIndex(entries)`：按 `id` 合并（同 id 覆盖、新 id push）→ 按 `savedAtMs` 升序 → **超过 8000 条裁掉最旧**（`store.js:10,81-99`）→ 写回 → 对新 id `bumpStats`（`:94,146-155`）。
- `updateIndexEntries(ids, updater)`：整表读→map→整表写，串行链（`store.js:105-119`）。
- `clearIndex()`：`index=[]` 且 `stats=emptyStats()`（`store.js:121-123`）。
- stats：`{count,totalBytes,todayCount,todayDate,lastSavedAt}`（`store.js:125-127`）；`todayCount` 在跨天读取时归零（`:137-143`）；**只在保存时累加，从不按索引重算**（`:146-155`）。
- 无 `chrome.storage.onChanged` 监听；库页面只能手动刷新（`library.js:741`）。

### 3.6 句柄持久化与权限

- 句柄：`setRootHandle(handle, name)` → IndexedDB `ant-col-db/kv/rootHandle = {handle,name,selectedAt}`（`store.js:159-171`）。
- 权限：`canWriteRoot()` 只 `queryPermission({mode:'readwrite'})`（`store.js:173-181`）；`requestPermission()` 只在 options 页（用户手势）调用（`options.js:137,155`）。
- 状态展示：
  - popup 黄点/首屏提示（`popup.js:70-101`）。
  - 设置页 `已授权写入` / `需要重新授权` + 「重新授权」按钮（`options.js:64-103,152-166`）。
  - service-worker 的 `buildState/buildLibraryState` 各有一份同样的 query 逻辑（`service-worker.js:245-252,284-291`）。
- 授权失效时的保存行为：`folder` 模式抛错；`auto` 模式**静默切到下载目录**（`save.js:27-35`）——用户可能不知不觉写到了另一个根。
- 浏览重启后：句柄仍在 IDB，但权限常退回 `prompt`；`root-changed` 前不会自动重新请求。

---

## 4. sidecar schema 与状态机

### 4.1 `ant-col/v2` sidecar 全字段

`sidecarFor(record)`（`save.js:121-147`），`SCHEMA='ant-col/v2'`（`config.js:2`）：

| 字段 | 类型 | 来源/含义 | 备注 |
| --- | --- | --- | --- |
| `schema` | string | 固定 `ant-col/v2` | — |
| `id` | string | `makeId()`（base36 大写） | 与索引/缩略图 key 一致 |
| `kind` | string | `image/video/screenshot/link/file` | `file` 无生产者 |
| `name` | string | `displayName()` | 保存后**不可改**（无改名入口） |
| `ext` | string | 实际扩展名 | — |
| `mime` | string | 响应头/派生 | — |
| `size` | number | 字节数 | — |
| `width` / `height` | number | 内容脚本或 `getImageSize` | 拿不到为 0 |
| `sha256` | string | 文件内容 hash | 去重依据 |
| `sourceUrl` | string | 素材地址；链接卡片=linkUrl | 截图为空串 |
| `pageUrl` | string | 来源页 | — |
| `pageTitle` | string | 页面标题 | — |
| `site` | string | `siteFromUrl()` | 也作为自动标签 |
| `collection` | string | 项目名 | 默认项目名而非空 |
| `collectionPath` | string | 落盘子目录前缀（默认项目 `''`） | 移动项目后**不更新** |
| `tags` | string[] | 显式标签 + 自动标签 | — |
| `annotation` | string | 面板备注 `meta.note` | — |
| `status` | string | `inbox/kept/archived` | 保存时固定 `inbox`（`save.js:106`） |
| `reviewedAt` | number\|null | 整理时间戳（ms） | 保存时 `null`；库内改状态写 `Date.now()`（`service-worker.js:337`） |
| `savedAt` | string | ISO 时间 | — |
| `relativePath` | string | 相对素材库根 | 下载模式下可能不等于实际文件名 |
| `captureMode` | string? | 仅截图：`visible/full/element/visible-fallback` | `undefined` 会被 `JSON.stringify` 省略 |
| `linkUrl` | **缺失** | 链接卡片目标 | 只在索引/`_index.json` 里有（`save.js:117`） |

索引/镜像记录额外字段（`buildRecord`，`save.js:87-118`）：`savedAtMs`、`savedDisplay`、`mode`（`''|folder|downloads`）、`absolutePath`、`downloadId`。
索引记录额外有 `linkUrl`；sidecar 没有。

### 4.2 状态机

```
save（save.js:106 status:'inbox'）
   │
   ├─ 库内详情/批量/Triage：update-items
   │     ├ inbox → kept      （library.js:650-651、761；service-worker.js:335-338）
   │     ├ inbox → archived  （library.js:651-652、762）
   │     └ 任意 → 任意       （详情状态按钮，library.js:429-435）
   │
   └─ 无自动流转；"跳过"（→）不写状态（library.js:652）
```

- `statusOf()`：非法/缺失状态一律视为 `kept`（`service-worker.js:273-275`）——兼容 v1 老记录，但与「新采集默认 inbox」不一致，迁移期老素材不会出现在 Inbox。
- 徽标计数 `status==='inbox'`（`service-worker.js:229-236`）；Inbox 计数同样来源（`:269,307-324`）。
- `reviewedAt` 只在带 `status` 的更新里写（`service-worker.js:335-338,353`）。
- 无「已读/未读」「星标」「删除/回收站」状态。

### 4.3 collection 与 collectionPath

`resolveCollection(settings, raw)`（`save.js:38-48`）：

```js
list = settings.collections?.length ? settings.collections : ['灵感收集']
defaultName = settings.defaultCollection || list[0] || '灵感收集'
name = raw || defaultName；若 name 不在 list → defaultName
isDefault = name === defaultName
path = isDefault ? '' : sanitizeSegment(name, 40).replace(/[\\/]+/g,'-')
```

- 项目集合来源：设置项（`config.js:19-20`）、拖拽页临时新增（`service-worker.js:430-437`，上限 24）、库页面「＋」（`library.js:664-675`）。
- 库页面项目列表额外并入索引中出现过的 `collection`（`service-worker.js:292-297`）→ 从设置里删掉的项目仍会显示。
- `collectionPath` 只影响落盘子目录与去重键；**改项目不改文件位置**（README:211；`service-worker.js:339-341` 只写 `collection`）。
- 自动标签会把非默认项目名也加进 tags（`save.js:67`）——改项目后旧标签残留。

---

## 5. 素材库页面（`library/library.html` + `library.js`）

### 5.1 数据来源与渲染管线

- 唯一数据源：`send({type:'library-state'})`（`library.js:64`）→ `buildLibraryState()`（`service-worker.js:277-328`）→ `getIndex()`。
- 下发的 `items` 是**全部索引条目**（映射补 `status`/`collection` 默认值，`service-worker.js:299-303`），同时下发 `projects`（含计数）、`tags`（全量计数）、`statusCounts`、`inboxCount`、`settings`、`root`、`stats`。
- **不读盘、不扫 sidecar、不扫目录**；索引是唯一真相。
- 渲染：`load()` → `renderSidebar()` + `renderHead()` + `renderGrid()`（`library.js:80-82`）。每次改状态/项目后 `updateItems()` 会 `await load()` 全量重取（`library.js:354-367`）。
- 分页：只有前端「加载更多」，`state.limit` 初始 120、每次 +120（`library.js:25,317,329-330,742`）；`selectAll` 作用于整个 filtered 列表（`:743-748`），不只已渲染的 120。

### 5.2 排序 / 筛选

排序（`library.js:128-131`，UI `library.html:60-65`）：

| 值 | 实现 |
| --- | --- |
| `newest`（默认） | `(b.savedAtMs||0)-(a.savedAtMs||0)` |
| `oldest` | 反向 |
| `name` | `String(name).localeCompare(...,'zh')` |
| `size` | `(b.size||0)-(a.size||0)` |

没有：尺寸/宽高比/类型/站点/项目/修改时间排序，也没有分组（日期分组、项目分组）。

筛选（`library.js:103-126`）：

- 视图：`inbox/kept/archived/project/tag/all`（`:108-112`）。
- 类型下拉：`all/image/screenshot/video/link`（`library.html:53-59`；`library.js:117-118`），不含 `file`。
- 搜索前缀；`site:` 用 `includes` 子串匹配（`:119`）。
- 纯文本：`name/site/collection/pageTitle/annotation/sourceUrl/tags` 拼串后小写，按空格分词 `every(includes)`（`:121-125`）；**不含** `relativePath/pageUrl/ext/mime/linkUrl`。

### 5.3 搜索语法实现（逐条）

`parseQuery(raw)`（`library.js:90-101`）：

```js
for token of raw.trim().split(/\s+/):
  token.startsWith('tag:') || token.startsWith('#') → out.tag   = token.replace(/^tag:|^#/,'')
  token.startsWith('project:')                      → out.project = token.slice(8)
  token.startsWith('site:')                         → out.site    = token.slice(5).toLowerCase()
  token.startsWith('kind:')                         → out.kind    = token.slice(5)
  token.startsWith('is:')                           → out.status  = token.slice(3)
  else                                              → out.text.push(token)
```

| 语法 | 是否实现 | 位置 | 备注 |
| --- | --- | --- | --- |
| `tag:x` | ✅ | `:93,114` | 精确相等；同名仅一个值，**多个 `tag:` 只有最后一个生效**（重复赋值） |
| `#x` | ✅ | `:93` | `tag:` 别名 |
| `project:x` | ✅ | `:94,115` | 精确匹配 `collection`；多个只取最后一个 |
| `site:x` | ✅ | `:95,119` | 子串、大小写不敏感；多个只取最后一个 |
| `kind:x` | ✅ | `:96,117-118` | 覆盖顶部类型下拉；不校验取值（`kind:foo` → 0 结果） |
| `is:x` | ✅ | `:97,116` | 不校验取值；`is:待整理` 无效（必须英文枚举） |
| `after:日期` | ❌ **未实现** | — | 不匹配任何前缀 → 落入 `out.text`（`:98`），只有在字段里**恰好出现该字符串**时才会命中；README:61/276 亦自认是文本 |
| `before:` / `date:` | ❌ | — | 同上，落入文本 |
| `color:` / 尺寸 / 星级 | ❌ | — | 无字段可查 |
| 引号短语 / `-排除` / OR | ❌ | — | 空格即分词，`-` 无特殊语义 |
| 多值 `tag:a tag:b` | ❌ 只取最后一个 | `:93` | 需拆成数组才对 |

「未实现」的搜索范围说明：全仓库 `*.js`（`background/ content/ popup/ options/ library/`，不含 `test/out`）grep `after:|before:|date:|color:|star|palette`，除 README 文案外无命中；`library.js` 中唯一的查询解析函数是 `parseQuery`（`:90-101`），`filtered()` 只用 `q.tag/q.project/q.status/q.kind/q.site/q.text`（`:103-126`）。

### 5.4 缩略图

- 生成时机：保存时同步生成（`save.js:320-326`），仅当 `mime` 以 `image/` 开头；`resizeImage(bytes, mime, 360, 0.74)` → `image/jpeg`（`media.js:126-149`）；失败且原图 <1.5MB 时直接存原图。
- 存储：IndexedDB `ant-col-thumbs/thumbs`，值 `{id, blob, mime, bytes, updatedAt}`（`thumb-store.js:21-31`）。
- 读取：库页面 `getThumb(item.id)`（`library.js:227-258`），内存 `state.thumbUrls` 缓存 object URL（`:28,241-243`），`beforeunload` 统一 revoke（`:792-794`）。
- 占位策略：
  - 有 IDB blob → `<img src=blob:>`。
  - 无 blob → 若 `sourceUrl` 是 `http(s)/data:` 且 kind 为 `image/screenshot` → 直接用**远端原图 URL** 作为缩略图（`:248-255`，`referrerPolicy='no-referrer'`）；失败回落 glyph。
  - 否则 glyph 占位：图片 `◨`、视频 `▶`、截图 `▣`、链接 `↗`、文件 `◇`（`library.js:8,220-225`）。
- 详情抽屉同一策略（`:464-485`）；Triage 也同一策略（`:608-618`）。
- 视频/链接**永远没有缩略图**（`save.js:320` 只处理 `image/*`；`library.js:248` 限定 kind）。
- 清空索引会**同时清空缩略图**（`service-worker.js:458-461`），之后旧素材只能靠远端 URL 或 glyph。
- 缩略图不落盘、不写 sidecar；换浏览器 profile / 重装扩展 / 换机器即丢失。

### 5.5 Inbox triage

`startTriage()`（`library.js:531-543`）：

- 队列 = `state.items.filter(status==='inbox')`，按 `savedAtMs` 倒序；空则 toast 退出。
- 卡片（`:552-662`）：预览 + 标题/来源/类型/尺寸/日期 + 标签（只读前 8 个）+ 项目按钮组 + 三动作。
- 动作：`保留并整理` → `status:'kept'`；`归档` → `archived`；`跳过` → 仅 `index++`（不写盘，下次仍会出现）；`×`/`Esc` 关闭并 reload。
- 键盘：`K`=kept、`A`=archived、`→`=跳过、`Esc`=退出（`:655-661`，提示文案 `:589`）。
- 每次动作 `update-items` 单条 + 重建卡片（`:628-649`）；**不能改标签/备注**；无撤销。
- 完成后 `load()` + toast「Inbox 整理完成」（`:560-566`）。

### 5.6 批量操作

批量栏（`library.html:95-102`）→ `library.js:751-762`：

| 操作 | 实现 | 副作用 |
| --- | --- | --- |
| 移到项目 | `update-items {collection}`（`:751-755`） | 只改元数据，**文件不移动**；toast 明确「文件仍在原路径」 |
| 加标签 | `prompt()` + `addTags`（`:756-760`） | 最多 24 个（`service-worker.js:352`） |
| 标记已整理 | `status:'kept'`（`:761`） | 写 reviewedAt |
| 归档 | `status:'archived'`（`:762`） | 写 reviewedAt |
| 取消 | 清空选择（`:750`） | — |

**没有**：删除/回收站、批量去标签、批量改备注、批量重命名、拖拽移动、复制文件、移动到磁盘其他项目目录。

### 5.7 详情抽屉

`openDetail(id)`（`library.js:369-515`）：`overlay + aside`，非 `<dialog>`；Esc/点遮罩关闭（`:378,510-514`）。

- 预览：同 5.4 策略（`:464-485`）。
- 字段：标题、`site · pageTitle/sourceUrl · savedAtMs`（`:406`）、路径 `absolutePath || relativePath`（`:407`）、项目下拉（含索引中存在但设置里没有的项目，`:416-422`）、状态三按钮（`:424-436`）、标签 chips + 输入（`:437-462`）、备注 textarea（`:453`）。
- 动作：复制路径（`navigator.clipboard`，`:487-490`）、定位文件（`reveal`，`:491-494`；文件夹模式实际只是 toast 显示路径）、打开来源（`pageUrl||sourceUrl`，`:495-499`）、保存修改（`:500-508`）。
- 无「删除」「重命名」「复制文件到…」「在系统中显示」的可靠实现。

### 5.8 导出

- 库页面：`exportItems('md'|'csv')`（`library.js:685-721`）：列表 = filtered；有选中则只导选中（`:686-688`）；CSV 字段 `id,name,kind,project,status,tags,sourceUrl,pageUrl,relativePath,width,height,size,savedAt`（`:692`），带 UTF-8 BOM、`\r\n`；MD 为每项小节（`:706-717`）；用 `chrome.downloads.download`，`saveAs:false`（`:680`）。
- 设置页/popup：导出**索引** JSON/CSV（`service-worker.js:384-399`；`options.js:176-197`；`popup.js:424-439`，popup 用 data URL + `saveAs:true`）。
- 无素材文件导出（打包/复制到项目目录）、无 Eagle/JSON sidecar 导出、无生成 HTML 画册。

---

## 6. 技术债与风险（按主题）

> 标注格式：`风险 → 位置 → 触发条件/影响`。§6.9 给出「未实现」项与搜索范围，避免误判。

### 6.1 索引是唯一真相，且不可从文件重建（最高优先级）

1. **sidecar 是只写的**：全仓库唯一读取 sidecar/JSON 的路径是 `readIndexMirror`（`fs-writer.js:60-82`），没有任何代码扫描目录或解析同名 `.json` 重建索引。→ 删掉 `chrome.storage` 后，虽然文件与 JSON 都在，库页面无法恢复；只能靠用户重新选文件夹触发 `_index.json` 导入（`service-worker.js:401-412,463-467`）。
2. **下载模式完全没有 `_index.json`**（`save.js:315-317` 仅在 folder 分支；`downloads-writer.js` 无 mirror）。→ 下载模式 + 清空索引 + 未重新选文件夹 ⇒ 索引永久丢失（sidecar 无读取方）。
3. **`_index.json` 会被索引反向截断**：库内任意更新会 `writeIndexMirror(root, updated.filter(mode==='folder'))`（`service-worker.js:365-368`）整体覆盖镜像；而索引上限 8000（`store.js:10,92`），镜像原本可无限增长（`fs-writer.js:86-96` 无 cap）。→ 一次批量操作可能把镜像缩到 ≤8000 条，且 `mode` 为空的老记录被丢弃（`:365,360`）。
4. **重新选文件夹不校验身份**：`setRootHandle` 直接覆盖（`store.js:165-167`），`root-changed` 直接把该目录的 `_index.json` 并进当前索引（`service-worker.js:401-412,463-467`），只校验 `id && schema`。→ 选错目录会混入另一个库的记录；旧库路径的记录仍留在索引里但已无法写入。
5. **清空索引连缩略图一起清**（`service-worker.js:458-461`），不可恢复；`clearIndex` 不要求二次确认（确认在 options.js:229 / UI 侧）。
6. **`_index.json` 没有版本/校验和/时间戳**，只有裸数组（`fs-writer.js:92,101`）；被外部编辑或写一半（非原子写，`writeText` 直接覆盖 `fs-writer.js:56-58`）后只能整体丢弃（`JSON.parse` 失败返回 `[]`，`:74-82`）。

### 6.2 索引/sidecar 与元数据不一致

7. **改项目不更新 `collectionPath`**（`service-worker.js:339-341` 只 patch `collection`）。→ 去重键（`save.js:289,344`）用的仍是旧路径：移到新项目后再存同一张图不会判重；`relativePath`/sidecar 里的路径仍是旧项目目录，详情「复制路径」指向旧位置。
8. **下载模式元数据不回写**：`updateItems` 对 `entry.mode !== 'folder'` 直接 `continue`（`service-worker.js:360`）。→ 下载模式的 sidecar 永久停留在保存时状态（status=inbox、旧项目、旧标签），文件旁边就是错误信息。
9. **sidecar 写入失败被吞**（`service-worker.js:363`；`save.js:181`）且无重试/告警。
10. **下载模式 `relativePath ≠ 实际文件名`**：`conflictAction:'uniquify'`（`downloads-writer.js:71`）但 `record.relativePath` 不回写（`save.js:174`）；sidecar 以期望名再下载（`save.js:175-181`），重名时 sidecar 与主文件可能都变成 `name (1).json` / `name (1).jpg`，而内容里的 `relativePath` 仍指 `name.jpg`。→ 按 sidecar 找文件会失败。
11. **`absolutePath` 语义分裂**：folder 模式是字符串 `root.name/rel`（`save.js:161`，不是真实绝对路径），downloads 模式是浏览器绝对路径（`:173`）。→ 「复制路径」在文件夹模式不可直接使用（`library.js:488`）。
12. **`status` 兜底不一致**：保存默认 `inbox`（`save.js:106`），但缺失 status 的旧记录在库/徽标里按 `kept` 处理（`service-worker.js:273-275`）→ 升级后旧素材不进 Inbox。
13. **`reviewedAt` 类型不一致**：`null`（保存时 `save.js:107`）vs 毫秒数（更新时 `service-worker.js:337`、`library.js` 不展示）。
14. **`linkUrl` 不进 sidecar**：`sidecarFor` 无该字段（`save.js:121-147`），只有 `sourceUrl` 兜底（`:117`）→ 从 sidecar 迁移时链接语义依赖 `sourceUrl` 约定。

### 6.3 并发与写入原子性

15. **同内容并发保存存在 check-then-act 竞争**：去重判断在 `save.js:290-297`，写回内存 Map 在 `:328-334`，而并发度 3（`:349`）。两个 worker 同时处理相同 sha 时都可能通过判断 → 落两份文件、索引两条（不同 id）。
16. **索引/镜像/文件三者非原子**：文件先写、镜像再写、索引最后（`save.js:314-318`）；任一步失败 → 文件成孤儿或索引缺条目（错误只体现在该 item 的 `status:'error'`）。
17. **两条串行链互不协调**：`indexWriteChain`（`store.js:74,97,117`）与 `mirrorChain`（`fs-writer.js:84,94,103`）各自排队；service worker 休眠重启后链状态清零（无跨生命周期锁）。
18. **每次保存都重写整个索引/镜像**：`appendIndex` 读全表→map→排序→写（`store.js:81-99`）；`appendIndexMirror` 读全文→parse→写全文（`fs-writer.js:86-96`）。→ O(n) 每次、批量 O(n²)；8000 条时单条保存要读写 MB 级 JSON 两次（且缩进 2）。
19. **stats 只增不减**：`bumpStats` 只对新 id 累加（`store.js:94,146-155`），索引裁剪/清空时 `count/totalBytes` 不回收；`clearIndex` 会重置（`:121-123`），但索引被 8000 裁剪时不会。→ 设置页统计会大于真实库。

### 6.4 权限与路径迁移

20. **权限失效无主动修复**：`requestPermission` 只在 options 页用户手势里（`options.js:137,155`）；SW 只 `query`（`service-worker.js:245-252,284-291`；`store.js:173-181`）。→ 浏览器重启后保存：folder 模式直接失败，auto 模式静默写下载目录（`save.js:27-35`），库被拆到两个根。
21. **换文件夹 = 断链，不迁移**：`chooseFolder()` 只覆盖句柄并触发导入（`options.js:128-150`）；旧文件的 `relativePath` 是相对旧根的，索引里没有根标识/根指纹；`absolutePath=root.name/...`（`save.js:161`）同名文件夹也无法区分。→ 换根后所有旧记录「定位文件」失效。
22. **改名/移动项目不改目录**：见 §6.2#7；项目名清洗规则可能让两个项目映射到同一目录（`save.js:46` `sanitizeSegment(name,40).replace(/[\\/]+/g,'-')`；`naming.js:5-15`）→ 目录合并、去重键相同。
23. **`downloadsSubfolder` / `filenameTemplate` 改名不影响历史记录**，只影响新保存；没有迁移/重写工具。
24. **没有校验「文件是否还在」**：索引条目的 `relativePath` 从不回查；用户手动移动/删除文件后库仍显示，缩略图来自 IDB 缓存会造成「文件在」的错觉。

### 6.5 大库/性能

25. **库页面一次性接收全部索引**：`buildLibraryState` 返回全部 `items`（`service-worker.js:299-327`），经消息序列化整包传给页面；8000 条时单次消息数 MB 级，且每次编辑后 `await load()` 全量重取（`library.js:354-367`）。
26. **`filtered()` 每次渲染至少跑 2 次**（`renderHead` `library.js:202`、`renderGrid` `:314`），每次都 `slice()` + 过滤 + 排序；勾选一项也会触发 `renderBatch()+renderHead()`（`:276-277`），全选/取消全选重建整个网格（`:743-748`）。
27. **无虚拟滚动**：每个卡片是真实 DOM + 一次 IndexedDB 读取（`library.js:239`）；`loadMore` 只增不减 DOM（`:742`）。
28. **object URL 不按项回收**：`state.thumbUrls` 只增，`beforeunload` 才 revoke（`library.js:28,792-794`）。
29. **徽标/统计每次保存全量扫描索引**：`refreshBadge`（`service-worker.js:229-236`）在 `afterSave`（`:195`）与更新后（`:370`）各跑一次；`buildState` 对最后 800 条聚合标签（`:255-261`）。
30. **整页截图的内存压力**：`OffscreenCanvas` 最大 16000px 高 + 80 tile（`screenshot.js:81-93`），每一步再 `dataUrl → blob → bitmap`（`:98-100`）；大页面可能长时间占用 SW。

### 6.6 采集健壮性

31. **防盗链只有单层识别**：referrer 失败才重试无 referrer（`media.js:64-69`）；没有换 origin/Referer 策略、没有页面上下文二次抓取；`force-cache` + `credentials:'include'`（`:52-55`）可能取到缓存旧字节。
32. **`blob:` 素材在 Alt+S/右键路径不可保存**（`media.js:46-48`），只有拖拽面板会转 data URL（`drag-save.js:43-55,881-885`）。
33. **元素截图受视口限制**：`cropImage` 把矩形 clamp 到截图内（`media.js:155-158`），比视口高的元素会被截断；`scrollIntoView` 后 260ms 再截（`hover.js:262-268`），懒加载/动画可能没就绪。
34. **整页截图上限硬编码**：16000px / 80 tile（`screenshot.js:81,93`），超出部分静默丢失；`fixed/sticky` 只隐藏一次（`:13-38`），滚动中出现的吸顶元素仍可能被重复截入。
35. **截图格式命名不一致**：设置值 `'jpg'`（`config.js:13`、`options.html:112-115`）vs `captureVisibleTab` 的 `'jpeg'`（`screenshot.js:6-8,61`）靠 `save.js:255` 单独判断 `'jpg'`；`OffscreenCanvas` 缺失时静默保持 PNG（`media.js:134-142`）。
36. **视频无封面/缩略图**：`save.js:320` 只处理 `image/*`；`<video>` 的 poster 在识别阶段会被当成图片（`hover.js:55-66`、`drag-save.js:128-145`），但 `kind:'video'` 的文件本身无预览；视频下载有 220MB 上限（`media.js:3`），大视频直接失败。
37. **popup 扫描上限与过滤不一致**：300 张上限（`popup.js:245`）、背景图最多扫 4000 元素（`:218`）、尺寸过滤 AND/OR 不一致（`:181` vs `:299`）。
38. **外部拖入未接入**：无 `dragover/drop` 监听外部来源；README:270 亦自认（搜索范围：`drag-save.js` 全部 `drop` 监听只在收藏页 shadow root 内，`:348-378`）。
39. **批量保存无项目选择**：popup 只发 tags/note（`popup.js:392`）→ 默认项目；批量进错项目需事后整理。
40. **失败无重试**：`saveItems` 返回 error 结果后 UI 只提示数量（`popup.js:404-408`）；没有「重试失败项」。
41. **图片解码失败时尺寸为 0**（`media.js:101-124`），卡片显示无尺寸；SVG 有兜底解析（`:109-121`），其他格式没有。
42. **媒体类型白名单式拦截**：`text/html`/`application/json` 直接判定防盗链（`media.js:84-86`），会把合法的 JSON/HTML 素材（如 `.svg` 返回 `image/svg+xml` 不受影响，但 `.html` 链接页、JSON 数据集）判为失败。

### 6.7 搜索与整理 UX

43. **`after:` 等日期语法不存在**（见 §5.3）；`before/date/color/star/尺寸` 均无。
44. **同前缀多 token 只取最后一个**（`library.js:93-97`）→ `tag:a tag:b` 实际只筛 `b`。
45. **无引号/转义**：标签或项目名含空格无法用 `tag:` 命中（空格被分词切成 text）。
46. **搜索字段不覆盖 `relativePath/pageUrl/ext/mime/linkUrl`**（`library.js:122`）→ 不能按文件名/路径/站点 URL 找。
47. **`is:` 不校验枚举**（`library.js:116`），拼错静默 0 结果。
48. **项目/标签无法重命名、删除、排序**；项目仅「＋」（`library.js:664-675`）；标签只能逐个加（`:756-760`）不能删。
49. **Triage 不写标签/备注/跳过记录**（`library.js:628-652`），无撤销；大批量整理只能逐张点。
50. **无「未整理」以外的视图维度**：没有「本周新增」「未标注来源」「无标签」「重复项」等智能集合。
51. **无重复项管理 UI**：虽然索引有 `sha256`，但界面不展示重复组，也不能合并/去重（只能靠保存时拦截）。
52. **无排序下拉之外的维度**（尺寸/类型/站点/项目分组/最近修改）。

### 6.8 代码健康/可维护性

53. **死代码**：`config.js:33-39`（`KIND_LABEL`，UI 各自复制）、`:41`（`MAX_BATCH`，无引用）；`fs-writer.js:117-127`（`fileCountHint`，无调用）；`thumb-store.js:44-71`（`deleteThumb`/`thumbCount`，无调用）；`naming.js:126-128,130-148`（`isImageExt`/`humanBytes`/`timeAgo`，UI 各自复制）。
54. **死消息处理器**：`save-link`（`service-worker.js:447-448`）、`stats`（`:477-478`）、`ping`（`:479-480`）在仓库内无发送方（grep `type: '...'` 与 `type:"..."` 全仓库确认）。
55. **重复实现**：`humanBytes`/`timeAgo`/`KIND_LABEL` 在 `popup.js:27-45,4`、`options.js:26-33`、`library.js:7,40-47` 各一份；权限查询在 `store.js:173-181`、`service-worker.js:245-252,284-291`、`options.js:82-88` 各一份。
56. **无 schema 迁移代码**：只有常量 `SCHEMA`（`config.js:2`）和导入时的 `id && schema` 粗校验（`service-worker.js:406`）；没有版本升级逻辑。
57. **无构建/类型/i18n**：纯 ESM 静态文件；文案硬编码中文（`manifest.json`、所有 UI）。
58. **测试覆盖缺口**（`test/e2e.js`）：覆盖保存/拖拽/项目/截图/去重/库/triage/导出（详见 §8），但**未覆盖**搜索前缀语法、权限失效、文件夹迁移、多项目同内容去重、镜像导入/截断、下载模式 sidecar 更新、并发保存。
59. **e2e 依赖硬编码 Edge 路径**（`test/e2e.js:16`）且会 `fs.rmSync(out)`（`:13`）——本次审计按要求未运行。

### 6.9 「未实现」判定与搜索范围

| 判定 | 搜索范围与证据 |
| --- | --- |
| 无删除/回收站 | 全仓库 `*.js` grep `delete|trash|removeItem|unlink`：仅 DOM `remove()` 与 `deleteThumb`（无调用）；`updateItems` 无 delete 分支（`service-worker.js:330-377`） |
| 无 sidecar 读取/重建 | `readText` 唯一调用点 `readIndexMirror`（`fs-writer.js:60-82`）；无目录遍历（`entries()` 仅 `fileCountHint` 死代码 `:117-127` 与 e2e） |
| 无文件夹树 | 项目模型只有 `settings.collections: string[]`（`config.js:19`）与 `item.collection/collectionPath`；无 children/parent/嵌套结构（`service-worker.js:292-315`） |
| 无色板/颜色搜索 | 全仓库 grep `palette|color:`：仅 CSS `color:`；无色彩提取代码 |
| 无评分/星标 | grep `star|rating`：仅 README/eagle-research 文案 |
| 无磁盘缩略图 | 缩略图只有 `thumb-store.js`（IndexedDB）与 `save.js:320-326` 写入；无 `.png` 缩略图落盘 |
| 无对外 API/本地服务 | 无 `localhost`/`fetch` 到本机服务；唯一网络出口是素材 `fetch`（`media.js:40-94`） |
| 无 OS 拖入 | `dragover/drop` 监听仅存在于收藏页 shadow root（`drag-save.js:348-378`） |
| 无自动更新/同步 | 无 `chrome.storage.onChanged`、无定时器、无同步逻辑（grep `onChanged`：仅 `chrome.downloads.onChanged`，`downloads-writer.js:18,26,41`） |
| 无 i18n | 无 `_locales`、无 `chrome.i18n`（grep 全仓库无命中） |

---

## 7. 相对 Eagle 的缺失 / 薄弱（按重要性排序）

> Eagle 基线来自 `docs/archive/eagle-research.md`（库结构 `:229-242`、单条 metadata `:244-267`、缩略图命名 `:167-171`、文件夹树/tags `:230-231`、41593/41595 接口 `:54-83,187-221`、扩展 payload `:129-157`、设计映射 `:286-296`）。

| # | 差距 | Ant-col 现状（证据） | Eagle 基线 | 影响 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| 1 | **库的可迁移性/可重建性** | 元数据主副本在 `chrome.storage`（`store.js:76-99`），sidecar 只写不读（§6.1），缩略图只在 IDB | 每条素材 `<ID>.info/` 内含原文件 + `_thumbnail.png` + `metadata.json`（`eagle-research.md:229-242`），库目录本身就是完整库 | 浏览器 profile 损坏/重装/换机即「有文件没库」；无法像 Eagle 一样整库拷走 | P0 |
| 2 | **磁盘缩略图 / 视频封面** | 仅保存时生成 360px JPEG 存 IDB（`save.js:320-326`）；视频/链接无缩略图；清索引即清缩略图（`service-worker.js:458-461`） | 缩略图固定落盘 `<name>_thumbnail.png`（`eagle-research.md:167-171`） | 库页面在缩略图缺失时回落到远端 URL（隐私 + 失效）或 glyph；无法离线浏览 | P0 |
| 3 | **文件夹树 / 智能文件夹 / 已存筛选** | 单层 `collections: string[]` + 扁平 `collection`（`config.js:19`；`service-worker.js:292-315`）；无嵌套、无智能集合、无收藏夹组 | `metadata.json` 的 `folders` 树（含 children）+ `smartFolders` / `saved-filters.json`（`eagle-research.md:230,233`） | 大库无法按层级组织，只能靠项目名/标签；找回效率低 | P0 |
| 4 | **颜色/色板检索** | 无色彩字段（§6.9） | 每条 metadata 有 `palettes`（color+ratio，`eagle-research.md:262-265`） | 视觉素材最常用的「按颜色找」缺失 | P1 |
| 5 | **评分/标记/优先级** | 无 star/评分（§6.9） | 扩展 payload 含 `star`（`eagle-research.md:141`），API 支持 `item/update` 改 star（`:212`） | 无法在一堆素材里标「首选」；只能靠 kept/archived 粗分 | P1 |
| 6 | **删除/回收站/撤销** | 无任何删除入口（§6.9） | `isDeleted` 字段 + 客户端回收站语义（`eagle-research.md:244-267`） | 误采无法清理，库只增不减；只能手动去资源管理器删文件且索引仍残留 | P1 |
| 7 | **互操作/迁移（Eagle 导入导出、XMP、API）** | 无 Eagle 导入、无 XMP、无本地 API；导出仅 MD/CSV/索引 JSON（`service-worker.js:384-399`；`library.js:685-721`） | 41595 JSON API（`addFromURL(s)/addFromPath(s)/update/list/thumbnail`，`eagle-research.md:196-221`）+ 可选 `.xmp`（`:241`） | 无法与 Eagle 双向迁移，也无法被脚本/其他工具消费 | P1 |
| 8 | **文件级管理（重命名/移动/复制/去重清理）** | 项目变更只改元数据（`service-worker.js:339-341`）；无重命名、无移动文件、无重复组管理 | Eagle 库管理 + API `item/update` + 文件在 `.info` 内随条目管理 | 磁盘目录会与库视图脱节；同图多份只靠保存时拦截 | P1 |
| 9 | **素材本体支持广度（PDF/文件/OS 拖入/站内适配）** | 仅 image/video/screenshot/link（`config.js:25-31`，`file` 无生产者）；无 OS 拖入（§6.9）；无站点适配器 | 扩展含 `siteParser`（小红书/Pinterest 等）与 `import-images` 批量（`eagle-research.md:108-157`） | 采集面窄；社交/设计站点的结构化信息拿不到 | P2 |
| 10 | **视频体验** | 无缩略图/播放预览/清晰度选择；大文件 220MB 直接失败（`media.js:3`） | Eagle 有缩略图与预览播放（库窗口渲染器） | 视频素材几乎不可用 | P2 |
| 11 | **检索语法与筛选维度** | 5 个前缀且单值、`after:` 未实现（`library.js:90-101`；§5.3） | Eagle 提供 `GET /api/item/list` 条件查询与分页（`eagle-research.md:218`） | 精确找回能力弱 | P2 |
| 12 | **大库性能** | 全量索引消息、全量重渲染、无虚拟滚动、每次保存重写整索引/镜像（§6.3,6.5） | Eagle 有增量 `mtime.json` 与 `item/list` 分页（`eagle-research.md:232,215`） | 5000+ 条后保存/打开库明显变慢 | P2 |
| 13 | **多库/切换库/备份** | 单库单根（`store.js:159-171`）；无备份、无库切换 | `/api/library/switch` + `backup/`（`eagle-research.md:203,235`） | 无法按主题分库或做快照 | P2 |
| 14 | **采集现场的结构化上下文** | 只存 title/alt/site/pageTitle/annotation（§4.1） | payload 含 `behavior`、`version`、`star`、`folderIDs`，metadata 含 `btime/mtime/lastModified`（`eagle-research.md:129-157,244-267`） | 以后做「采集行为分析/来源评分」缺字段 | P3 |
| 15 | **本地服务与外部联动** | 无 41593/41595 对应能力 | 扩展 ↔ 客户端本地 HTTP 桥（`eagle-research.md:54-83`） | 无法与第三方 pipeline/脚本联动（纯扩展是设计取舍，但确为能力差） | P3 |
| 16 | **标签体系（分组/层级/历史）** | 扁平 tags，无分组/重命名/删除 | `tags.json`（historyTags/starredTags）+ `tagsGroups`（`eagle-research.md:230-231`） | 标签多了以后管理成本高 | P3 |

补充：Ant-col 在「纯本地、无账号、无客户端」这一条上优于 Eagle（不需要常驻 Electron/端口），并且 sidecar + `_index.json` 的设计方向（文件是真相）是对的，**问题在于当前实现没有把「文件是真相」闭环**（缺 sidecar/目录扫描重建、缩略图落盘）。

---

## 8. 附录

### 8.1 消息类型清单（`service-worker.js:414-489`）

| 类型 | 发送方 | 作用 | 状态 |
| --- | --- | --- | --- |
| `state` | popup:56 | 设置/根/统计/最近 40/标签 | 使用中 |
| `quick-state` | drag-save:184 | 项目列表/默认项目/根/标签 | 使用中 |
| `add-collection` | drag-save:543、library:667 | 新增项目（≤24） | 使用中 |
| `library-state` | library:64 | 全量库状态 | 使用中 |
| `update-items` | library:357,634 | 状态/项目/标签/备注 | 使用中 |
| `open-library` | popup:454、options:218 | 新标签打开库 | 使用中 |
| `save` | drag-save:899、popup:398 | 保存 | 使用中 |
| `save-link` | — | 保存链接 | **死代码** |
| `save-screenshot` | e2e:476,528；`captureAndSaveMessage` | 截图保存 | 仅测试/内部 |
| `element-selected` | hover:282 | 元素框选完成 | 使用中 |
| `open-options` | popup:455-456、library:736 | 打开设置 | 使用中 |
| `export-index` | popup:426、options:178 | 导出索引 JSON/CSV | 使用中 |
| `clear-index` | options:230 | 清索引+缩略图 | 使用中 |
| `root-changed` | options:144,157 | 导入镜像 | 使用中 |
| `reveal` | popup:129、library:492 | 定位文件 | 使用中（folder 模式弱） |
| `show-default-folder` | popup:472、options:225、library:738 | 打开下载目录 | 使用中 |
| `stats` | — | 读统计 | **死代码** |
| `ping` | — | 版本 | **死代码** |
| `save-progress`（SW→UI 广播） | save.js:363 | 进度条 | 使用中 |
| `vv-get-hovered` / `vv-toast` / `vv-start-element-capture` | SW→content | 悬停/提示/框选 | 使用中 |

### 8.2 E2E 已验证行为（`test/e2e.js`，仅阅读未执行）

扩展加载与 SW 就绪（`:112-163`）；悬停识别（`:174-213`）；拖拽→收藏页→面板→保存（`:215-271`）；图片内嵌链接 → 图片/链接卡片双模式（`:273-312`）；拖到项目行（`:314-350`）；新建项目→面板（`:352-397`）；下载模式批量保存 2 张（`:399-424`）；OPFS 文件夹模式 + sidecar + `_index.json`（`:426-464`）；popup 截图（`:466-472`）；可见截图（`:474-479`）；元素截图（`:481-498`）；去重（`:500-507`）；链接卡片（`:518-521`）；整页截图（`:523-529`）；库初始化/缩略图 blob 数/分页隐藏（`:531-557`）；批量移项目（`:559-572`）；文本搜索 `art-1`（`:573-584`）；详情（`:586-601`）；更新 + 文件夹镜像状态（`:602-625`）；triage 保留（`:627-645`）；导出 MD（`:646-648`）；设置页 + `showDirectoryPicker` 存在（`:650-664`）；三个「拖拽起点非 `<img>`」回归（CSS 背景 `:735`、链接包裹图 `:736-741`，`:666-742`）。

### 8.3 审计不确定性

- 未运行任何浏览器/扩展，权限、下载、FSA 行为均来自代码路径与已有 e2e 产物（`test/out/`）；`test/out/downloads` 中可见真实落盘样本与 `_index.json` 缺失于下载模式（与代码一致）。
- 「大库性能」为代码级推断（全量读写/全量消息/无虚拟滚动），未做真实 5000+ 条压测。
- 行号以当前 HEAD 为准；后续改动需重新对齐。
