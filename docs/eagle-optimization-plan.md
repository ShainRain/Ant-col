# Eagle 逆向 × Ant-col 优化方案

> **范围说明**：本文聚焦「保存路径 + library 排列 + 数据层」；扩展功能层（采集即归类、批量工作台、截图裁剪、URL 放大、站点插件）的终局方案见 **[ant-col-ultimate-plan.md](ant-col-ultimate-plan.md)**，两份方案共用同一套数据模型 v3 与路线图。

> 目标：用 REA 还原 Eagle 4.0.0「网页素材 → 磁盘文件」的保存路径实现，以及 library 的组织/排列方式；对照本仓库 Ant-col（v1.2.1，git `a5b366a`）的现状，给出可落地、可验收的优化方案。
>
> 证据分四层：REA 静态应用图（app.asar / 扩展）、Eagle 源码解包精读、Eagle 本地 API 运行时探针、Ant-col 仓库逐行审计。每条结论尽量给到 `文件:行号` 或运行时路径，未确认项集中列在 §7。

---

## 0. 结论先行

**Eagle 的「保存路径」不是路径模板，而是一条“下载 → 临时文件 → 每个 item 一个不可变目录”的入库管线：**

```
扩展只发"意图"（src/title/url/tags/folderIDs/star）
  → 41593 表单（主进程）或 41595 JSON API（渲染器）
  → downloader：先落到 userData/eagle-temp/<id>（无扩展名），嗅探真实格式
  → processImage()：<library>/images/<ID>.info/<name>.<ext>
                    + <name>_thumbnail.png（内容是 WebP，最长边约 320）
                    + metadata.json（单行，含 folders/tags/star/palettes/...）
  → 队列写 item metadata → mtime.json → userData 缓存 txt
```

**Eagle 的「library 排列」分两层：**

- **磁盘层**：`images/` 是**平铺**的 `<ID>.info/` 目录（不按文件夹/日期分目录）；组织结构在 4 个库级 JSON 里：`metadata.json`（folder 树 / smartFolders / quickAccess / tagsGroups）、`mtime.json`（增量基准）、`tags.json`、`saved-filters.json`。**文件夹归属、多归属、评分、颜色全是元数据，物理文件不动。**
- **视图层**：`folder` 树的位置 = `metadata.json` 数组顺序（无 sortIndex）；每个 folder 可覆盖条目排序 `orderBy + sortIncrease`；手动排序 = `item.order[folderId]` 小数；置顶 = `item.pinned[folderId]`；排序在渲染器内存里用 `sortRawData/sortData` 完成（12 个排序键）。

**Ant-col 的现状与差距（一句话）**：方向对（sidecar + `_index.json` 镜像 + 人类可读路径），但**“文件是真相”没有闭环**——索引是唯一真相、缩略图只在 IndexedDB、组织模型是单层项目、没有排序/评分/回收站，且每次保存都重写整份索引。

**优化主线（按优先级）**：

| 优先级 | 改造 | 一句话 |
|---|---|---|
| **P0-1** | 索引可重建 | sidecar 升为真相；`_library.json` 快照 + `_journal.ndjson` 追加日志；目录扫描可全量重建 |
| **P0-2** | 缩略图落盘 | `_thumbs/<xx>/<id>.webp`；视频首帧；IDB 降级为渲染缓存 |
| **P0-3** | 组织模型 v3 | 单层 projects → folder 树 + 多归属；智能集合（规则） |
| **P1-1** | 排列与排序 | 12 个排序键、folder 覆盖、手动序、置顶、4 种视图 |
| **P1-2** | 元数据增强 | star / palettes / duration / btime / lastModified |
| **P1-3** | 写入与查询性能 | O(1) 追加、分页消息、虚拟滚动、索引分片 |
| **P1-4** | 删除/回收站/撤销 | 软删 + trash 视图 + purge + 5s 撤销 |
| **P2** | 迁移与互操作 | Eagle `.library` 导入、`.eaglepack` 导出、XMP 可选 |

**不照搬**：常驻 41593/41595 服务、bytenode `.jsc`、AngularJS 全量内存排序、单文件全量 metadata.json、缩略图只存 IDB。

---

## 1. 研究目标与方法

### 1.1 目标清单

| # | 问题 | 需要的证据 |
|---|---|---|
| Q1 | 扩展把什么交给客户端？字段与协议 | 扩展 shipped artifact + 运行时 41593/41595 |
| Q2 | 下载/命名/扩展名/缩略图/落盘顺序如何决定？ | app.asar 源码 + 运行时磁盘结果 |
| Q3 | library 的磁盘布局与全局索引文件是什么？ | 源码 + 文档 + 运行时库 |
| Q4 | item 在库里如何“排列”？排序键、手动序、置顶、folder 位置 | app.bundle.js + 运行时 metadata |
| Q5 | Ant-col 当前每条链路的实际实现与债务 | 仓库审计（`docs/research/antcol-current-state.md`） |
| Q6 | 哪些能直接搬、哪些必须改造、哪些不该搬？ | 综合取舍 |

### 1.2 目标与证据基线

| 对象 | 路径 / 身份 | 证据 |
|---|---|---|
| Eagle 主程序 | `D:\Eagle\Eagle.exe` 4.0.0 build 20260401，Electron 22.3.7 | `resources/package.json`、`D:\Eagle\version` |
| app.asar | 109,208,710 bytes，SHA-256 `a33a48f2…173a2` | REA `analyze_javascript_application` 证据 `ev_9fb963e4…` |
| 主程序分析范围 | `app/js/background.js`、`app/js/api-server.js`、`app/js/tree.helper.js`（+ 解包全量只读精读） | REA 覆盖 3/7050 文件（`source_selection`），其余为人工精读 |
| Eagle 扩展 | Edge `…\Extensions\cfgchmkedjfehclfhhmgedljhcibojcm\3.1.26_0`，目录 SHA-256 `7efbfff4…61aaf` | REA 证据 `ev_4c3accfe…`（102 个 JS，覆盖 partial） |
| 运行时库 | `D:\eagle-probe\probe.library`（由空库 `D:\Eagle\文章.library` 复制） | 46 个 item 的实测磁盘结果 |
| Ant-col | 本仓库 v1.2.1 / `a5b366a` | `docs/research/antcol-current-state.md`（730 行、326 处引用） |

