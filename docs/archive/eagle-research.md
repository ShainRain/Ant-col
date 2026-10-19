# Eagle 核心实现路径 · 逆向记录（历史归档）

> 本文件是早期研究记录，**不参与拾图运行，也不代表当前产品依赖 Eagle**。当前产品已独立为本地视觉收件箱，相关运行时接口与字段已移除。

> 目标：搞清楚 Eagle 从「网页上一张图」到「本地 library 里一条素材」的完整链路，再把其中可复用的设计抽出来，落到一个纯本地的个人 Chrome/Edge 扩展里。
>
> 分析对象是本机已安装的 Eagle 4.0.0（build 20260304），以及 Edge 中已安装的 Eagle 浏览器扩展 3.1.26。所有结论都来自本机 shipped artifact；没有修改 Eagle 的任何文件。

---

## 0. 结论先行

Eagle 的核心不是「图片下载器」，而是**一个本地素材入库管线**：

```
网页元素
  → 扩展 content script 提取 src / 尺寸 / 来源页 / 标签
  → POST http://localhost:41593（表单）
  → Electron 主进程/后台窗口接管，带 Referer 下载
  → 写入 <library>/images/<ID>.info/
       ├── 原始文件
       ├── <name>_thumbnail.png
       ├── metadata.json（tags / folders / url / annotation / palettes ...）
       └── 可选 .xmp
  → 更新 mtime.json / 全局 metadata.json / tags.json
```

另一个端口 **41595** 是对外/对扩展的 JSON API，负责查询库信息、文件夹、标签，以及 `addFromURL` / `addFromPath` 等入库入口。

这套设计的三个关键点：

1. **上下文和文件一起保存**（来源页、标签、备注、尺寸、时间、色板）；
2. **本地 HTTP 作为扩展与客户端之间的桥**（无需原生消息宿主）；
3. **一条素材一个 `.info` 目录**，元数据与文件同生命周期，便于备份/迁移/去重。

---

## 1. 目标清单