> **边界**：Eagle 主进程 `run.jsc` / `main.jsc` 是 bytenode V8 字节码，无法反编译；41593 服务端细节、`net` 下载实现只能由字符串/IPC/日志推断。静态报告（`docs/research/eagle-static-analysis.md`）第 E 节逐条列出了这些未知。

---

## 2. Eagle 的抓取保存路径实现

### 2.1 端到端链路

| 层 | 组件 | 入口 | 动作 |
|---|---|---|---|
| 浏览器 | Eagle 扩展 content script | 拖拽 / Alt+右键 / 批量面板 / 截图 | 提取 `src/尺寸/来源页/标签`，组装 payload |
| 协议 | `POST http://localhost:41593`（表单） | `type=image / save-url / import-images` | 扩展默认通道；`folderID`、`folderIDs`、`star`、`annotation`、`base64` |
| 协议 | `POST http://localhost:41595/api/item/addFromURL(s)` / `addFromPath(s)` / `addBookmark` | JSON | 扩展在“浏览器下载”模式下改走此通道；对外 API/插件也走这里 |
| 主进程 | `run.jsc`（41593 server） | `run.jsc` 字符串 `initServer / EXTENSION_PORT / createServer` | 解析表单 → IPC `upload-from-extension / url-from-extension / screencapture-from-extension / upload-images`（**推断**） |
| 渲染器 | `app/js/background.js` | `uploadUrl()`、`uploadFileQueue()`、`addToProcessQueue()` | 统一进入 `processImage()` |
| 下载 | `app/js/downloader/downloader.js` | `downloadWithNet → downloadWithRequest → downloadWithFetch(30s) → base64` | 先写 `userData/eagle-temp/<id>`（无扩展名），再按魔数嗅探扩展名 |
| 落盘 | `processImage()` `background.js:6105-6313` | — | 建目录 → 复制/移动 → 缩略图 → 色板 → 写 metadata |
| 索引 | `metadataQueueCallback` / `createMTimeLogs` / `updateCacheFile` | — | item metadata → `mtime.json` → userData 缓存 |

关键代码位置：

- 41593/41595 常量：`app/js/config.js:5-7`；41595 API 实现：`app/js/api-server.js:1-5,981-1018`。
- 扩展侧 payload 组装：`js/lib/api/item.js`（`addFile` / `addBatchSaveFile` / `addScreenshot` / `addURL` / `batchSave`），格式化版 `D:\eagle-ext-pretty\js_lib_api_item.js.txt`。
- 下载器：`downloader.js:203-286`（`downloadWithNet`）；固定 UA（源码为 Mac UA，实测为 Windows UA + `Electron/21.0.0 Eagle/4.0.0`）；**Referer 只在** `params.website || params.headers || pixiv/pximg/doubanio/bigurl/sinaimg` 时被显式设置（`:213-221`）。
- **运行时修正（重要）**：即使没有 `website`，实测请求仍带 `Referer: <下载 URL 自身>`，且会重试 2 次；失败后回退 `fetch`（**不带 Referer**）第 3 次。`headers:{Referer:…}` 参数会被忽略。所以“来源页 Referer”只在传 `website` 时成立，默认是“资源自引用 Referer + 最终无 Referer 兜底”。

### 2.2 落盘核心：`processImage()`

`app/js/background.js:6105-6313` 的顺序（逐行可查）：

1. `stat()` 得到 `size / btime / mtime`（`:6155-6159`）。
2. 决定 `ext`：调用方 `file.ext`，否则 `getExt()` 嗅探；识别不到直接失败（`:6171-6177`）。
3. 命名净化：`sanitize(file.name.replace("."+ext,"")).trim()` → `substr(0, remainingFilenameLength(library.rootDir))` → `unorm.nfc()` → 空名变 `_`（`:6183-6190`）。
4. 计算路径并建目录：
   - `dir = library.imagesDir + id + ".info/"`（`:6110`）
   - `rawPath = dir + name + "." + ext`（`:6193`）
   - `thumbnailPath = dir + name + "_thumbnail.png"`（`:6194`）
   - `mkdir(dir, 0755)`（`:6196`）
5. 组装 item 元数据对象（`:6198-6221`）：`id/name/size/btime/mtime/ext/tags/folders/isDeleted/url/annotation/modificationTime/star`；只有网络下载才允许外部控制 `modificationTime`。
6. `copyProcessFile()`：从 userData 临时目录来的文件是 **移动**（cutMode），否则复制并保留时间戳（`:6045-6100, 6252-6257`）。
7. `ThumbGenerator.generate()` → 缩略图；失败则 `noPreview:true` 仍入库（`:6264-6294`）。
   - 目标文件固定 `<name>_thumbnail.png`，但**内容是 WebP**（VP8，q0.75）；缩放规则：若 `max(w,h)>320`，则**短边固定 320、长边等比放大**（横图 → 480×320，竖图 → 320×H），小于 320 不放大（`utils/compress.js:21-31`）。
   - `noThumbnail` 条件（`config.js:8-10` + `thumbs/jpg|png.js`）：`jpg/png/bmp/jxl` 且 `w≤960 && h≤960 && size≤15MB` → 不生成；`png` 额外 `size>1MB` 强制生成；`gif` 恒生成。
   - `GET /api/item/thumbnail` 返回的是**文件路径 JSON**，不是二进制。
8. `ColorAnalyzer.addTask()` 生成 `palettes`。
9. `onImagesChange([item], true)` 入队写 `metadata.json`。

**运行时验证**（`D:\eagle-probe\probe.library`）：

```text
images/MVF578WUM0FRJ.info/
├── MVF578WQE4J4P.gif                 ← 原始文件
├── MVF578WQE4J4P_thumbnail.png       ← 实际字节：RIFF....WEBP
└── metadata.json                     ← 单行 JSON
```

item metadata 实测样例（节选）：

```json
{"id":"MVF5788SWN55J","name":"MVF5788M17K99","size":11469,"btime":1792407590525,"mtime":1792407590530,
 "ext":"jpg","tags":[],"folders":[],"isDeleted":false,"url":"","annotation":"",
 "modificationTime":1792407590521,"height":240,"width":320,"noThumbnail":true,
 "lastModified":1792407590630,
 "palettes":[{"color":[43,82,219],"ratio":75},{"color":[196,104,124],"ratio":6}, ...]}
```