| 目标 | 路径 / 版本 | 用途 |
| --- | --- | --- |
| Eagle 主程序 | `C:\Program Files\Eagle\Eagle.exe` | Electron 主进程 |
| Eagle 应用包 | `C:\Program Files\Eagle\resources\app.asar`（110,169,946 bytes） | 主进程 + 渲染器代码 |
| 应用清单 | `resources/package.json` | `version: 4.0.0`、`buildVersion: 20260304`、`main: run.js`、Electron `^22.3.7` |
| 运行版本 | `C:\Program Files\Eagle\version` | `22.3.7`（Electron） |
| 浏览器扩展 | `%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Extensions\cfgchmkedjfehclfhhmgedljhcibojcm\3.1.26_0\` | Eagle 的 MV3 扩展 |
| 本地库样例 | `C:\Users\ShainRain\Pictures\红与黑.library\` | 真实 library 结构 |
| 运行日志 | `%APPDATA%\Eagle\log.log` | 端口、扩展版本、保存行为 |

> 说明：REA 的 `analyze_javascript_application` 对 110MB ASAR 的首次调用在客户端超时（分析体量过大）。随后改用自写的 ASAR 目录解析器，把需要的模块按路径取出后做静态阅读；这属于同一种「读取 shipped artifact」的证据，不依赖源码仓库。

---

## 2. 进程与端口架构

Eagle 是典型 Electron 多窗口应用：

- **主进程**：`run.jsc`（V8 bytecode，由 bytenode 编译；`resources/app.asar.unpacked/run.jsc`）。
- **库窗口渲染器**：`app/background.html` + `app/app.bundle.js`（AngularJS 应用）。
- **collect window**：`app/collect-window/index.html`，由扩展在网页内以 iframe 形式打开，用于选文件夹/标签/备注。
- **扩展服务**：本机 HTTP，端口 **41593**。
- **JSON API**：本机 HTTP，端口 **41595**。

日志可以直接看到扩展服务的启动：

```
[main] init server
[main] Local server success to start and port is 41593
[app] Local server: enabled
```

主进程字符串中也能看到 `EXTENSION_PORT`、`extension-server-init-failed`、`Access-Control-Allow-Origin`、`Content-Type` 等，说明 41593 是一个带 CORS 的本地表单接收端。

### 端口分工

| 端口 | 归属 | 协议 | 用途 |
| --- | --- | --- | --- |
| 41593 | 主进程扩展服务 | `application/x-www-form-urlencoded` POST | 浏览器扩展把「网页素材」送进来 |
| 41595 | 库窗口内 API server | JSON（GET/POST） | 查询库/文件夹/标签、`addFromURL`/`addFromPath`、列表 |
| 41592 | 资源服务（历史/可选） | HTTP | 缩略图路径（代码中保留注释） |
| 38766 | 预览资源服务 | HTTP | `API_SERVER_URL`，预览/静态资源 |

---

## 3. 浏览器扩展的抓取链路

扩展 manifest（MV3）关键项：

```json
"background": { "service_worker": "js/background-v3.js" },
"content_scripts": [{
  "matches": ["http://*/*", "https://*/*", "file:///*/*"],
  "js": ["js/lib/api/eagle.js", "...", "js/lib/api/element-inspector.js",
         "js/lib/drag-saver.js", "js/lib/context-saver.js", "...", "js/content.js"],
  "run_at": "document_end"
}],
"permissions": ["activeTab", "contextMenus", "storage", "tabs", "scripting", "webNavigation"]
```

### 3.1 content script

`js/content.js` 初始化三类保存器：

- `DragSaver`：拖拽图片/链接/视频到「Add to Eagle」浮层；
- `ContextSaver`：Alt + 右键 / 右键菜单触发；
- `CollectWindow`：需要选文件夹/标签时，在页面中打开 Eagle 的 collect iframe。

元素元数据来自 `eagle.elementInspector.getMeta(element, { parseBase64: true })`，再与 `eagle.siteParser.getMeta()`（站点适配器，如小红书/Pinterest）合并：

```js
let o = { ...siteMeta, ...elementMeta, behavior: "drag", type: "image" };
```

### 3.2 组装 payload

`js/lib/api/item.js` 的 `addFile()`：

```js
const o = {
  method: "POST",
  "Content-Type": "application/x-www-form-urlencoded",
  body: { version: manifest.version, ...item, type: "image" }
};
return eagle.fetch("http://localhost:41593", o);
```

表单编码由 `js/lib/api/fetch.js` 完成：数组会展开为 `field[0]=...`，然后 `new URLSearchParams(body)`。

字段（来自 `item.js` 与 `content.js`）：

| 字段 | 含义 |
| --- | --- |
| `version` | 扩展版本（Eagle 用来兼容旧版） |
| `type` | `image` / `screen capture` / `save-url` / `import-images` |
| `src` | 图片/视频/页面 URL |
| `title` | 条目名 |
| `url` | 来源页 URL |
| `tags` | 标签（数组） |
| `folderID` / `folderIDs` | 目标文件夹 |
| `annotation` | 备注 |
| `star` | 星级 |
| `behavior` | `drag` / `context` |
| `forceOpenCollectModal` / `forceHideCollectModal` | 是否强制弹 collect 窗口 |
| `base64` | 截图/链接卡片的预览图 |
| `images` | 批量导入时的 JSON 字符串 |

截图走同一个入口：

```js
body: { type: "screen capture", version, title, url: location.href, base64 }
```

链接卡片：

```js
body: { type: "save-url", version, title, ...link, base64: 截图 }
```

### 3.3 客户端接收

主进程把 41593 的请求通过 IPC 分发到库窗口的 `background.js`：

- `screencapture-from-extension` → `uploadBse64Image`
- `url-from-extension` → 生成 `.url` InternetShortcut + `addToProcessQueue`
- `upload-from-extension` → `uploadUrl(params)`，下载并生成缩略图

`background.js` 的缩略图命名：

```js
`${library.imagesDir}${image.id}.info/${image.name}_thumbnail.png`
```

日志中可以看到真实保存行为，包括来源页和 Referer：

```
[main] [extension][Edge|146.0.0.0] version: 3.1.22 - Save image:
[drag][link][https://file.nbfox.com/...jpg],
source: https://www.nbfox.com/portrait-of-erwin-dominilk-osen-mime-van-osen/
[bg] >> download with electron net [https://file.nbfox.com/...jpg],
referer: https://www.nbfox.com/portrait-of-erwin-dominilk-osen-mime-van-osen/
```

这说明 Eagle 用 Electron 的网络栈下载，并把来源页作为 Referer —— 这是很多图片站防盗链能成功的关键，也是我们扩展里 `useReferrer` 选项的原型。

---

## 4. 本地 JSON API（41595）

`app/js/api-server.js`：

```js
const API_PORT = 41595;
APIServer = new JsonRestServer({ port: API_PORT });
```

注册的路由（节选，行号对应 `api-server.js`）：

| 行 | 路由 | 方法 | 作用 |
| --- | --- | --- | --- |
| 981 | `/api/application/info` | GET | 版本、平台、preferences |
| 983 | `/api/library/info` | GET | 库 metadata + 库路径/名称 |
| 984 | `/api/library/history` | GET | 最近库路径 |
| 985 | `/api/library/switch` | POST | 切换库 |
| 988–993 | `/api/folder/create|rename|update|list|unlock|listRecent` | POST/GET | 文件夹 |
| 995–998 | `/api/tag/all|list|listRecent|groups` | GET | 标签 |
| 1005 | `/api/item/addFromPath` | POST | 从本地路径入库 |
| 1006 | `/api/item/addFromPaths` | POST | 多路径 |
| 1007 | `/api/item/addFromURL` | POST | 从 URL 入库（扩展/Eagle 联动常用） |
| 1008 | `/api/item/addFromURLs` | POST | 多 URL |
| 1009 | `/api/item/batchSave` | POST | 打开批量保存面板 |
| 1010 | `/api/item/addBookmark` | POST | 链接书签 |
| 1011 | `/api/item/update` | POST | 更新 tags/url/annotation/star |
| 1013 | `/api/item/info` | GET | 单条详情 |
| 1015 | `/api/item/thumbnail` | GET | 缩略图路径 |
| 1016 | `/api/item/list` | GET | 条件查询/分页 |
| 1017–1018 | `/api/item/refreshPalette|refreshThumbnail` | POST | 重算 |

`addFromURL` 的核心（`api-server.js:635-681`）会把 `url/name/website/annotation/tags/folderId/modificationTime/headers` 交给渲染器的 `uploadUrls`；`addFromPath`（449-488）则走 `uploadFiles`。这两个入口与扩展的 41593 最终都汇合到同一套上传队列。

API 还暴露了 `/api/script/inject`（`runAPIScript`，`api-server.js:207-216`）和重定向路由 `/item?id=`、`/folder?id=`、`/smart-folder?id=`（1021-1061），后者 302 到 `eagle://item/<id>`。

---

## 5. Library 数据模型

真实库样例（`红与黑.library`）：

```
红与黑.library/
├── metadata.json          # 文件夹树 / smartFolders / quickAccess / tagsGroups
├── tags.json              # {"historyTags":[],"starredTags":[]}
├── mtime.json             # {"<itemId>": <lastModifiedMs>, ...}
├── saved-filters.json
├── actions.json
├── backup/                # 元数据备份
└── images/
    └── <ITEM_ID>.info/
        ├── <name>.<ext>
        ├── <name>_thumbnail.png
        ├── metadata.json
        └── <name>.xmp     # 可选
```

单条 `metadata.json`（样例 `MMJ9MZVGHML10`）：

```json
{
  "id": "MMJ9MZVGHML10",
  "name": "1",
  "size": 462737,
  "btime": 1773065868322,
  "mtime": 1773065868843,
  "ext": "png",
  "tags": [],
  "folders": [],
  "isDeleted": false,
  "url": "",
  "annotation": "",
  "modificationTime": 1773065868843,
  "height": 1660,
  "width": 1242,
  "palettes": [
    { "color": [9, 4, 4], "ratio": 56 },
    { "color": [249, 5, 28], "ratio": 26 }
  ],
  "lastModified": 1773065881401
}
```

要点：

- ID 由 `guid()` 生成（`background.js:6340`）：
  ```js
  (Date.now().toString(36) + Math.random().toString(36).substr(2, 5)).toUpperCase()
  ```
  典型 13 位大写 base36。
- 原图与缩略图同目录，缩略图固定 `_thumbnail.png` 后缀。
- `palettes` 是 Eagle 自己算的主色/占比；非必需，但 Eagle UI 会用到。
- 全局 `mtime.json` 维护 `id -> lastModified`，用于增量扫描/同步。
- 文件夹树在全局 `metadata.json` 的 `folders`，每项含 `id/name/description/children/modificationTime/tags/password/passwordTip/icon/iconColor/pinyin` 等。

---

## 6. 从 Eagle 到拾图：设计映射

| Eagle 的做法 | 拾图的选择 | 原因 |
| --- | --- | --- |
| 扩展 POST 41593 | 扩展内部直接 fetch + 写盘 | 个人使用，不需要常驻本地服务 |
| Electron 下载（带 Referer） | `fetch` + `referrer` / `useReferrer` | 保留防盗链兼容，减少依赖 |
| `images/<ID>.info/` | `图片/YYYY-MM/<timestamp>_<site>_<name>.<ext>` | 在资源管理器里更直观；同时保留 Eagle 风格 JSON |
| 缩略图 | 可选（当前不落盘） | 减少写入，先用原图/远程预览；后续可加 |
| `metadata.json` 同目录 | 同名 `.json` sidecar | 文件与元数据同生命周期，便于迁移 |
| 全局 `mtime.json` | `_index.json` + `chrome.storage.local` 索引 | 纯前端可维护；文件夹模式有镜像 |
| 41595 API | 可选 Eagle 联动 | 想入库 Eagle 时仍然可用 |
| collect window（iframe） | Popup + 右键/快捷键 | 更轻，不打断页面 |
| 拖拽到浮层 | 悬停 Alt+S + 右键 | 更少操作 |

### 为什么不用 Native Messaging

- 原生消息宿主需要安装/注册可执行文件或脚本，对「完全个人使用」来说维护成本高于收益；
- File System Access API 允许用户在扩展页面里选一次文件夹，之后 service worker 直接读写；
- 实测（Edge 155）：目录句柄可以存入 IndexedDB，被 MV3 service worker 取回并 `createWritable()` 写入。扩展的 E2E 用 OPFS 句柄验证了同一条写盘路径。

### 为什么保留 sidecar JSON

- 文件管理器里可读；
- 迁移到 Eagle 时，`eagle` 子对象几乎可以直接变成 item metadata；
- 去重依赖 `sha256`，不依赖文件名；
- 索引丢失也能从每个 `.json` 恢复。

---

## 7. 证据索引

| # | 结论 | 证据 |
| --- | --- | --- |
| 1 | Eagle 4.0.0 / Electron 22.3.7 | `resources/package.json`、`version` |
| 2 | 主进程是 bytenode `.jsc` | `resources/app.asar.unpacked/run.jsc`、`app/js/core.jsc` |
| 3 | 扩展服务 41593 | `%APPDATA%\Eagle\log.log`（"Local server success ... 41593"）；`run.jsc` 字符串 `EXTENSION_PORT` |
| 4 | JSON API 41595 | `app/js/api-server.js:4`、`app/js/api-server.js:977-1018` |
| 5 | 扩展 POST 表单到 41593 | `js/lib/api/item.js`（`addFile` / `addScreenshot` / `addURL`） |
| 6 | 扩展探测 41595 / 41593 | `js/lib/api/env.js`（`#fetchNewAPI` / `#fetchOldAPI`） |
| 7 | 扩展 version 3.1.26 / MV3 | 扩展 `manifest.json:7,115,119` |
| 8 | 客户端 IPC 入口 | `app/js/background.js:731`（screencapture）、`:772`（upload）、`:812`（url） |
| 9 | 缩略图命名 | `app/js/background.js:963` 等 |
| 10 | ID 生成 | `app/js/background.js:6340` |
| 11 | Library 结构 | `红与黑.library/metadata.json`、`images/<ID>.info/metadata.json` 样例 |
| 12 | 下载带 Referer | `log.log` 中 `[bg] >> download with electron net ..., referer: ...` |
| 13 | 收藏窗口 iframe | `app/collect-window/index.html`、`app/collect-window/js/lib/collect-window.js` |
| 14 | API 路由全集 | `app/js/api-server.js:977-1033` |

---

## 8. 未解决 / 边界

- **主进程 `.jsc` 未反编译**：`run.jsc` 是 V8 bytecode，本次只做了字符串与日志级证据；41593 的精确请求体解析、错误码、CORS 细节没有逐行确认。表单字段来自扩展侧与渲染器侧代码，已足够支撑复刻。
- **41593 的响应格式**没有在运行时抓包；扩展侧只关心成功/失败，拾图不需要兼容它。
- **Eagle API 的 CORS/鉴权**没有实际启动 Eagle 验证。`run.jsc` 字符串包含 `Access-Control-Allow-Origin`，且扩展从 `chrome-extension://` 直接请求 41595，说明服务端允许扩展来源；拾图的 Eagle 联动按同一假设实现，并在设置页提供「测试连接」。
- **collect window 的完整交互**（标签建议、文件夹密码、最近文件夹）只读了 UI 与控制器，未做运行时回归；拾图不复刻该 iframe，改用 popup。
- **Eagle 的缩略图算法/色板算法**未逆向；拾图当前不生成缩略图/色板。
- 本报告没有修改 Eagle 安装目录、库文件或注册表。

---

## 9. 一句话总结

Eagle 把「浏览器里的视觉上下文」通过一个本地端口交给 Electron，再由 Electron 下载、生成缩略图、写进按 ID 分目录的 library；拾图把这套管线压缩成「扩展内 fetch → File System Access 写盘 → 同名 JSON + 索引」，保留上下文与 Eagle 兼容字段，但不再需要常驻客户端。