### 2.3 保存路径的四个关键设计决定

| 决定 | Eagle 做法 | 影响 |
|---|---|---|
| **身份与路径解耦** | `id`（13 位 base36）决定目录名 `images/<ID>.info/`；`name` 只是展示名，改名只改目录内的文件与 metadata | 重命名不破坏索引；文件夹/项目变化完全不动物理文件 |
| **item 自包含** | 一个 item = 一个目录，内含原文件 + 缩略图 + metadata（可选 `.xmp`） | 删除/复制/备份/迁移以目录为单位；外部同步冲突按 item 隔离 |
| **临时区隔离** | 下载先落 `userData/eagle-temp/<id>`，校验格式/大小后再移动进库（`:6045-6100`） | 库内不会出现半截文件；失败只脏临时区 |
| **层级不入路径** | `images/` 平铺，folder 只是 metadata 里的 `folders: string[]`（`app.bundle.js:30128-30225`、`api-server.js:761-765`） | 归类是 O(1) 元数据修改；多归属天然支持 |

### 2.4 命名 / 净化 / ID 规则

| 规则 | 实现 |
|---|---|
| 去非法字符 | `sanitize-filename`：`\/?<>\\:*|"`、控制码、Windows 保留名、尾部空格，UTF-8 截断 255 字节（`my_modules/sanitize-filename/index.js:33-49`） |
| 路径长度约束 | `remainingFilenameLength(library.rootDir)` 按库路径剩余长度截断（`utils/remainingFilenameLength.js:4-36`） |
| Unicode | `unorm.nfc()`（`background.js:6185`） |
| 空名 | 变成 `_`（`:6188-6190`） |
| 扩展名 | 下载后用魔数嗅探（`downloader.js:258`）；不看 URL 后缀 |
| ID | `(Date.now().toString(36) + Math.random().toString(36).substr(2,5)).toUpperCase()`（`:6340`），13 位；加载只接受 13/36 位目录名（`:2811`）；**无碰撞重试** |
| 重名 | 不存在（每 item 独占目录）；导出时才用 `-NN` 去重（`:4230-4239`） |

### 2.5 失败与边界（运行时）

- **404**：`net` 失败 → `request` 失败 → `fetch` 得到 404 → 报 `HTTP_ERROR`，不落库；日志实测 `Cannot download file [HTTP_ERROR: HTTP 404 Not Found]`。
- **返回 HTML**：下载器明确拒绝 `text/html`（`downloader.js:288-341`），避免把防盗链页面当图片存。
- **小图**：`noThumbnail:true` 时直接用原图做颜色分析（如 320×240 JPG 实测无缩略图）。
- **超时**：fetch 30s；入库 `processQueue` 单任务 300s（`:6010`）。
- **取消**：取消任务会 `fse.remove(dir)` 清理半成品（`:5929-5941, 6259-6262`）。
- **书签**：`url-from-extension` 先写 `eagle-temp/<name>.url`（InternetShortcut 文本），再走同一入库管线（`:812-845`）；实测库内出现 `Probe Article Title.url`，`ext=url`。
- **41593 无成败语义**：实测 `type=image` 成功、`type=save-url` 建书签、`type=import-images` 只写日志（需 UI 确认）；无 `title`/404/未知 `type` 一律 HTTP 200 + preferences JSON，只从日志与磁盘判断是否入库。
- **缩略图实测**：`_thumbnail.png` 头部 `52 49 46 46 … 57 45 42 50` = `RIFF....WEBP`；2400×1600 原图 → 480×320；2880×1704 截图 → 540×320；200×150 GIF 不放大；960×960 JPG 无缩略图、961×961 有。

---

## 3. Eagle 的 library 排列方式

### 3.1 磁盘布局

```text
<name>.library/
├── metadata.json          # 6 个顶层字段：applicationVersion / folders / smartFolders / quickAccess / tagsGroups / modificationTime
├── mtime.json             # { <itemId>: <lastModified>, "all": <count> }
├── tags.json              # { "historyTags": [], "starredTags": [] }
├── saved-filters.json     # 已存筛选（数组）
├── backup/                # backup-YYYY-MM-DD HH.mm.ss.SSS.json，最多 100 份
├── images/
│   └── <ID>.info/
│       ├── <name>.<ext>
│       ├── <name>_thumbnail.png   # 实际多为 WebP 字节
│       └── metadata.json
└── extract/               # 临时解包目录，启动清空
```

`metadata.json` 的 folder 节点实测（`D:\eagle-probe\probe.library`）：

```json
{"id":"MVF56HILBDALR","name":"普通文件夹","description":"","children":[...],
 "modificationTime":1792407555885,"tags":[],"password":"","passwordTips":""}
```

注意：**默认没有 `orderBy/sortIncrease` 字段**；只有用户给该 folder 选过排序才会写入。folder 名字允许 `/`、emoji、首尾空格（实测均原样保存）——因为 folder 不入路径。

### 3.2 item / 库级数据模型

item metadata 字段（静态 + 实测）：

| 字段 | 含义 |
|---|---|
| `id` / `name` / `ext` / `size` / `width` / `height` | 身份、展示名、格式、物理属性 |
| `btime` / `mtime` / `modificationTime` / `lastModified` | 创建/修改/入库排序时间/元数据版本 |
| `folders: string[]` | **多 folder 归属**；增删只改数组 |
| `order: { [folderId]: string }` | **手动排序**分数（BigNumber 字符串） |
| `pinned: { [folderId]: number }` | 置顶时间戳 |
| `star: 0-5` | 评分 |
| `tags: string[]` / `annotation` / `url` | 标签、备注、来源 |
| `palettes: [{color:[r,g,b], ratio}]` | 自动色板 |
| `isDeleted` / `deletedTime` | **软删**（文件仍在 `images/`） |
| `duration` / `noThumbnail` / `processingPalette` | 视频时长/缩略图/色板状态 |

库级 `metadata.json`：

- `folders`：树（`children` 嵌套），节点字段 `id/name/description/children/modificationTime/tags/password/passwordTips/icon/iconColor/pinyin/coverId`，可选 `orderBy/sortIncrease`。
- **folder 名不做 sanitize**：`/ \ : * ? " < > |`、emoji、200 字符、首尾空格、重复名全部原样保存（实测）——因为 folder 是虚拟节点，不落盘目录。
- **item 的 `url` 字段存 API 的 `website`（来源页），不是下载 URL**；只传 `url` 不传 `website` 时 `url:""`，源地址丢失（实测）。
- `smartFolders`：规则集合（属性 + 方法，见 §3.4）。
- `quickAccess`：`{type,id}[]`，侧边栏快捷入口，数组顺序即显示顺序。
- `tagsGroups`：`{id,name,tags[],color?,description?}`。

### 3.3 启动重建与增量

1. 无缓存：`loadImages()` 扫描 `images/*.info`（`background.js:2774-2908`），读每个 `metadata.json`。
2. 有缓存：读 userData 下 `library-caches/<fnv32a(rootDir)>.txt`（每行一个 item JSON），再 `loadRecentImages()` 补最近项（`:2308-2319, 2950`）。
3. 差异：`checkLibraryDiff()` 以 `mtime.json` 的 `lastModified` 为基准，只重读过期 item（`:3378-3477`）；`createMTimeLogs()` 重建 `mtime.json`（`:3028-3074`）。
4. 监听：`fs.watchFile(metadata.json, 4s)`、`fs.watchFile(mtime.json, 4s)`（`:1747,1814`）+ `nsfw` 监听 `images/`（`:1540-1736`）+ 目录比对（`:1836-1956`），自触发用 `importItemDateMap`（10s）/`lastModified`（500ms）抑制。
5. **没有独立搜索索引**；搜索/筛选在渲染器内存 `$scope.raw` 上做。
6. **运行时缺陷（供 Ant-col 引以为戒）**：`GET /api/item/list` 的 `orderBy` 参数**实际无效**（末尾又被 `sortData(items,"IMPORT")` 覆盖，`api-server.js:968`），默认最多 200 条；连续快速导入时列表会缺项（实测 disk=47 / list=31），需重载库才恢复。这正是“索引与真相脱节”的典型症状。

### 3.4 排列 / 排序体系（重点）

#### 3.4.1 视图与默认顺序

- 4 种布局：`JustifiedLayout`（默认）/ `GridLayout`（瀑布流）/ `SquareLayout`（方格）/ `ListLayout`（列表）（`app.bundle.js:33844+`）。
- 默认排序：全局 `orderBy = localStorage['eagle.list.orderBy.<rootDir>'] || 'IMPORT'`（`:21324,23027`）；`IMPORT` = 按 `modificationTime` **降序**（新加入在前）。
- 每个 folder / smartFolder 可覆盖 `orderBy + sortIncrease`；`sortIncrease=false` 时对结果 `reverse()`。

#### 3.4.2 12 个排序键（`sortData` `app.bundle.js:21747-21865`）

| 键 | 含义 | 实现 |
|---|---|---|
| `IMPORT`（默认） | 添加时间 | `modificationTime` 降序 |
| `MTIME` | 修改时间 | `mtime || modificationTime` 降序 |
| `BTIME` | 创建时间 | `btime || modificationTime` 降序 |
| `NAME` | 标题 | `Intl.Collator(...,{numeric:true,sensitivity:'base'})` 升序 |
| `EXT` | 扩展名 | collator |
| `FILESIZE` | 文件大小 | `parseInt(size)` 升序 |
| `RESOLUTION` | 尺寸 | `width*height` 升序 |
| `RATING` | 评分 | `parseInt(star)||0` 升序 |
| `DURATION` | 时长 | `parseInt(duration)||0` 升序 |
| `TAGS` | 标签 | 首个 tag collator |
| `MANUAL` | 手动（仅 folder） | `item.order[folderId]` 降序，缺失回退 `modificationTime` |
| `RANDOM` | 随机（仅 folder/smartFolder） | `clone.shuffle()` |

#### 3.4.3 手动排序与置顶

- 手动序存 `item.order[folderId]`（字符串化小数）；拖拽取相邻两项中点、再按选中数量等分（`:54047-54223`），重复值有重排逻辑；拖拽后自动把 `folder.orderBy` 设为 `"MANUAL"`（`:54220`）。
- 置顶 `item.pinned[folderId] = Date.now() - index`；渲染前先按 pinned 降序置顶（`RANDOM` 除外，`:27443-27463`）。

#### 3.4.4 folder 自身的位置

- **folder 的显示顺序 = `metadata.json` 中 `folders[]` / `children[]` 的数组顺序**，没有 `sortIndex/order` 字段。
- 拖动文件夹直接 `splice` 数组后 `saveFolder()`（`app/js/directives/folder-sortable.js:112-166`）。
- “按标题排序”是一次性重排数组（`app.bundle.js:41819-41834`），不是持久排序字段。
- `folder.orderBy/sortIncrease` 只控制**该 folder 内 item 的排序**，与 folder 自身位置无关。

#### 3.4.5 组织原语

- **多 folder**：`folders[]`；一个 item 可同时在多个文件夹。
- **folder 继承标签**：`folder.tags` 沿父链合成 `extendTags`，新 item 入库时并入 `item.tags`（`app.bundle.js:30822-30834`）。
- **smartFolder 规则**：`property`（name/folderName/url/annotation/tags/rating/folders/type/shape/color/duration/...）× `method`（equal/contain/regex/>/</between/on/before/after/union/...）（`plugin/model/smart-folder.js:199-213`、`app/js/rule-match.js`）。
- **quickAccess**：`{type,id}[]`，数组顺序即显示顺序。
- **trash**：软删 `isDeleted:true + deletedTime`，文件仍在 `images/<id>.info/`；清空垃圾桶才 `fse.remove(dir)`（`api-server.js:543-571`、`background.js:583-634`）。运行时实测：`isDeleted=true` 的 item 目录与原图仍在。

### 3.5 导出 / 打包 / 迁移

- 导出文件夹：`exportFolder()` 按 `item.folders.includes(folderId)` 复制原文件到目标目录，同名 `-NN` 去重（`background.js:4156-4292`）。
- `.eaglepack`：**zip(store，不压缩)**，含 `pack.json {folder, images}` + 各 `<oldId>.info/`；导入时全部换新 `guid`、重映射 folder id、按 `order[oldFolderId] ?? modificationTime` 恢复顺序（`:4436-4736, 4862-5120`）。
- 跨库“添加到资源库”：保留 item id、复制目录、改写 `folders/modificationTime`。

---

## 4. Ant-col 现状对照

> Ant-col 细节见 `docs/research/antcol-current-state.md`（本文只保留对照所需）。运行期 16 文件 4773 行。

### 4.1 采集与 payload

- 11 个采集入口（拖拽收藏页、Alt+S、右键图片/视频/链接/本页卡片、三档截图、popup 批量扫描）。
- 统一 payload：`{items:[{kind,url|dataUrl,linkUrl,title,alt,width,height,pageUrl,pageTitle,captureMode}], meta:{tags,note,collection}}`。
- 与 Eagle 相比：**没有 `star`、`folderIDs`（多选）、`behavior`、`version`、站点适配器字段**；链接保存为本地 HTML 卡片（Eagle 保存 `.url` + 截图）。

### 4.2 落盘路径

```js
// background/save.js:307-311
base    = makeBaseName({ date, site, name, template: settings.filenameTemplate })
folder  = KIND_FOLDER[item.kind] || KIND_FOLDER.file
month   = timestampParts(new Date()).month
prefix  = collection?.path ? `${collection.path}/` : ''
relPath = `${prefix}${folder}/${month}/${base}.${ext}`
```

- 路径 = `[项目/]类型/YYYY-MM/<模板>.<ext>`；默认项目不建目录；其他项目用 `sanitizeSegment(name,40)`。
- 文件名模板 5 变量 `{date}{time}{site}{name}{month}`，清洗后 ≤110 字符（`naming.js:78-92`）。
- ID = base36 时间 + 随机 5 位（`naming.js:94-96`）——**和 Eagle `guid()` 完全同构**，但 Ant-col 的 ID 不参与路径。
- 重名：`ensureUniqueName()` 追加 `-2/-3`（`fs-writer.js:33-42`）。
- 模式：`auto` 下权限失效会静默回退下载目录（`save.js:32-35`）。

### 4.3 索引与缩略图

- 主索引：`chrome.storage.local['index']`，≤8000 条、按 `savedAtMs` 排序、**每次保存整表读改写**（`store.js:76-99`）。
- 镜像：`_index.json` 只在文件夹模式写，且**整文件重写**（`fs-writer.js:86-105`）；只在重新选目录时导入（`service-worker.js:401-412`）。
- sidecar：同名 `.json`，24 字段（`save.js:121-147`），**只写不读**。
- 缩略图：仅保存时生成 360px JPEG 存 IndexedDB（`save.js:320-326`、`thumb-store.js`）；视频/链接无缩略图；缺失时回落远端 URL（`library.js:248-255`）。
- 状态机：`inbox/kept/archived`；无删除/回收站。

### 4.4 素材库页面

- 数据源 = 全量索引消息（`library.js:64`、`service-worker.js:277-328`），不读盘、不扫 sidecar。
- 排序仅 `newest/oldest/name/size`（`library.js:128-131`）。
- 搜索前缀 `tag:/#/project:/site:/kind:/is:`，每个前缀只保留最后一个值；`after:` 未实现（`library.js:90-101`）。
- 无虚拟滚动、无分页；批量仅移项目/加标签/kept/archived。

### 4.5 差距矩阵

| 维度 | Eagle | Ant-col | 差距等级 |
|---|---|---|---|
| 身份 | ID 目录，改名不改路径 | ID 只在 JSON，路径由模板决定 | **P0** |
| item 自包含 | `images/<ID>.info/`（文件+缩略图+metadata） | 文件 + 同名 json + IDB 缩略图（三处） | **P0** |
| 索引 | 目录扫描可重建 + mtime 增量 + userData 缓存 | 索引唯一真相，sidecar 不读 | **P0** |
| 缩略图 | 落盘 `_thumbnail.png`（WebP 320） | 仅 IDB 360px，可清 | **P0** |
| 组织 | folder 树 + 多归属 + smartFolder | 单层 projects + 单归属 | **P0** |
| 排序 | 12 键 + folder 覆盖 + 手动序 + 置顶 | 4 键，无持久化 | **P1** |
| 元数据 | star/palettes/duration/btime | 无 star/palettes/duration | **P1** |
| 删除 | 软删 + 回收站 + purge | 无删除 | **P1** |
| 回收站 | `isDeleted/deletedTime` | 无 | **P1** |
| 导出/迁移 | `.eaglepack` / 导出文件夹 / XMP | MD/CSV/索引 JSON | **P2** |
| 性能 | 增量 + 缓存 + 分页 API | 全量消息 + 每条重写索引 | **P1** |
| 采集上下文 | star/folderIDs/站点适配器 | 无 | **P2** |

---

## 5. 优化方案

### 5.0 设计原则（先定边界）

1. **保留 Ant-col 的差异优势**：纯本地、无客户端/端口、FSA 直写、人类可读路径、Inbox 工作流。
2. **只吸收 Eagle 的结构不变量**：稳定 ID、item 自包含、元数据即组织、索引可重建、缩略图落盘、排序持久化。
3. **不做破坏性迁移**：v2 数据可读；路径默认不变；`collection` 字段保留为兼容显示。
4. **一切写操作可恢复**：先写 sidecar 再写 journal；索引可丢；删除走软删。

### 5.1 P0-1：让库可重建（sidecar 为真相 + Journal）

**目标**：删掉 `chrome.storage` 索引后，打开库能自动从磁盘恢复全部素材。

**数据层**

| 文件 | 作用 | 写入时机 |
|---|---|---|
| `<root>/_library.json` | 库级快照：`schema/version/seq/folders/smartFolders/quickAccess/tagsGroups/settings` | 打开库、结构变更、压缩时 |
| `<root>/_journal.ndjson` | 追加日志：`{"op":"put","id","ts","record"}` / `{"op":"del","id","ts"}` | 每次保存/更新/删除（O(1)） |
| `<root>/_index.json` | 人类可读/可导出的物化快照（保留兼容） | 空闲时 debounce 重写（≥5s） |
| `<root>/<类型>/<年月>/<base>.json` | 单条 sidecar v3（**真相**） | 与文件同一次保存 |

**sidecar v3 字段**（在 v2 24 字段基础上补齐）：

```jsonc
{
  "schema": "ant-col/v3",
  "id": "MVERBOKECCVUY",
  "kind": "image",
  "name": "...", "ext": "jpg", "mime": "image/jpeg",
  "size": 123456, "width": 1600, "height": 1000, "duration": 0,
  "sha256": "…",
  "sourceUrl": "…", "pageUrl": "…", "pageTitle": "…", "site": "…",
  "captureMode": "visible", "linkUrl": "…",
  "folders": ["fld_xxx"],            // 多归属
  "collection": "日常审美",           // 兼容：folders[0] 的显示名
  "tags": [], "annotation": "", "star": 0,
  "palettes": [{"color":[r,g,b],"ratio":12.3}],
  "status": "inbox", "reviewedAt": null,
  "savedAt": "…", "savedAtMs": 1792400000000, "lastModified": 1792400000000,
  "relativePath": "图片/2026-10/….jpg",
  "mode": "folder", "downloadId": null,
  "order": { "fld_xxx": "0.5" },      // 手动序（按 folder）
  "pinned": { "fld_xxx": 1792400000000 },
  "thumb": "_thumbs/ab/MVERBOKECCVUY.webp",
  "missing": false
}
```

**重建算法**（新文件 `background/index-store.js`）

```text
ensureIndex():
  1. 读 _library.json → 库结构；缺失则默认空库
  2. 读 _index.json 快照（若 schema=v3）+ replay _journal.ndjson → Map<id, record>
  3. 若快照缺失/版本不符/seq 断裂 → 全量扫描：
       scanSidecars(root) 遍历 **/*.json（跳过 _ 开头与 backup/）
       识别 schema.startsWith('ant-col/')
       校验 relativePath 文件存在 + size 匹配；不匹配标 missing:true
  4. 增量对账（打开库时）：
       对比 sidecar.lastModified 与 mtime 索引；只重读变化的 sidecar
  5. 写回快照 + 清空 journal（原子替换）
```

**代码落点**

| 现有位置 | 改动 |
|---|---|
| `background/save.js:314-318`（writeRecord → appendIndex） | `writeRecord` 后 → `writeSidecar`（已有）→ `appendJournal(record)`；`_index.json` 改为 debounce 物化 |
| `background/store.js:81-99`（appendIndex 整表重写） | 拆为 `appendJournal` / `upsertHotCache` / `getIndexPage`；`chrome.storage` 只存热缓存与设置 |
| `background/fs-writer.js` | 新增 `writeAtomic`、`scanSidecars`、`readJson`、`moveEntry` |
| `background/service-worker.js:401-412`（root-changed 导入镜像） | 改为 `ensureIndex()`；新增 `rebuild-index` 消息 |
| `library/library.js:61-88`（全量 library-state） | 分页 `library-page {cursor, limit}`；首屏先渲染快照 |
| `background/config.js:2` | `SCHEMA = 'ant-col/v3'`，新增 `LIBRARY_SCHEMA` |

**验收**

- 清空 `chrome.storage.local`（保留 rootHandle）→ 重开库 → 素材数/字段/缩略图全部恢复；
- 手动改一个 sidecar 的 `tags` → 重开库反映新值；
- 手动删原图 → 库内该条 `missing:true` 并提示修复，不静默消失；
- 1000 条素材保存，索引写入次数为 O(n) 的 journal append，不再整表重写。

**风险**：journal 体积 → 压缩策略（打开库、每 200 条、空闲 10s）；并发保存 → 单写队列 + 幂等 id；迁移 → v2 sidecar 读取时补默认值。

### 5.2 P0-2：缩略图落盘 + 视频首帧

**目标**：缩略图成为库的一部分，换浏览器/清 IDB 不丢。

**设计**

- 路径：`<root>/_thumbs/<id 后 2 位>/<id>.webp`（分散目录，避免单目录上万文件）。
- 规格：短边 320（横图高 320、竖图宽 320，与 Eagle 一致；设置项可改 480），`image/webp` q0.75；保留原图宽高做占位。
- 生成：`createImageBitmap` + `OffscreenCanvas` + `convertToBlob`；在保存后异步队列生成（3 并发）。
- 视频：`<video preload="metadata">` → seek 到 `min(1s, duration*0.1)` → drawImage → webp。
- 链接：保存时若有页面截图 base64 用它；否则不生成（卡片 HTML 内已有视觉）。
- 读取：库页面向 service worker 请求 `thumb-bytes {id}`，页面 `new Blob` + `URL.createObjectURL`（MV3 service worker 不能 `createObjectURL`，必须由页面创建）。
- 缓存：IndexedDB 仅作为渲染 LRU（可选），**不再是唯一来源**。
- 重建：`rebuild-thumbs` 消息按缺失列表批量生成；库页面占位图 + 懒加载。
- 迁移：首次打开 v2 库时，把 IDB 中已有 thumbs 批量写入 `_thumbs`，避免重新解码原图。

**代码落点**：`background/thumb-store.js`（增加落盘实现，保留 IDB 作为 cache）、`background/save.js:320-326`（改为先落盘再缓存）、`library/library.js:227-257`（`fillThumb` 改走 SW 读文件）、`service-worker.js` 新增消息。

**验收**：清 IDB → 库页面缩略图仍全部显示；断网时仍显示；视频出现首帧封面；`_thumbs` 可被外部备份。

### 5.3 P0-3：组织模型 v3（folder 树 + 多归属 + 智能集合）

**目标**：从“单层项目”升级为可扩展的多层组织，同时不移动物理文件。

**库结构（`_library.json`）**

```json
{
  "schema": "ant-col-library/v1",
  "version": 3,
  "seq": 1203,
  "folders": [
    {"id":"fld_a","name":"日常审美","parentId":null,"orderBy":"IMPORT","sortIncrease":true,
     "tags":["审美"],"icon":"","createdAt":0,"updatedAt":0}
  ],
  "smartFolders": [
    {"id":"sf_1","name":"待整理的大图","rules":[{"property":"width","method":">=","value":2000}],
     "orderBy":"IMPORT","sortIncrease":true}
  ],
  "quickAccess": [{"type":"folder","id":"fld_a"}],
  "tagsGroups": [{"id":"tg_1","name":"主题","tags":["海报","封面"]}]
}
```

- **folder 位置**：同 Eagle，数组顺序即位置；拖拽 = 重排数组 + 改 `parentId`。
- **item 归属**：`folders: [folderId]`；`collection` 字段保留为 `folders[0]` 的显示名（兼容 UI 与导出）。
- **路径策略**：默认继续 `类型/YYYY-MM/`（`layoutMode:'type-month'`）；新增可选 `layoutMode:'folder-type-month'` 仅供“导出镜像”，保存时不按项目搬目录。
- **智能集合**：复用 Eagle 的 property/method 子集（`name/tags/folders/type/size/width/height/star/url/annotation/savedAt` × `contain/equal/regex/>=/<=/between/on/before/after/union`），实现于 `library/search.js`，与 folder 一样可排序。
- **迁移**：`settings.collections[]` → 顶层 folders（稳定 id 用 `fld_` + 名称 slug + 哈希后缀）；旧记录的 `collectionPath` → 映射到 folder id；旧 `collection` 名保留显示。

**代码落点**：`background/config.js`（默认库结构）、新增 `background/library-model.js`（folder CRUD/树/规则）、`service-worker.js`（`folders/update` 消息）、`library/library.js`（侧边栏树、批量移入多 folder）、`save.js:38-48`（不再用 collection 决定路径，改写入 `folders`）。

**验收**：同一素材可同时在 2 个 folder；folder 嵌套 3 层可拖拽；改归属不产生任何文件移动；旧库打开自动迁移且 UI 不变。

### 5.4 P1-1：排列与排序

- **排序键**：对齐 Eagle 的 12 键（IMPORT/MTIME/BTIME/NAME/EXT/FILESIZE/RESOLUTION/RATING/DURATION/TAGS/RANDOM/MANUAL），在 `library/sort.js` 实现 `Intl.Collator` 与数值比较。
- **持久化**：全局排序 `localStorage['ant-col.list.orderBy.<rootId>']`；folder/smartFolder 的 `orderBy/sortIncrease` 写 `_library.json`。
- **手动序**：`item.order[folderId]` 用浮点中点（存字符串）；拖拽后把 folder 置 `MANUAL`；碰撞时按 1e-6 重排。
- **置顶**：`item.pinned[folderId]`，置顶优先（RANDOM 除外）。
- **视图**：`grid / justified / waterfall / list` 四选一；统一虚拟滚动（窗口化渲染）。
- **排序执行位置**：Web Worker（大库不阻塞 UI）；主线程只接收已排序的可见窗口。

**验收**：5000 条库切换排序 <100ms（worker + 虚拟列表）；手动序刷新后保持；置顶跨刷新保持。

### 5.5 P1-2：元数据增强

| 字段 | 生成方式 | 用途 |
|---|---|---|
| `star` 0-5 | 采集面板/详情/批量 | `star:>=4` 筛选、排序 |
| `palettes` 5 色 + ratio | 缩略图 64×64 下采样 + k-means/中位切分 | 色板展示、`color:#ff0000` 相似检索 |
| `duration` | 视频 `loadedmetadata` | DURATION 排序、时长筛选 |
| `btime/mtime/lastModified` | 文件 stat / 写入时间 | BTIME/MTIME 排序、增量对账 |
| `captureMode` | 已有 | 筛选 |
| `linkUrl` | 链接类补写 sidecar（当前缺失） | 链接卡片重开 |

**验收**：颜色相似检索 Top20 命中主色；评分筛选与排序一致；sidecar 字段完整率 100%。

### 5.6 P1-3：写入与查询性能

| 问题（现状） | 方案 |
|---|---|
| 每条保存整表读写索引（`store.js:81-99`） | journal append（O(1)）+ 空闲物化 |
| `_index.json` 每条整文件重写（`fs-writer.js:86-105`） | debounce 物化（≥5s，或每 50 条） |
| 库页面全量消息 + 全量渲染（`library.js:64`） | 分页 `library-page` + 虚拟滚动 + 增量 `index-changed` 事件 |
| 徽标每次全扫索引（`service-worker.js:229-236`） | 维护 `counters` 汇总（inbox/kept/archived/total） |
| 去重 check-then-act 竞争（`save.js:344-349`） | 单写队列 + 保存前 `reserveHash(sha, collection)` 幂等表 |
| 下载模式元数据不回写（`service-worker.js:360`） | 下载完成回调写 sidecar + journal |

**验收**：批量 200 张，保存总耗时线性、无 O(n²)；库首屏 <300ms（分页 60 条）。

### 5.7 P1-4：删除 / 回收站 / 撤销

- 软删：`isDeleted:true + deletedTime`，文件与缩略图保留。
- trash 视图：按 `-deletedTime` 排序；可恢复。
- 彻底删除：purge 删除原文件 + `_thumbs/<id>.webp` + sidecar，并写 `{"op":"del"}` journal。
- 撤销：删除后 5s toast「撤销」，期间只写 journal 的 `del` 事件，到期才 purge。

**验收**：删除→回收站→恢复→文件仍在；清空回收站后目录/缩略图/sidecar 全部消失；5s 内撤销成功。

### 5.8 P2：迁移与互操作

1. **导入 Eagle `.library`**：读 `metadata.json`（folder 树/smartFolders/quickAccess/tagsGroups）→ 建 ant-col 库结构；遍历 `images/*.info/metadata.json` → 复制原文件到 ant-col 路径模板、写 v3 sidecar（保留 tags/star/palettes/order/pinned/url/annotation/btime/mtime）；folder 映射保留层级。
2. **导出 `.eaglepack`**：zip(store) 含 `pack.json` + `<id>.info/{metadata.json,文件,缩略图}`，便于回迁 Eagle 或归档。
3. **XMP 可选**：sidecar 之外写 `.xmp`（标题/标签/评分/来源），供其他软件读取。
4. **本地 API 不采用**：保持纯扩展；如需脚本化，用 `chrome.runtime.sendMessage` 的 external 通道（可选开关）。

**验收**：100 条 Eagle 库导入后 folder 树/标签/评分/顺序一致；导出包可在 Eagle 打开（或用 zip 工具可读）。

### 5.9 明确不建议照搬

| Eagle 做法 | 为什么不搬 |
|---|---|
| 常驻 41593/41595 本地服务 | Ant-col 的核心优势是“无客户端/无端口”；FSA 已能直写 |
| bytenode `.jsc` 主进程 | 维护成本/可移植性差；Ant-col 无主进程 |
| AngularJS + 全量内存排序 | 大库会卡；用 worker + 虚拟列表 + 分页 |
| 单文件全量 `metadata.json` | 大库写入放大；用快照 + journal + 分片 |
| 缩略图只存 IDB | 正是本次要修的反模式；Eagle 落盘是对的 |
| 缩略图 `.png` 里装 WebP | 误导工具与备份；Ant-col 直接用 `.webp` 扩展名 |
| guid 无碰撞重试 | Ant-col 应在 `makeId()` 增加 EEXIST 重试 |

---

## 6. 实施路线图

| 阶段 | 内容 | 预估 | 验收门槛 |
|---|---|---|---|
| **S1（P0）** | sidecar v3 + journal + `ensureIndex/rebuild` + 缩略图落盘 + 库页面读盘 | 5–7 天 | 删索引可恢复；清 IDB 缩略图仍在 |
| **S2（P0）** | folder 树 + 多归属 + 智能集合 + 迁移 | 4–6 天 | 多归属/嵌套/旧库迁移通过 |
| **S3（P1）** | 12 排序键 + 手动序/置顶 + 4 视图 + 虚拟滚动 | 4–5 天 | 5000 条排序/滚动流畅 |
| **S4（P1）** | star/palettes/duration + 搜索语法 + 回收站/撤销 | 3–5 天 | 颜色/评分检索；删除可撤销 |
| **S5（P2）** | Eagle 导入 + eaglepack 导出 + XMP | 3–5 天 | 往返一致 |

**每阶段共同 DoD**：`node test/e2e.js` 全绿；新增迁移测试（v2→v3）；`_index.json` 可读；无新增全局状态。

---

## 7. 未确认项与边界

| # | 未知 | 影响 | 建议 |
|---|---|---|---|
| 1 | Eagle `run.jsc/main.jsc` 不可反编译；41593 表单→IPC 的精确映射、`net` 下载细节 | 协议细节只能推断 | 已用运行时 41593 实测补齐行为；如需精确字段可抓包 |
| 2 | `_thumbnail.png` 内容为 WebP 属代码推断 | 已用运行时字节验证（`RIFF....WEBP`） | 结论成立 |
| 3 | 手动排序/置顶的 UI 操作未在运行时完整复现（`order/pinned` 字段已由静态代码确认） | 不影响方案 | 如需 UI 级证据，可在 Eagle 里拖拽一次后读 metadata |
| 4 | Eagle 41595 API 的鉴权/跨域细节 | Ant-col 不依赖 | 不迁移 |
| 5 | Ant-col 现有 E2E 未覆盖文件夹树/排序（新功能） | 需补测试 | S2/S3 同步补 e2e |
| 6 | 本次探针未能切回原库：`D:\Eagle\文章.library` 位于安装目录 `D:\Eagle` 内，被 Eagle 硬拒（日志 `It is forbidden to put metadata.json in the installation directory: D:\Eagle`） | 原库未被修改；Eagle 当前加载 `D:\eagle-probe\probe.library` | 若要在本机正常用 Eagle，应把库迁到安装目录之外（如 `D:\EagleLibraries\`） |
| 7 | 41595 只在库成功加载后监听；可用 `Eagle.exe --library-path=<path>` 直接开库；本环境需先清除 `ELECTRON_RUN_AS_NODE=1` | 影响自动化/复现 | 已记录在运行时报告 §1 |
| 8 | 手动序/置顶的 UI 落盘未实测（`order[folderId]`/`pinned[folderId]` 仅有静态源码线索） | 不影响方案（字段语义已由 `app.bundle.js` 确认） | 可在 Eagle 里拖一次后读 metadata 补证 |

---

## 8. 证据索引

### 8.1 REA 证据

| 目标 | 操作 | 证据 ID / 摘要 |
|---|---|---|
| Eagle 扩展 3.1.26 | `analyze_javascript_application`（directory，summary） | `ev_4c3accfe07412cfe494526cd811c8b268008650f69e37f3157f39b01bff27b9c`；102 JS、241 findings、覆盖 partial |
| Eagle app.asar | `analyze_javascript_application`（asar，summary，选中 3 模块） | `ev_9fb963e4fb9b7270d22ad0cc421ac4698a78842c53a333a8496ea0ba182662b8`；artifact sha256 `a33a48f2…173a2` |
| app.asar IPC 视图 | `inspect_analysis_view`（javascript-facts） | `ev_921a12ff3f0adee832529a1027523eb181c0bd6eddbaca12c14affcbac3b1e34`；119 literal IPC channels |

> REA 覆盖声明：扩展为 partial（46598 semantic unknowns）；app.asar 仅分析 3/7050 文件，其余通过解包只读精读补齐；两者均未执行目标代码。

### 8.2 详细报告

- `docs/research/eagle-static-analysis.md`（746 行 / 50KB）：保存管线、库模型、排序、导出、trash、未知边界，逐条 `文件:行号`。
- `docs/research/antcol-current-state.md`（730 行 / 62KB）：Ant-col 现状基线、326 处引用、59 条技术债、16 项差距。
- `docs/research/eagle-runtime-probe.md`（14 节）：本地 API 与磁盘实测（保存路径/命名/缩略图/folder/trash/41593/Referer/库切换），原始证据在 `D:\eagle-probe\evidence\`，可复现脚本在 `D:\eagle-probe\*.mjs`。

### 8.3 运行时证据（本机 probe 库）

```text
D:\eagle-probe\probe.library\
├── metadata.json        # 8 个 folder（含 /、emoji、首尾空格、重复名），无 orderBy 默认
├── mtime.json           # {<id>: lastModified, …, "all": 47}
├── tags.json            # {"historyTags":["tagA","tagB","probe","url"],"starredTags":[]}
├── saved-filters.json   # []
├── backup/backup-2026-10-19 19.01.04.724.json
└── images/<ID>.info/    # 47 个 item；含多归属（folders=[2]）、star=4、软删（isDeleted=true 且文件仍在）、.url 书签
```

> 原始库 `D:\Eagle\文章.library` 未被修改；因位于安装目录内被 Eagle 拒绝加载，探针结束后 Eagle 仍停在 `probe.library`（见 §7-6）。

### 8.4 Ant-col 关键引用

- 落盘：`background/save.js:307-318`、`background/fs-writer.js:33-115`
- 命名：`background/naming.js:5-96`
- 索引：`background/store.js:76-99`
- 缩略图：`background/save.js:320-326`、`background/thumb-store.js:21-31`
- 库页面：`library/library.js:61-131,227-257`
- 设置/默认：`background/config.js:4-42`
