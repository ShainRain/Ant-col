# Eagle 浏览器扩展 3.1.26 · 功能全量盘点（亮点 / 机制 / 坑 / 可复用性）

> **盘点对象**：Eagle 浏览器扩展 3.1.26（Edge/Chrome，MV3）。
> **材料**：① 已格式化源码 `D:\eagle-ext-raw\`（103 个非 vendor 的 js/html，不含 CSS、manifest、vendor）；② 原始扩展目录 `C:\Users\69297\AppData\Local\Microsoft\Edge\User Data\Default\Extensions\cfgchmkedjfehclfhhmgedljhcibojcm\3.1.26_0`（含 `manifest.json`、`css/`、`locales/`、插件 CSS）；③ 主程序侧报告 `docs/research/eagle-static-analysis.md`；方案 `docs/eagle-optimization-plan.md`。
> **方法**：只读静态精读（read/grep），未执行扩展、未使用 REA、未改任何源码。
> **口径**：`文件:行号` 默认相对格式化源码根 `D:\eagle-ext-raw\`；CSS 是**单行压缩**文件（`content.css` / `*.css` 均 1 行），无法给行号，只给文件名。manifest 与 CSS 只在原始扩展目录中存在，会显式标注。
> **证据分级**：【观察】= 直接读到；【推断】= 由代码关系推出；【未知】= 需运行时验证。

---

## 0. 速览：Top 15 亮点与取舍

| # | 功能（亮点） | 机制 | 文件:行号 | 可复用性 / 成本 | 对 Ant-col 的价值 |
|---|---|---|---|---|---|
| 1 | 文件夹树选择面板 | `tree.walk` 拍平 + depth/guidelines + `recentFolderOrders` 三层稳定排序（最近→已选→本次选中）+ 拼音/繁简 score 搜索 + 搜索即建 + Ctrl 多选 | `collect-window/js/directives/folder-select-panel.js:58-393`、`.../folder-select-panel.html:1-172` | 改造 / M（换数据源，去库切换/父窗新建） | ★★★★★ Ant-col 目前单层项目，这是 folder 树交互现成实现 |
| 2 | 批量保存窗 | 三路采集（主文档/iframe/ShadowRoot）→ 去重 → 尺寸/格式/域名/文件夹/标签过滤 → `vs-grid-repeat` 虚拟网格 + `rect-selector` 框选 + `hover-play-video` + auto-detect + 10 条/批保存 | `batch-saver-window/index.html:21-630`、`js/controllers/batch-saver-window.js:96-478`、`js/batch-saver.js:1-386` | 改造 / L（拆 4 步分期） | ★★★★★ 比 Ant-col popup 扫描高一个量级 |
| 3 | 元素识别/取最大图 | srcset/picture/source 按 w/x 取最大、背景图/`image-set`/内联 SVG/canvas 序列化、blob→base64、链接推断、`elementsFromPoint`+shadow+z-index 加权 | `js/lib/api/element-inspector.js:39-630` | 直接搬算法 / S~M | ★★★★★ 直接决定“存到的图是不是原图” |
| 4 | URL 原图放大规则表 | 56 条 `{site,srcPattern,replace|replaceAsync,ignoreCheck}`；命中→改写→HEAD/Image 校验（按站点缓存成败）→3s 竞速回退 | `js/lib/api/url-enlarger.js:3-712` | 直接搬数据表 / S | ★★★★★ 纯数据+纯函数，立刻提升原图命中率 |
| 5 | 收集窗 | `<dialog>`+全屏 iframe；预览/自动换原图/改尺寸/评分/备注/标签/文件夹/切库；postMessage 双向协议 | `js/lib/collect-window.js:1-206`、`collect-window/js/controllers/collect.js:117-367`、`collect-window/index.html:20-237` | 改造 / M（并入现有面板，不搬 iframe） | ★★★★☆ 比 Ant-col 保存面板多评分/备注/改尺寸/换原图 |
| 6 | 标签选择面板 | 历史(12)/星标/建议/分组/侧栏计数；搜索压平+相似度排序（Levenshtein+包含+前缀）；新建/粘贴；布局/列宽/计数设置持久化 | `js/directives/tag-select-panel.js:54-1045`、`.../tag-select-panel.html:1-339` | 改造 / M；星标/建议无数据源（砍） | ★★★★☆ 标签输入体验的完整答案 |
| 7 | 整页滚动截图拼接 | 滚动网格(200px 重叠)+隐藏 fixed/sticky+暂停视频+漂移>2px 重截+`env.canvas` 上限切多段 canvas | `screen-capturer-scroll.js:1-520`、`screen-capturer.js:170-417` | 改造 / M | ★★★★☆ Ant-col 已有截图，健壮性细节差很多 |
| 8 | 裁剪器 Cropper | jQuery UI 选框；Ctrl 吸附 `getFilteredElementByPoint` 元素；方向键/Shift 微调；边缘自动滚动；保存/取消/全选/ESC | `js/lib/cropper.js:1-582` | 改造 / M | ★★★★☆ 元素级截图体验标杆 |
| 9 | 下载代理链（downloadViaBrowser） | 前台 port 任务(并发 10/URL 去重)→后台先隐藏 iframe 后 fetch→注入 `base64-extractor` 流式读→60MB 分块回传→`addFromURL` 传 data URL；失败回退 41593 | `downloader.js:245-484`、`base64-extractor.js:1-56`、`item.js:15-54` | 借思路 / M；`bypass-downloader` 死代码放弃 | ★★★☆☆ 绕热链/登录值得借，成本高 |
| 10 | 站点插件体系 | `SitePlugin{inject,getMeta,getMetaAsync,disableBatchSaver}` + `register(regex)`；`eagle-src/-tags/-type/-title/-link/-annotation` 属性优先；按 item link 匹配 | `js/lib/api/plugin.js:1-21`、`element-inspector.js:205-219,344-364`、`plugins/*` | 搬契约 / S；只留 5 个 DOM 型插件 | ★★★★☆ 接口形态值得照抄，具体插件大半不值得 |
| 11 | 拖拽浮层三态 | `dragMode 0/1/2`；首次拖动拉 recent folders(≤16)；`folder-id=""`/`"choose"`/真实 id 三态 → 收集窗/App 弹窗/直存；`extendTags` 随文件夹带上 | `js/lib/drag-saver.js:95-399`、`js/content.js:21-52`、`env.js:48-52` | 改造 / S~M | ★★★★☆ Ant-col 已有拖拽，缺“最近文件夹直达” |
| 12 | Alt+右键快速保存 | 右键坐标距离>5px 判拖动；Alt+右键 150ms 后波纹+直接保存；普通右键走原生菜单项 | `js/lib/context-saver.js:12-82`、`api/context-menus.js:16-25` | 直接搬 / S | ★★★☆☆ 小成本大体验 |
| 13 | 批量 auto-detect | 隐藏面板→页面进度胶囊→每 500ms 采集+按 src 去重→Esc/D 停止→恢复面板 | `js/lib/batch-saver.js:237-294` | 直接搬 / S | ★★★★☆ 无限滚动图库通用解法 |
| 14 | 保存顺序/标题工程技巧 | 视觉排序→标题重名 `(n)`→`modificationTime` 递减→每 10 条 postMessage + rAF 串行；`folder.extendTags` 合并去重 | `batch-saver-window/js/controllers/batch-saver-window.js:146-201`、`js/lib/batch-saver.js:368-417` | 直接搬 / S | ★★★☆☆ 低成本高收益 |
| 15 | UI 隔离范式 | `[eagle-extension]` 属性作用域 + CSS 变量主题 + `<dialog showModal>` 全屏 iframe + `body.eagle-show-*{pointer-events:none}` + z-index 2147483647 | `js/content.js:3-15`、`collect-window.js:5-23`、`css/content.css`（单行） | 借模式 / S（别搬 300KB CSS） | ★★★★☆ 注入型扩展避免宿主样式污染的标准做法 |

### 0.1 三个最值得搬（详见 §9）

1. **文件夹选择面板**（树 + 最近 + 搜索 + 新建 + 多选）→ Ant-col 的 folder 树 P0-3 直接受益。
2. **URL 原图放大规则表**（`url-enlarger.js` 56 条规则）→ 纯数据、S 成本，立刻提升原图命中率。
3. **元素识别/取最大图逻辑**（`element-inspector.js`）→ 决定“存错图”的最大变量。

> 补充：**批量保存窗**价值最高但成本 L（AngularJS + 整套滤镜/虚拟化/消息协议），建议拆成“扫描→过滤→框选→保存”四步分期搬。

### 0.2 三个不值得搬

1. **`bypass-downloader.js`**：全仓无调用者（`grep bypassDownloader` 只命中自身），却引入 `webNavigation` + `scripting.executeScript` 注入 + sandbox iframe，MV3 风险/收益比极差。
2. **`board-saver.js` 的站点抓取实现**：规则从远端 JSON 拉取、选择器硬编码、用 `alert()` 收尾、依赖站内滚动的脆弱假设；只值得借“自动滚动加载”的思想（§2.6）。
3. **依赖站点内部 API 的插件异步逻辑**（twitter/instagram/xiaohongshu/pinterest 的 `getMetaAsync`）：硬编码 bearer token、抓 `appId`、解析页面内嵌 JSON，属于高维护债；DOM 型 `getMeta` 可以留。

### 0.3 最容易忽略但很有价值的细节（精选，完整见附录 A）

- **`shouldShowNewCollectWindow(folderID)` 的三态语义**：`""` → 依 `usingCollect` 决定、`"choose"` → 强制收集窗、真实 folderID → 直接入库；一个拖拽面同时表达三种意图（`js/lib/api/env.js:48-52` + `js/content.js:32-50`）。
- **文件夹上的 `extendTags`**：拖到文件夹/批量选文件夹时自动附加标签，等于“把规则藏在文件夹配置里”（`js/lib/drag-saver.js:283-291`、`collect-window/js/controllers/collect.js:227-233`、`batch-saver-window/js/controllers/batch-saver-window.js:137-145`）。
- **保存顺序 = `modificationTime` 递减**：让入库顺序与批量面板视觉顺序一致；同名自动 ` (n)`（`batch-saver-window/js/controllers/batch-saver-window.js:149-174`）。
- **IME 安全 Enter**：keydown 只置 flag，keyup 才提交，避免中文输入法确认候选词误触发（`js/directives/select-panel.js:64-110`）。
- **`getMeta` 的标题清洗启发式**：hash/UUID/纯数字长文件名回退 `document.title`（`js/lib/api/element-inspector.js:584-630`）。
- **`eagle-src` 属性作为站点增强的最小接口**：500px/bing 只预置属性，不改 `getMeta`（`plugins/500px/500px.js:41`、`plugins/bing/bing.js:12-14`）。
- **`disableBatchSaver`**：批量扫描时跳过异步插件调用，避免对 N 张图发起 N 次站内 API（`js/lib/api/element-inspector.js:344-363`）。

---

## 1. 架构与能力门控

### 1.1 清单与注入矩阵

`manifest.json` 只在原始扩展目录（格式化副本未包含），全文 139 行。

| 注入批次 | 时机/范围 | 内容 | 目的 |
|---|---|---|---|
| ① `document_start` / all_frames | `manifest.json:9-14` | `eagle.js`、`utils.js`、`env.js`、`plugin.js`、`runtime.js`、`element-inspector.js`、`iframe-batch-saver.js`、`element-collector.js` | 让**子 frame** 也有识别/收集能力（批量保存要从 iframe 里取图） |
| ② `document_end` / 顶层 | `manifest.json:15-22` | jQuery、jQuery UI、Mousetrap、SweetAlert2 + 30 个 API/业务模块 + `content.js` + `plugins/ezpay/ezpay.js` | 主运行时（拖拽、右键、批量、截图、站点解析…） |
| ③ `document_end` / all_frames | `manifest.json:23-28` | 与②几乎相同的全量脚本 | 仅 `music.163.com`、`www.artstation.com`：这两站用 iframe 承载内容，需要 frame 内也能操作 |
| ④ 站点插件 | `manifest.json:29-105` | 18 个 entry（js/css 组合，含 4 个纯 CSS 站点） | 站点级 DOM 增强 |
| ⑤ web_accessible_resources | `manifest.json:120-138` | `collect-window/*`、`batch-saver-window/*`、`dialog/*`、`eagle-opener/*`、`base64-extractor.js`、locales/images | 供页面 iframe 加载 |

- 权限：`activeTab/contextMenus/storage/tabs/scripting/webNavigation`（`manifest.json:117`）；host 权限 `*://*/*`、`<all_urls>`（`:108`）。
- `background.html`（原始目录）第一行注释即 **“for safari use only”**（`background.html:1`），对应 MV2 的 `background.js`（`js/background.js:1-6` 只做 preference/i18n/contextMenus 初始化）；MV3 用 `js/background-v3.js` 的 `importScripts`（`:3-25`）。
- 【观察】①②存在**重复文件**：`element-inspector.js`、`element-collector.js`、`iframe-batch-saver.js` 在两个批次都加载；②③在 `music.163.com`/`artstation` 上完全重叠。
- 【推断】同一 isolated world 中重复执行 `class ElementInspector {}` 会抛 `SyntaxError`（该文件余下代码不执行，但①已定义，功能不受影响）；`iframe-batch-saver.js` 是 IIFE，会**重复注册 `batch-save-iframe` 监听器**（`js/lib/iframe-batch-saver.js:48-68`），可能产生重复响应。此点需运行时确认【未知】。

### 1.2 全局命名空间与加载顺序

- 所有模块挂在全局 `var eagle = new Eagle()`（`js/lib/api/eagle.js:1-6`），每个文件末尾 `eagle.xxx = new ...`。**加载顺序即依赖图**，没有模块系统。
- 例：`eagle.runtime` 必须先于使用它的 `env/preference/fetch/tabs/logger`；`eagle.preference` 必须先于 `drag-saver/url-saver/batch-saver/screen-capturer`（后者在 `eagle.preference.ready(...)` 里实例化，如 `js/lib/url-saver.js:104-106`、`js/lib/batch-saver.js:442-444`、`js/lib/api/screen-capturer.js:476-478`）。
- 【坑】任何按需懒加载/打包拆分都会破坏这套隐式顺序；Ant-col 若要移植算法，应显式 import 而不是照抄全局单例。

### 1.3 双 API：41593（旧表单）与 41595（JSON）

- 启动握手：先探 `http://localhost:41595`，要求 `data.version/buildVersion/platform/preferences` 四字段齐全才认（`js/lib/api/env.js:144-167`，并把 `buildVersion` 转 int、`isVersion4=true`）；失败再探 `41593` 拿 `showCollectModal/showNotification`（`:168-180`）。因此 **41595 可用 = 新 App；只有 41593 = 旧 App**。
- 保存：
  - 图片/批量/截图 → `POST http://localhost:41593`，`application/x-www-form-urlencoded`，`type: image|import-images|screen capture|save-url`（`js/lib/api/item.js:6-16, 60-64, 137-152, 182-211`）。
  - 新路径 → `POST http://localhost:41595/api/item/addFromURL`，JSON（`js/lib/api/item.js:41-46, 97-105, 129-134`），可带 `folderID/folderIDs/tags/star/annotation/modificationTime/notification`。
  - 元数据查询全部走 41595 GET：`/api/folder/listRecent|list|create`（`js/lib/api/folder.js:2-41`）、`/api/tag/listRecent|all|list`（`js/lib/api/tag.js:2-41`）、`/api/library/info|history|switch`（`js/lib/api/library.js:1-67`）。
- 所有网络请求经后台代发：前台 `eagle.fetch` → `runtime.sendMessage("fetch")` → 后台 `fetch()`；后台把对象 body 数组展开成 `key[i]` 再 `URLSearchParams`（`js/lib/api/fetch.js:20-59`），20s 超时（`:62-77`），`opaqueredirect` 标记 `isRedirect`（`:46-47`）。
- `fetchLargeJSON` 用 `responseType:"text"` 再 `JSON.parse`（`js/lib/api/fetch.js:10-13, 92-94`），用于 folder/tag 全量（`js/lib/api/folder.js:15-28`、`js/lib/api/tag.js:15-40`）。【推断】目的是避开大对象结构化克隆/后台 JSON 解析问题。
- 【坑】`folder.recent()` 等失败时只打日志不抛错，返回 `undefined`；调用方多处直接 `.forEach`/`length`（如 `collect-window/js/controllers/collect.js:144-146`），App 未开时会二次异常。

### 1.4 buildVersion 能力门控（移植时可直接抄的“降级表”）

| 门控 | 条件 | 效果 | 位置 |
|---|---|---|---|
| `isAppSupportURLEnlarger` | `buildVersion >= 20230901 && isVersion4` | 允许扩展侧做原图放大/base64 缓存；popup 用它当“新版 Eagle”标志 | `js/lib/api/env.js:24-30`；`js/lib/api/cache-helper.js:6`；`popup/js/controllers/popup.js:17` |
| `isAppSupportExtensionCollectWindow` | `>= 20240222 && isVersion4` | 新版收集窗 iframe + `addFromURL` 保存路径 | `js/lib/api/env.js:34-40`；`js/lib/api/item.js:115` |
| `isAppSupportDownloadViaBrowser` | `>= 20241106 && isVersion4` | 浏览器下载管线、批量保存窗 UI（否则退回 `import-images`） | `js/lib/api/env.js:41-47`；`js/lib/api/item.js:15,71`；`js/lib/batch-saver.js:61`；`js/lib/api/preference.js:115-120` |
| `shouldShowNewCollectWindow(folderID?)` | 支持收集窗 && `usingCollect` | 见 §0.3 三态语义 | `js/lib/api/env.js:48-52` |
| `isAppNotificationEnabled` | `appInfo.showNotification ?? true` | 传给 App 的 `notification` 字段 | `js/lib/api/env.js:31-33`；`js/lib/api/item.js:32,88,121` |

- `usingCollect` 的真相在 **App 侧**：`preference.init()` 会用 `appInfo.showCollectModal` 覆盖本地值（`js/lib/api/preference.js:172-174`）；popup 里切换时又反写 App `GET /api/preferences/collect/on|off`（`popup/js/controllers/preference.js:37-43`）。
- 【坑】两处状态源（本地 storage + App），切换后若 App 未响应/失败不会回滚；且 `41595` 不可用时 `usingCollect` 永远 `false`。
- 【坑】`eagle.env.isReady()` 是所有保存动作的守卫：`runtime.isAvailable` 为假 → “扩展被更新，请刷新”；Eagle 未开 → 打开引导弹窗；Firefox 未同意隐私 → 隐私弹窗（`js/lib/api/env.js:126-139`）。Ant-col 无此依赖，移植时把这一层删掉即可。

### 1.5 消息协议（channel + 分块 + port）

- 统一 `{ channel, ...payload }`；`eagle.runtime.onMessage(name, handler)` 注册（`js/lib/api/runtime.js:130-149`）。`tabs.sendMessage(tabId, channel, params, cb)` 再包一层（`js/lib/api/tabs.js:18-20, 51-54`）。
- **大消息分块**：`JSON.stringify` 后 >60MB 时按 20MB 切块发 `{type:"chunk",index}`，再发 `{type:"end",totalChunks}`；接收端拼装（`js/lib/api/runtime.js:44-57, 130-149`）。用于 base64 图片回传。
- **port 通道**用于下载：内容脚本 `connect({name: taskId})` → 后台逐条 `downloadStarted/Progress/Result/Complete/Error`（`js/lib/api/downloader.js:72-147`）；`bypass-downloader` 同样用 port（`js/lib/api/bypass-downloader.js:12-32`）。
- 广播：`eagle.runtime.broadcast()` 向所有 tab + 后台自身发（`js/lib/api/runtime.js:157-162`），偏好更新用它（`js/lib/api/preference.js:191-198`）。
- 【坑】每个接收端都要 `return true`/调 `sendResponse` 否则通道挂起；代码里大量 `t()` 空回调硬编码。

### 1.6 UI 隔离范式（很值得照抄，但不必照抄实现）

- 所有复杂 UI 都是**独立扩展页 + `<dialog showModal>` + 全屏 iframe**：收集窗（`js/lib/collect-window.js:5-23`）、批量窗（`js/lib/batch-saver.js:1-44`）、SweetAlert 对话框（`js/lib/api/swal-dialog.js:18-26`）、Eagle 启动器（`js/eagle-opener/app.js:1-10`）。
- `dialog[eagle-extension]` 被 CSS 重置为全屏、无边框、`z-index:2147483647`；`body.eagle-show-collect-window { pointer-events:none }` 只放行弹窗（`css/content.css` 单行）。
- 主题/语言/OS/浏览器作为 **HTML 属性**下发给每个 UI 根节点（`js/content.js:3-15`、`collect-window/index.html:7-10`），CSS 全部挂在 `[eagle-extension]` 下，避免污染宿主页面。
- 【代价】4 套 Angular 应用 + 4 份巨大 CSS：`collect-window.css` 338KB、`popup.css` 254KB、`dialog.css` 250KB、`batch-saver-window.css` 372KB（原始目录体积）——功能很强，包体很重。
- 【坑】收集窗 iframe 就绪靠 `postMessage("iframe-ready")` + 100ms 轮询（`js/lib/collect-window.js:25-31, 38-47`），再延迟 50ms 发包；`collect.js` 侧 `window.onload` 还要 100ms 轮询抢焦点（Safari 兼容，`collect-window/js/controllers/collect.js:80-90`）。时序脆弱。

### 1.7 架构层坑汇总

| 坑 | 证据 | 影响 |
|---|---|---|
| `isBackground()` 用 `chrome.tabs` 是否存在判断，导致**所有扩展页都被当后台** | `js/lib/api/env.js:196-215` | 每个无 DOM 依赖的服务都要再判 `isPopup/isCollectWindow/isBatchSaverWindow`（`fetch.js:82-87`、`downloader.js:488-493`、`file-type-detector.js:173-178`、`bypass-downloader.js:124-129`、`logger.js:147-152`）；漏判就会在 SW 里调 DOM |
| 后台是 service worker，不能持有 DOM/长期内存状态 | `manifest.json:6-8`；`background-v3.js` | 所有 UI 必须落在扩展页；偏好用 `storage.sync` 持久化 |
| 重复注入（见 1.1） | `manifest.json:9-28` | 控制台噪音/重复监听风险【未知】 |
| 全局单例 + 加载顺序 | `js/lib/api/eagle.js`、各文件尾 `new` | 不可懒加载；测试困难 |
| 保存依赖两个本地端口 | `env.js:144-180`、`item.js` | App 未启动/端口被占即不可用（Ant-col 无此问题，反而应删掉重试逻辑） |

---

## 2. 采集入口矩阵

### 2.1 `content.js` 总调度

`js/content.js` 是顶层编排：等待 DOM → 初始化偏好/i18n/快捷键 → 实例化 `DragSaver`/`ContextSaver` → 监听主题/偏好变化 → Chrome 下广播 `CheckEagleExtensionEvent` 检测“装了多个 Eagle 扩展”（`:2-91`，多扩展弹窗 `js/lib/api/swal-dialog.js:114-127`）。

| 入口 | 触发 | 主处理 | 落地协议 |
|---|---|---|---|
| 拖拽 | `dragstart`（img/a/video/audio/[eagle-src]） | `DragSaver` → `onDrop` | `eagle.item.addFile` 或收集窗（`content.js:21-52`） |
| 右键 | 原生菜单项 / Alt+右键 | `ContextSaver` → `onSave` | `addFile` 或收集窗（`content.js:53-78`） |
| 保存网址 | 快捷键 Alt+0 / popup 菜单 | `URLSaver.saveURL` | `41593 type=save-url`（`url-saver.js:9-39`） |
| 批量保存 | 快捷键 Alt+1 / popup | `BatchSaver.open` | 新版批量窗 或 `41593 type=import-images`（`batch-saver.js:58-67`） |
| 保存画板 | popup（仅匹配规则的站点） | `BoardSaver.start` | 建文件夹 + 逐图 `addBatchSaveFile`（`board-saver.js`） |
| 截图 | Alt+2/3/4、popup | `ScreenCapturer` | `addFile`/`addScreenshot`（`screen-capturer.js`） |

### 2.2 `drag-saver.js`（拖拽浮层，399 行）

**三种模式**（偏好 `dragMode`：0 关闭 / 1 浮窗 / 2 底部条，`preference.js:11`、`drag-saver.js:107-176`）：

- **模式 1**：`<dialog>` + overlay，左“拖到这里”（`folder-id=""`）、右侧最近文件夹（最多 16 个，`drag-saver.js:267-297`）+ 底部“建立或选择文件夹”（`folder-id="choose"`，`:128-137`）。落点带 `extend-tags`（文件夹自定义标签，`:284`）。
- **模式 2**：底部横条（`drag-saver.js:154-176`），拖上去即存，不选文件夹。

**交互链路**：
1. `dragstart` 代理：`img,a,video,audio,[eagle-src]`（`:48`）；音频/视频默认不可拖，用 `focus`/`mousedown` 动态加 `draggable`（Chrome）或 `mouseover`（Firefox）（`:52-93`）。
2. 拖影：图片宽度 >140 时用 canvas 缩到 140px 并塞进 `#eagle-drag-images` 离屏容器，避免 canvas 被 GC 后拖影空白（`:298-316`）；视频/音频直接用元素。
3. 浮层出现条件：`dragCount>10` 且位移 >30px，或 800ms 超时（`:327-354`）；`dragend` 或 2s 无移动则收起（`:350-361, 394-398`）。
4. 浮层位置按方向（Top/Bottom/Right/…）相对光标偏移并夹取视口（`:236-266`）。
5. **最近文件夹在首次拖拽时才拉取**（`:373-375`），取 `GET /api/folder/listRecent`，取前 16（`:269-296`）。
6. `drop` → `onDrop({event, element, folderID, extendTags})`（`:190-209`），并 `await eagle.env.isReady()` 守卫（`:192`）。

**Ant-col 直接对照**：Ant-col `content/drag-save.js`（957 行）已有“居中收藏页 + 文件夹选择”，但**没有**“拖到最近文件夹直接落库”的快路径，也没有 `extendTags` 自动标签。这两个是改造成本 S 的提升点。

### 2.3 `context-saver.js`（右键/Alt+右键，83 行）

- 监听 `contextmenu` 与 `mousedown/mouseup`（右键）；每次右键派发内部事件 `eagle-right-mouseup`（`:12-26`）。
- 用按下/抬起坐标距离 >5px 判定“不是拖动”（`:31-40`）。
- `Alt+右键`：150ms 后显示点击波纹（`.eagle-click-effect-circle`）并**直接保存**当前元素（`:49-68`）。
- 普通右键：只记录 target，等原生菜单项点击后由后台发 `context-save` 频道触发保存（`:75-82`；后台菜单 `js/lib/api/context-menus.js:22-24`）。
- 【坑】`contextmenu` 只在 `altKey` 时 `preventDefault`（`:18`），否则依赖浏览器原生菜单；站点自定义右键菜单会抢事件。
- **原生菜单只有一个菜单项**：`chrome.contextMenus.create({id:"eagle-context-menu", title:"Save to Eagle (&Z)"})`（`js/lib/api/context-menus.js:16-25`，`locales/en.json:70`）。**v3.1.26 不存在“保存到哪个文件夹”的原生嵌套子菜单**（全仓只有这一处 `contextMenus.create`，grep 确认）。嵌套子菜单能力在页面内的 Angular `context-menu` 指令里（§3.6/§8.6），当前只用于文件夹树右键“新建子文件夹/新建同级文件夹”和库切换菜单。

### 2.4 `url-saver.js`（保存网址，106 行）

- 入口：快捷键 `url-save`（默认 Alt+0，`preference.js:16`）或 popup → 后台 `tabs.sendMessage("save-url")`（`popup/js/controllers/action.js:54-58`）→ `eagle.runtime.onMessage("save-url")`（`url-saver.js:40-44`）。
- 缩略图：视频页用 `og:image`/播放条缩略图 `urlToBase64(…,10s)`；否则 `chrome.tabs.captureVisibleTab`（JPEG q85）再缩到宽 ≤720（`url-saver.js:9-30`；`item.addURL:153-181` 二选一）。
- 取站点信息：`siteParser.getMeta()` + `getVideoMeta()`（`:63-102`）。字段：`behavior/type:save-url/url/metaTags/metaDescription/metaKeywords/title`，视频追加 `videoID/videoWidth/videoHeight/medium/videoThumb/videoDuration/videoEmbed`（`:79-99`）。
- **坑**：`#getSiteInfo` 解构 `metaTitle`（`:66`），但 `SiteParser.getMeta()` 从不返回 `metaTitle`（`js/lib/api/site-parser.js:18-23` 只有 `metaTags/metaDescription/metaKeywords/metaPicture`）→ 标题永远回退 `document.title`；`metaPicture` 从未使用。
- 保存走 `41593 type=save-url`，`base64` 为上述截图（`item.js:153-181`）。

### 2.5 `batch-saver.js`（批量保存，444 行）

- **门控**：`isAppSupportDownloadViaBrowser` 为真 → 打开新版批量窗；否则退回旧路径（`open` 里直接 `eagle.item.batchSave(items)`，`:58-67`）。
- 旧路径 payload：`41593` 表单，`type:"import-images"`，`images` 为 JSON 字符串（`item.js:182-211`）。
- 新路径协议（postMessage，见 §4）：`batchSaver.*` 消息族（`:107-182`）。
- 采集：`elementCollector.getCollectableItems()` + iframe 版（向所有子 frame 发 `batch-save-iframe`）+ ShadowRoot 版，三路并发（`js/lib/element-collector.js:2-63`、`js/lib/iframe-batch-saver.js:1-68`）。
- 自动检测模式：隐藏弹窗 → 每 500ms 重新采集、去重、更新“已找到 N 张”提示 → 期间绑定 `Esc`/`D` 停止（`js/lib/batch-saver.js:237-294`）。
- 最终保存：每 10 条一组、`requestAnimationFrame` 串行（`:397-417`）；每条 `addBatchSaveFile`（`item.js:56-136`）。
- 【坑】批量窗与 collect 窗共用 `folder-select-panel` 但**两份实现**（collect 版有库切换、无 tab；batch 版有 tab、无库切换），后续修 bug 要改两处。

### 2.6 `board-saver.js`（Pinterest/花瓣/小红书等画板抓取，343 行）

- 规则**优先远端拉取** `https://oss-app.eagle.cool/extensions/batch-save-image-rules.json`，失败用内置 9 条（`board-saver.js:333-339`、内置 `:227-332`）。
- 流程：按 URL 匹配规则 → 以画板标题 `POST /api/folder/create` 建文件夹 → 每 100/200ms 滚动半屏、采集新图（按 src 去重）、`elementInspector.getMeta` 取标题/尺寸、`queue` 并发 5 调 `addBatchSaveFile`（`:31-223`）。滚动到底/出现结束元素/URL 变化即停（`:132-176`）。
- 内置规则站点：huaban/pinterest/dribbble/meiye/rednote/xiaohongshu/twitter/x/gameui（`:227-332`）。
- **坑**：
  - `eagle.plugin.getMeta(...)` 的返回值被丢弃（`:93-107`）——异步标题解析实际不生效。
  - 标题回退链里 `document.querySelector("title").text` 是无效属性（应为 `.textContent`）（`:200-202`）。
  - 用 `alert()` 收尾，阻塞页面（`:132-157`）。
  - 依赖站点 DOM 选择器与滚动行为，站点改版即坏；远端规则又不受扩展版本控制。
- **结论**：只值得借“按下滚动 → 去重采集 → 批量入队”的模式，不建议搬实现（§0.2）。

### 2.7 `iframe-batch-saver.js`（69 行）

- 后台侧：收到 `batch-save-iframe` → 向当前激活 tab 的所有 frame 转发同频道，2s 超时兜底（`:2-33`）。
- frame 侧：仅当 `window.self !== window.top` 才注册；收到消息后调用 `ElementCollector.getCollectableItems()` 回传（`:48-68`）。
- 【坑】与 manifest 重复注入叠加会注册两次（§1.1）。

### 2.8 popup 入口

`popup/popup.html` 是“动作菜单 + 偏好页”二合一（无 Angular 路由）：保存画板/保存网址/批量保存/截图三连/拖拽开关（按 URL/域名禁用）/偏好入口（`:447-578`）。`popup/js/controllers/action.js` 负责把命令转发给当前 tab（`:49-78`），并按站点是否匹配 board-saver 规则决定是否显示“保存画板”（`:79-85`）。

---

## 3. 收集窗（collect-window）

### 3.1 宿主与生命周期

- 不是独立窗口，而是页面内 `<dialog showModal>` + 全屏 `iframe`（`js/lib/collect-window.js:5-23`），并给 `body` 加 `.eagle-show-collect-window`（CSS 让 body `pointer-events:none`）。
- 生命周期：iframe → `postMessage("iframe-ready")` → 宿主 `loaded()` 轮询就绪 → 发 `preview-meta` → 子页加载图片/视频尺寸并回发 `collectWindow.enlargeUrl` → 宿主用 `urlEnlarger + downloader` 换原图 base64 再回发 → 子页显示 `status:done`（`collect-window.js:25-47, 162-194`；`collect-window/js/controllers/collect.js:290-357`）。
- 用户操作 → `collect-item` 消息（payload 仅 `title/annotation/tags/folderIDs/star/src`，白名单在 `collect.js:125-131`）→ 宿主 `onCollect` 回调 → `eagle.item.addFile({...meta, ...result})`（`js/lib/collect-window.js:61-73, 79-94`）。
- 关闭方式：点空白（`collect.js:6-12`）、Esc（folder panel 的 `onEscKey`，`collect.js:261-263`）、iframe 发 `iframe-closed`。
- 新建文件夹：子页 `postMessage("open-create-folder-dialog")` → 宿主用 SweetAlert iframe 弹窗拿名字 → `eagle.folder.create` → 直接把 `folderIDs=[新 id]` 回填并发 `collect-item` 关闭（`collect-window.js:104-120`）。

### 3.2 收集窗 UI / 数据模型

`collect-window/index.html`：左预览（`aspect-ratio` 绑定宽高，图片/video/audio/网址四种，`:27-78`）、五星评分（`:81-87`，点击可取消，`collect.js:158-162`）、标题/备注 contenteditable（`:89-113`）、标签 chips + “添加标签”（`:117-152`）、右侧 `folder-select-panel`（`:156`）、遮罩加载（`:159-179`）。弹窗底部挂 `tag-select-panel` 与 `context-menu`（`:183-185`）。

`CollectItem` 模型非常薄：默认 `width/height=2048`（首屏占位）、`status=pending`，提供 `updateImageSize/updateVideoSize`（`collect-window/js/models/collect-item.js:1-46`）。

### 3.3 `folder-select-panel`（文件夹树，核心）

**数据准备**（`collect-window/js/directives/folder-select-panel.js:58-102`）：
- `eagle.utils.tree.walk(folders,"children")` 拍平，记录 `depth`、父路径、`guidelines`（逐级父级颜色，用于树线着色）、`hasChildren`、`extendTags`。
- 另建 `folderItemsMap/foldersMap` 供 O(1) 查询。

**最近使用 + 选中优先排序**（`updateItemList`，`:103-178`）：
- `recentFolderOrders` 是 `id→序号` 的 map（由调用方从 `/api/folder/listRecent` 数组顺序生成：`collect-window/js/controllers/collect.js:144-146`、`batch-saver-window/js/controllers/batch-saver-window.js:120-123`）。
- 候选：`recentFolderOrders[id] >= 0` 或已选中 → 复制一份、`depth=0`、`isRecent=true` 进“最近区”（`:119-123`）。
- 排序三层稳定排序：最近序号 → `rawData.selectedIds` 优先 → `listData.selectedIds`（本次会话选中的）优先（`:124-140`）。
- 最近区上限 `5 + 已选数`（`:110,118,144`）；列表 = 最近区 + 分隔条 + 树（无搜索时），有搜索时去掉与最近区重复项（`:141-155`）。
- 切 tab：ALL / RECENT（最多 20）/ SELECTED（`:156-162`）——**collect 版没有 tab UI，只有 batch 版有**（`batch-saver-window/js/directives/folder-select-panel.html:16-50`）；collect 版此处是死代码路径。
- 搜索时列表末尾追加 `{type:"create", name:keyword}`（`:163-170`）。

**搜索（中文/拼音）**（`filterByKeyword`，`:189-238`）：
1. `chineseConvert.tw2cn(关键词)`（繁体→简体，vendor `chinese_convert.js`）。
2. 名称 ≤30 字时生成拼音候选：`pinyinlite(name,{keepUnrecognized:true})` 得每字音节数组 → `cartesianProduct(...)` 取前 10 种组合、空格拼接（`:202-208`；`cartesianProduct` 默认上限 10，`js/directives/select-panel.js:316-333`）。
3. 每个候选与关键词算 `String.prototype.score` 相似度取最大（`:216`；评分函数 `js/directives/select-panel.js:2-38`：命中位置/词首/大小写加成）。
4. 过滤 `score>0`、按分数降序，再切成“前缀命中 / 非前缀”两段拼接（`:219-235`）。
5. 模板里用 `fuzzyMatch` 过滤器把命中字符包 `<b>`（`collect.js:61-79`；`folder-select-panel.html:120`）。

**交互/键盘/右键**：
- Ctrl/Cmd 按下即进入多选模式（一旦进入本次面板不再退出，`:443-446`），多选后底部出现“收藏”按钮，`onOpenItem(ids[])` 返回 **folderIDs 数组**（`collect.js:221-238`）；单选则直接 `onOpenItem(folder)` 立即入库（一步完成）。
- 树展开/折叠状态存 `localStorage["eagle.folderSelectPanel.collapsedFolderIds"]`（`:35-57, 369-385`）。
- 右键文件夹（`ng-right-click`）→ 页面内 ContextMenu：“新建子文件夹/在下方新建文件夹”（`:292-317`）；collect 版经父窗弹 SweetAlert 新建，batch 版走 `batchSaver.createFolder` 消息（`:240-251`）。
- 键盘：↑↓ 走 `SelectPanel.selectUp/Down`（跳过不可选项），←/→ 折叠/展开（`:386-393`），Tab 在 batch 版切 tab（`:276-274`），Enter 选中，Esc 关闭并回焦搜索框（`:476-478`）。
- “全部”项 `{type:"all", name:"All"}`：名字硬编码英文，未 i18n（`:112`）。

**模板/视觉**（`collect-window/js/directives/folder-select-panel.html`）：顶部搜索框 + `library-switcher`（`:6-21`）；`vs-repeat` 虚拟列表（26px 行高，`:39-44`）；树线 `guidelines` 三层 div（`:99-109`）；最近项带 `history-badge`（`:116`）；右侧显示父文件夹名 + 选中勾 + 展开箭头（`:122-139`）；底部快捷键提示/多选收藏按钮（`:146-170`）。

**坑**：
- `getCallbackResult` 的 `isDirty` 依赖两次快照，但 collect 版根本没用（只有 batch 版 `close()` 里用，`batch-saver-window/js/directives/folder-select-panel.js:263-266`）。
- `createFolder()/onCreatedFolder()` 用全局 `swal/i18n`，在浏览器扩展页里**没有这两个全局**（`folder-select-panel.js:330-368`）→ 实际是死代码，真正新建走父窗 `eagle.dialog`。
- 最近序号 map 依赖 App 返回顺序，`listRecent` 语义若变化排序即错。

### 3.4 `library-switcher`（库切换，collect 版专属）

点击当前库名 → `ContextMenu.open` 列出 `GET /api/library/history` 的历史库（名称、图标 `?libraryPath=` 接口、当前库 disabled+checked）→ 选中后 `switchPromise(path)`：**每 200ms 轮询 `/api/library/info` 直到 path 一致，10s 超时**（`collect-window/js/directives/library-switcher.js:14-60`；`js/lib/api/library.js:45-67`）。切换期间遮罩 `isLoadingData`（`collect.js:252-260`）。

### 3.5 `tag-select-panel`（标签面板，1045 行 + 339 行模板）

**数据形态**（`TagSelectPanel.initRawData`，`js/directives/tag-select-panel.js:154-232`）：
```
tagManager: {
  allTags: [{name, pinyin, groups:[groupId], imageCount, ...}],
  groups: [{id,name,color}],
  recentTags: [name...],       // 调用方传
  starredTags: [name...],      // 调用方从未传 → 星标组永远空
  suggestions: [name...],      // 调用方传 [] → 建议组永远空
}
selectedTags: {name:true}
```
- 最近标签取前 12 个（`:218-221`）；每个标签的组取 `groups[0]` 作为展示色，`none` 表示未分组（`:172-195`）；已选中但不在 allTags 的名字补一个临时项（`:196-216`）。

**排序优先级**（`:279-309`）：星标 → 最近（按 recent 顺序）→ 建议 → 最近布尔 → 同组 → 组顺序 → 名称。

**分组构建**（`:311-449`）：
- 固定组：星标（group-starred）、最近（group-history）、建议（group-suggest）、普通组（来自 tagManager.groups）、未分组（group-normal）。
- 无搜索时按组渲染，组可折叠（状态存 `localStorage["eagle.tagsPopup.collapsedGroup.<id>"]`，`:437-445, 921-938`）；组标题点击折叠、右键“全部折叠/展开”（`tag-select-panel.html:116-136`）。
- 有搜索时**压平成单组** `group-default`：创建行 → 星标/最近/建议 → 各分组 → 未分组，再按“相似度”排序（`:384-418, 542-596`，内部含 Levenshtein 距离 + 包含/前缀优先）。
- 侧栏（可选）：全部/各分组/未分类 + 计数（`:311-320, 483-493`；模板 `:37-95`），Tab 循环切组（`:784-793`），默认关闭（`localStorage`）。

**搜索**（`filterByKeyword`，`:494-541`）：与文件夹面板同款“繁简 + 拼音 + score”；额外规则：关键词 ≥2 字且能匹配“组名”中的标签时，把整组标签并入结果（`:498-505`）。

**新建标签**：搜索词非空且不存在同名 → 列表出现 `type:"create"` 行（`:271-282, 384-395`）；Enter 创建（`openItem`，`:794-803`）；`createdTags` 会去重、最多 200、标记 recent、重排（`:873-913`）。也支持**粘贴批量创建**：按 `，,;、\n` 拆分（`parseTags`，`:914-920`），但实现调用了 `clipboard.readText()`（`:628-641`）——`clipboard` 是 Electron 全局，**浏览器扩展页里不存在**，粘贴创建实际不可用【推断，需实测】。

**其他能力**：布局列表/网格切换、列宽 4 档、显示星标/最近/建议/计数、面板可拖拽/可缩放（尺寸存 localStorage）、网格键盘导航（按 `columns` 计算）、组内/跨组四向移动、`onChanged` 只在 dirty 时回调（`:597-623`）。计数来自 `imageCount`（模板 `:180-183`）。

**坑**：
- 星标/建议两组**有 UI 无数据源**（调用方 `collect.js:167-176`、`batch-saver-window.js:202-211` 从不传 `starredTags`，`suggestions` 恒为 `[]`）——移植时可直接砍掉。
- `pinSelected` 字段无任何使用（`:64,76,132`）。
- 搜索 ≤1 字时跳过“组名匹配”分支（`:498-505`），可能让用户困惑。
- `String.prototype.score` 是全局 monkey patch（`select-panel.js:2`），冲突风险。

### 3.6 `select-panel` 基类（所有浮层的骨架）

`js/directives/select-panel.js`：
- `String.prototype.score` 模糊评分（`:2-38`）。
- `SelectPanelSearchInput`：统一 keyup/keydown 语义（`:39-118`），**Enter 在 keydown 只置位、keyup 才触发**（`:83-88` + `:66-68`），Ctrl/Cmd+Enter 立即触发——中文 IME 安全；Esc 同理两次触发避免误关；Tab/↑↓←→ 全部走回调。
- `SelectPanel`：定位到光标并防碰撞（`:267-314`，图片选择面板先测高再定位）、`open/close`、键盘上下跳过不可选项、`hoverItem`、`focusSearchInput`、`onSelectChanged({type:"keyboard"|"mouse",index})` 驱动 `vs-repeat-auto-scroll`（`js/modules/vs-repeat-auto-scroll.js:1-32`）。
- 所有子面板（文件夹/标签）都继承它，模板里都是 `<select-panel><select-panel-list>[vs-repeat]` + `<select-panel-overlay>`。

### 3.7 收集窗复用建议

| 子功能 | 价值 | 成本 | 建议 |
|---|---|---|---|
| 文件夹树面板 | ★★★★★ | M | **搬**（数据源换成 Ant-col 的 folder 树；去掉库切换/父窗新建，改为本地 FSA 写入） |
| 标签面板 | ★★★★☆ | M | 搬“搜索/最近/分组/新建”，砍星标/建议/设置面板 |
| 收集窗 iframe 预览+评分+备注 | ★★★☆☆ | M | 改造：Ant-col 已有保存面板，建议把评分/备注/换原图**并入现有面板**而不是再开 iframe |
| iframe + postMessage 宿主 | ★★☆☆☆ | S | 不必照抄；Ant-col 是自有页面，直接用 Shadow DOM/普通模态即可 |
| 库切换 | ★☆☆☆☆ | S | 放弃（Ant-col 无多库） |

---

## 4. 批量保存窗（batch-saver-window）

### 4.1 触发与宿主

- 入口：Alt+1 / popup / 后台消息 `batch-save`（`js/lib/batch-saver.js:418-440`）。
- 宿主：`<dialog>` + 全屏 iframe（`js/lib/batch-saver.js:1-44`），子页就绪 `batchSaver.iframeReady`，宿主随后把采集结果 `batchSaver.sendItems` 推给子页（`:311-338`）。
- 门控：`isAppSupportDownloadViaBrowser`（§1.4），否则回退旧 `import-images`（`:58-67`）。

### 4.2 扫描与去重

- 采集三路：主文档（img/svg/video/bg-image）、iframe（消息）、ShadowRoot（遍历 `shadowRoot` 找 IMG/VIDEO）（`js/lib/element-collector.js:2-63`）。
- 过滤：图片 <5px、tracking pixel 名单（facebook/google-analytics/doubleclick/bat.bing/analytics.twitter/linkedin）（`:64-99`）；SVG <5px（`:100-130`）；视频仅 mp4/webm 且非 blob（`:131-166`）；背景图非渐变且 ≥5px（`:167-189`）。
- 宿主格式化：去掉 DOM 引用，保留 `x/y/width/height`（用于框选与视觉排序）、`src/thumbnailURL/url/title`，按 `src` 全局去重（`js/lib/batch-saver.js:184-236`）。
- 自动检测模式：面板 `hide()` → 页面出现进度胶囊 → 每 500ms 重新采集并去重，`Esc`/`D` 停止 → `show()`（`:237-294`）。【观察】这是“无限滚动图库”最省事的解法。

### 4.3 面板 UI

`batch-saver-window/index.html`：
- 左：标题“(已选/总数)”、缩放滑杆 125–300px（`:32-72`）、自动加载按钮 + 信息气泡（`:73-104`）、全选/反选（`:105-123`）、`rect-selector` 容器（`:125-130`）、`vs-grid-repeat` 网格（`:132-204`，视频用 `hover-play-video`，懒加载 `lazy-load`），空状态（`:206-217`）。
- 右：搜索（`:222-230`）、分辨率过滤（大≥1000 / 中≥500 / 小 / 计算中 / 自定义宽高）（`:233-385`）、格式过滤（jpg/png/webp/avif/bmp/gif/mp4/webm/svg/others）（`:387-420`）、域名过滤（多于 1 个域名才显示，`:421-455`）、文件夹多选 + 自动标签展示（`:457-541`）、标签选择（`:543-606`）、下载按钮（`:608-626`）。

### 4.4 过滤/排序/选择逻辑

`batch-saver-window/js/batch-saver.js`：
- `filter` 三族：`format/resolution/domain`，各含 `available/selected/enabled`（`:204-261`）；可用数随筛选联动重算（`:262-322`）。
- 分辨率分桶在 item 侧：`status=pending` → pending；≥1000 长边 → large；≥500 → medium；否则 small（`js/batch-saver-item.js:107-117`）。
- 排序：`size` 桶（large→medium→small→pending）→ `y` → `x`（保留页面视觉阅读顺序）（`:356-385`）。
- 选择：单选切换、`Shift` 范围选、框选（Ctrl/Shift 追加，否则替换）（`js/controllers/batch-saver-window.js:269-306`）；框选实现见 4.5。
- 快捷键：`mod+A/F/Enter/±/0`、`D` 自动检测、`T` 标签、`F` 文件夹、`Esc` 先清选择再关窗、Ctrl/⌘+滚轮缩放（`:346-397`）。

### 4.5 `rect-selector.js`（框选，85 行）

- 容器内绝对定位虚线框；坐标换算购物车般加上 `scrollLeft/scrollTop`（`:12-43, 54-63`）。
- 拖动阈值 10px 才显示框（`:20-21`）；实时把与矩形相交的 item 交给 `onSelection`（`:66-77`），松手 `onSelectionEnd` 由控制器结合 Ctrl/Shift 落定（`:44-51`）。
- 【坑】依赖每个 item 的 `x/y/width/height` 是相对容器，且未处理容器之外滚动；`e.on("$destroy")` 里 `h.off("mousedown", null)` 写法无效（传 null 不会解绑），内存泄漏风险（`:79-83`）。

### 4.6 `hover-play-video.js`（23 行）

鼠标进入 400ms 后 `video.play()`，离开即 `pause()`（`:9-16`）。非常小的体验点，可照抄。

### 4.7 每项“就绪”流水线（`batch-saver-item.js`，134 行）

1. `ready()` 先经 `eagle.enlargeProxy` 问父窗要原图 URL（`:33-42`；`enlarge-proxy.js:6-31` 用 uuid + postMessage 往返）。
2. 扩展名：`simpleDetectExt`（URL 后缀）→ 未知则后台 `file-type-detector` 嗅探（`:30-31, 43-44, 118-129`；后台实现 fetch+magic bytes，`js/lib/api/file-type-detector.js:62-169`）。
3. 图片：`Image` 加载取真实宽高；**失败则请求父窗把 URL 转 base64**（走下载代理），成功后把 `src` 换成 data URL 并 `status=done`（`:47-73`、`js/lib/batch-saver.js:148-170`）。这是“防盗链/需登录”图片能批量保存的关键。
4. 视频：`video.onloadedmetadata` 取宽高/时长（`:74-88`）。
5. 域名：`new URL(src).hostname`，失败会抛（`:130-133`）。

### 4.8 下载/保存协议

- 子页点下载 → 按视觉顺序排序（`r[id]=index`）→ 标题重名加 `(n)` → `modificationTime` 从 `now+count` 每条递减 1（让入库顺序=面板顺序）→ 每 10 条 `postMessage("batchSaver.downloadItems", {images,tags,folders,batchIndex,totalBatches})`（`js/controllers/batch-saver-window.js:146-201`）。
- 父窗收集分批，最后一批回 `onBatchSave`（`js/lib/batch-saver.js:116-133`）→ 构造每条 `addBatchSaveFile`（补 `folderIDs`、合并文件夹 `extendTags`、去重），再每 10 条一帧串行提交（`:368-417`）。
- 【坑】父窗用 `pendingBatchData` 聚合，若最后一批丢失则永不落库且无提示；子页关闭（点遮罩）会 `batchSaver.closeWindow` 直接取消（`:134-136`）。

### 4.9 批量窗复用建议

| 子功能 | 价值 | 成本 | 建议 |
|---|---|---|---|
| 扫描三路 + 去重 + tracking pixel 过滤 | ★★★★★ | S | 直接搬（去掉 41595/图片规范化依赖） |
| 过滤/排序/选择模型 | ★★★★★ | M | 搬逻辑，UI 用 Ant-col 现有风格重写 |
| `rect-selector` | ★★★★☆ | S | 直接搬（修 destroy 解绑） |
| 自动检测滚动模式 | ★★★★☆ | S | 直接搬（配合 Ant-col 的 `data-drag` 类名去重） |
| 每项就绪流水线（base64 兜底） | ★★★★☆ | M | 改造：Ant-col 已有 `fetchMedia`，把“失败再 base64”作为兜底即可 |
| 批量保存窗整套 Angular UI | ★★★☆☆ | L | 不建议整体搬；按上面 5 个零件拆 |
| `enlarge-proxy` 父窗往返 | ★★☆☆☆ | S | 不建议（绕路且每项 3s 超时）；Ant-col 可直接在后台做 |

---

## 5. 截图与裁剪

### 5.1 三种截图入口

| 功能 | 入口 | 实现 | 保存 |
|---|---|---|---|
| 可见区域 | Alt+3 / popup | 先测设备像素比 → `chrome.tabs.captureVisibleTab` → 关 Retina 时按比例缩回 1x（`js/lib/api/screen-capturer.js:116-150`） | `addFile` 或收集窗（`:141-148`） |
| 框选区域 | Alt+2 / popup | 先 `Cropper` 拿 rect → 再走滚动截图，`rect` 分支只截该块并逐屏拼接（`:151-159, 170-191`、`screen-capturer-scroll.js:64-68`） | 同上 |
| 整页 | Alt+4 / popup | `#updateDevicePixelRatio` → `ScreenCapturerScroll.start()`（`:160-163`） | 多张时 `title + " #n"`（`:192-241`） |

- 后台只负责 `captureCurrentTab`（`BackgroundScreenCapturer`，`:433-452`）；前台负责滚动、拼接、保存。
- 截图前给 `html` 加 `eagle-scrolling` 隐藏滚动条、`eagle-capturing` 隐藏浮层并禁用指针事件（`:164-169`；CSS `css/content.css`）。

### 5.2 滚动拼接算法（`screen-capturer-scroll.js`，520 行）

1. 选择滚动容器：优先 `documentElement`，否则扫描所有 `overflow:auto/scroll` 且可见、高度不超过视口的元素，按 `z-index`/`scrollHeight` 排序取第一（`:288-344`）。
2. 生成滚动位置序列：整页模式 = 每屏高 `innerHeight-200`（留 200px 重叠）网格化（`:69-73`）；框选模式 = 从选框底部向上按同一重叠步进（`:64-68`）。宽页面还会横向平铺（`:70-72`）。
3. 每步：滚动 → 隐藏 `position:fixed/sticky` 的浮动元素（两套启发式，`:345-504`）→ 暂停所有播放中的视频（`:150-155`）→ 记录 `{x,y,complete,totalWidth/Height,pixelRatio}` → 延迟 `captureDelay`（最小 0.5s Chrome / 0.3s 其他，`preference.js:95-102`）→ `captureVisibleTab` → 回调给上层。
4. **漂移校正**：自定义滚动容器在截图后发现实际 `scrollTop` 与预期差 >2px，则 1s 后重截当前屏（`:184-201`）。
5. 结束：恢复标题/滚动位置/浮动元素/视频（`:105-122`），进度胶囊由 CSS 动画显示（`#screen-capturer-progress`）。
6. 拼接（`screen-capturer.js:249-417`）：
   - 按 y 排序，剔除重叠（每张以首张最低 y 为基准）；
   - 按 `env.canvas.maxSide/maxArea` 限制（Chrome 旧版 32750/268435456，新版 65500/268435456；Firefox 32750/117418896；Safari 分版本，`js/lib/api/env.js:90-111`）**切成多段 canvas**，超限再二次分页；
   - `getImageData/putImageData` 逐段贴；
   - Firefox 多屏时扣 3px 重叠（`:306-311`）；
   - 关 Retina 时按 `force1xRatio` 缩回 1x（`:305-325`）。
7. 输出：每段 `toDataURL(png/jpeg)`；新版 App + 收集窗 → 逐张 `addFile`；否则逐张 `addScreenshot`（`:192-248, 137-152`）。

【坑】
- 隐藏浮动元素是纯启发式，可能误隐藏正文（如全屏遮罩类）；隐藏后靠 `[eagle-scrolling-hidden]` 恢复。
- 框选 + 内层滚动容器：`start(n)` 里只要传了 rect 就强制 `scrollElement=document.documentElement`（`screen-capturer-scroll.js:26`），**内层滚动容器里的框选会错位**。
- `captureVisibleTab` 频率受限（Chrome 配额），`captureDelay` 是硬性节流。
- 多段 canvas 拼接后如果保存失败，中间 canvas 只在 1s 后清理（`:242-247`）。

### 5.3 Cropper（`js/lib/cropper.js`，582 行）

- 入口：`captureArea()` 新建 `Cropper({onCropped})`（`screen-capturer.js:151-159`）。
- 结构：全屏 `#eagle-resize-tool` + jQuery UI resizable 选框 + 四个方向遮罩 + 十字线 + 尺寸气泡 + 保存/取消按钮（`:127-151`）。按钮永远贴在选框右下/上侧（`:164-189`）。
- 交互：
  - 拖动/缩放选框；`Shift` 锁定正方形（`:306`）；`Ctrl/Cmd` 悬停高亮并**吸附页面元素**（`getFilteredElementByPoint`），mouseup 时把选框对齐元素（`:278-329, 333-363`）。
  - 键盘：方向键移动 1px / Shift 10px / Ctrl 缩放 1px / Ctrl+Shift 10px / Ctrl+A 全选 / Enter 保存 / Esc 取消（`:5-25, 37-123`）。
  - 支持页面滚动时同步位置；拖到视口边缘自动滚动（`:451-459`）。
  - 截图期间暂停视频、恢复后重播（`:450, 461, 570-581`）。
- 输出 rect 是页面坐标（含滚动），再交给滚动截图按 `devicePixelRatio` 放大（`screen-capturer.js:249-263`）。
- 【坑】Mousetrap 全局绑定（`:39-122`），会与站点快捷键冲突，靠 `destroyCropArea` 解绑（`:464-492`）；`maxCropper` 直接量 `body/html` 最大尺寸（`:501-520`），对内层滚动容器同样不适用。

### 5.4 截图设置与像素比

- 偏好：格式 png/jpeg（`preference.js:32-33,103-108`）、Retina 开关（`:30`）、滚动延迟 0.3–5s（`:95-102`）。popup 全部可视化（`popup/popup.html:239-313`）。
- `#updateDevicePixelRatio`：截一张全屏图，用 `图宽/window.innerWidth` 反推比例；关闭 Retina 且比例 >1 时生成 `force1x` 信息，后续所有截图按比例缩回（`screen-capturer.js:93-115`）。

---

## 6. 来源增强与要素识别

### 6.1 `url-enlarger.js`（原图放大，731 行）

- **能力门控**：`isRunningInEagleApp`（Electron 内直接放行）或 `env.isAppSupportURLEnlarger`（旧 App 直接放弃放大，返回 `{url,largeUrl:null}`）（`:583-588, 589-603`）。
- **规则结构**：`{site, srcPattern, replace|replaceAsync, ignoreCheck?}`，共 **56 条**（`:3-582`）。覆盖：Reddit/deviantArt/Behance/imgur/Twitter/Bluesky/Midjourney/花瓣 4 版/大作/Lapa/Dribbble/Pexels/Tenor/微博/贴吧/豆瓣/pixAI/Flickr/poco 2 版/蘑菇街/Pinterest/pixiv/1688/淘宝/天猫/Amazon/京东/Houzz/HouseBeautiful/Officesnapshots/Archilovers/AD/Archdaily 中英文/Dezeen/Archiproducts/WordPress 通用/Squarespace/bilibili 专栏/阿里云 OSS/小红书/Medium 2 版/Artstation/GameUI 2 版/interiordesign/meiye/即刻/腾讯云 2 版。

**规则清单（按手法归类，行号指 `url-enlarger.js`）**

| 手法 | 站点数 | 典型规则 | 行号 |
|---|---|---|---|
| 目录/前缀替换（thumb→original） | 8 | midjourney `_N.webp→.png`；pixAI `/thumb/→/orig/`；GameUI `_list→_detail`；interiordesign 去 `easy_thumbnails/thumbs_`；Archdaily/Dezeen `thumb_jpg→large_jpg` | `:105-109,238-242,395-421,533-537,548-553` |
| 文件名尺寸标记删除（`_480x320`、`-800x600`、`_w_…,h_…`） | 9 | Behance 多种 `max_*`/`disp`→`/source/`；Dribbble 去 `_1x/_teaser`；1688/淘宝/天猫去 `_\d+x\d+`；京东去 `s\d+x\d+`；WordPress 去 `-\d+x\d+` | `:51-65,178-192,333-347,354-364,433-460` |
| query 参数删除/改写 | 8 | imgur `?maxwidth=99999`；Pexels `?auto=compress`；Squarespace `format=…w→3000w`；阿里云/腾讯云删 `x-oss-process`/`imageMogr2`/`imageView2`；meiye/即刻去 `?imageMogr2` | `:66-70,193-197,461-465,471-478,554-563,564-581` |
| 域名/路径整体替换 | 7 | Reddit preview→i.redd.it；微博 `cn/large`；贴吧 `abpic→pic/item`；豆瓣 `s/m/l→orginal`；Flickr `_n/_m/_s→_b`；x 小红书 `sns-webpic→sns-img-al`；Tenor `d/M→C` | `:5-20,203-237,243-247,479-489,198-202` |
| 异步 HEAD 探测（多候选取第一个 200） | 4 | Twitter `name=orig` 探 jpg/webp；Pinterest `originals` 探 jpg/png/webp/gif；pixiv 探 png/jpg 并跨扩展名；WordPress 探去尺寸版；Artstation `large/4k` 二选一（Image 加载探测） | `:71-99,265-298,299-332,433-460,500-532` |
| Token 内嵌 JSON 解码（deviantArt） | 1 | `?token` base64→JSON→`obj[0][0]` 宽高→改写 `w_,h_,q_100` | `:21-50` |
| `ignoreCheck`（不校验直接用） | 4 | 微博、pixiv、Artstation、部分规则 | `:206,302,503` |
| 通用兜底 | 3 | `AliyunOSS`/`腾讯云` 去处理参数；`WordPress 通用`；`Squarespace 通用` | `:471-478,564-581,433-465` |

> 校验策略：`ignoreCheck` 或该站点历史校验成功 → 直接用改写结果；否则 `#isURLExists`（扩展内 GET 200 / Electron 内 HEAD）失败则回退原图（`:643-666, 676-712`）。**56 条里 40+ 条是纯字符串改写，是 S 成本可搬的核心资产。**

- **执行流**：
  1. `isEnlargable`：排除 `data:image`、`blob:`，遍历规则 `new RegExp(srcPattern).test(url)`（`:629-642`）。【坑】规则里同时有正则字面量和“像 glob 的字符串”（如 `"https://cdn.dribbble.com/*"`），后者会被当成正则，语义变成“任意个 `/`”，不严谨；`"http?://img[d].*pocoimg*"` 只能匹配 `http`/`htt`，匹配不到 `https`（`:250`）。
  2. `#convertURL`：replace → 若结果没变/`ignoreCheck`/Electron 内/该规则此前校验成功 → 直接用；否则 `#isURLExists` 校验（GET 200），失败则回退原图并**清掉该站点缓存**（`:643-666`）。
  3. 校验实现：Electron 用 Node `https.get`；扩展内用 `new Image()` 加载（等于再下载一次，且受 CORS 限制）（`:676-712`）。`isValidImageURL` 在扩展内走 Image（`:683-687, 697-712`）。
  4. 每站点成功后置 `#ruleValidMap[site]=true`，后续同站不再校验（`:652-657`）。
- **超时**：`enlarge` 与 3s 定时器 `Promise.race`，超时记日志返回原图（`:589-603`）。`enlargeWithoutCheckEagleHasAbility` 跳过能力门控，用于“浏览器下载”模式（`:604-615`）。`enlargeBatch` 存在但全仓无调用（`:616-628`）。
- **调用点**：拖拽/右键（`js/content.js:26-29, 57-60`）、批量窗每项（`batch-saver-window/js/batch-saver-item.js:34`）、收集窗换图（`js/lib/collect-window.js:162-194`）、画板（`js/lib/board-saver.js:10-13`）、保存网址缩略图（无）。
- **移植建议**：把 56 条规则当**数据表**搬走即可（`site/srcPattern/replace` 都是纯函数），去掉 Electron 分支和 `urlTest` 后台通道；Ant-col 在 `background/media.js` fetch 前先跑规则，失败回退。成本 S，收益直接。

### 6.2 `site-parser.js`（站点标签/视频元信息，175 行）

- `getMeta()`：按 32 条 `{domain,selector,remove?}` 规则抽取标签（`:86-151`），返回 `{metaTags, metaDescription, metaKeywords, metaPicture}`（`:2-25`）。规则覆盖 instagram/behance/dribbble/500px/artstation/medium/land-book/deviantart/unsplash/pinterest/huaban/zcool/zhihu/archdaily 等。
- `getVideoMeta()`：识别 YouTube（`i.ytimg.com/vi/<id>/hqdefault.jpg` + `.ytp-time-duration`）、Bilibili（去 `@xxxw_xxxh` 后缀 + `player.bilibili.com` 嵌入 + 时长）、Vimeo（`.vp-preview` 的 `data-thumb` + `aria-valuemax`），返回 `videoID/videoThumb/videoDimensions/videoDuration/videoEmbed/videoMedium`（`:26-85`）。
- 【坑】`metaTitle` 缺失（§2.4）；YouTube 时长依赖播放器 DOM，未播放时为空。

### 6.3 `element-inspector.js`（元素识别与元信息，632 行）——本扩展最值钱的算法文件

**选元素**：
- `setTarget(event)`：优先 `event.target` 直接可收集；若是链接包含可收集元素（图片被 `<a>` 包着）则用 `elementsFromPoint` 找点下更内层元素（`:4-38`）；否则按坐标找（`:165-177`）。
- `#getAllElementsFromPoint`：**临时注入 `* {pointer-events:auto !important}` 的 style** 再 `elementsFromPoint`，并递归 `shadowRoot`，最后去重（`:136-164`）。完美解决“覆盖层挡住图片”的问题。
- `#findAcceptedElementByPoint`：对 `img:visible` 逐个算点是否在内 + 距离 − 1000×z-index 加权，取分数最小（`:178-195, 403-423`）。
- `isAcceptableElement`：`eagle-src`/`eagle-collectable` 直接通过；picture/svg；img 需可见、非 5×5、有 src、`pointer-events≠none`；canvas 需 2d 上下文；video/audio 排除 blob；`<a>` 记录 href（`:39-66`）；背景图需 `cover/contain/100%` 或非 repeat 且 >5px（`:54-65`）。

**取元信息 `getMeta(element,{context,parseBase64})`**（`:203-402`）：
1. `eagle-src/eagle-tags/eagle-type/eagle-link/eagle-title/eagle-annotation` 属性优先（`:205-219`，站点插件/自定义属性的入口）。
2. 按元素类型取 src：
   - canvas → `toDataURL`；svg → `XMLSerializer` + base64（`:226-231`）；
   - img：`<picture>` 取 source 的最大图；有 `srcset` 时 `#getHighestResImgFromElement` 取最大、同时把最小图存 `thumbnailURL`（`:232-239`）；src 是 1×1 占位但背景图是真图时取背景图（`:240-252`）；
   - 兜底 `currentSrc/src/querySelector("source")`（`:253-256`）；
   - 背景图：支持 `image-set()`（取最后一项）、`url("...")`、`%3csvg`、内联 `<svg>` 转 base64（`:257-279`）；
   - 仍无 → srcset 最大图（`:280`）；blob URL 用 fetch+FileReader 转 base64（`:196-202, 281-284`）。
3. **链接推断**：自身/祖先 `<a>` 的 href（排除 nofollow/noopener/_blank），同 host 或同根域直接用；否则用中心点 `elementsFromPoint` 找“包住元素的 a”（`:285-320`）；若 link 就是图片地址/图片扩展名则回退 `location.href`（`:324-343`）。
4. **插件合并**：`eagle.plugin.get(i.link)` → `getMeta(el)` 同步覆盖 → `getMetaAsync(el)`（10s 超时竞速，`eagle.utils.raceAbort`）再覆盖；批量上下文下 `disableBatchSaver` 的插件跳过 async（`:344-364`）。
5. 类型缺省（video/audio/image）、绝对化 URL、标题链：`customTitle → title → #getBestTitle → document.title → "untitled"`（`:365-384`）。
6. 返回 `{src, thumbnailURL, annotation, tags, url, title, elementType}`，blob 直接返回 null；`parseBase64` 且 App 支持且非 `eagle-src` 时用 `cacheHelper.toDataURL` 把图片转 base64（`:385-401`，下载模式跳过）。

**取大图/标题工具**（`:476-630`）：
- `#getHighestResImgFromElement` / `#getLowestResImgFromElement`：`<source>` 优先按类型排序（gif>png>jpeg>其他，`#getPictureSourceSrc:444-475`），再按 `w`/`x` 描述符排序取最大/最小（`:494-583`）。
- `#getBestTitle`：`eagle-title/customTitle/title/alt` → 文件名去扩展名；文件名是 hash/UUID/纯数字/无字母时回退 `document.title`；`"图片"` 或含 `https://` 时回退（`:584-630`）。
- `#isAnnoyingImage`：5×5 或面积 <10 判为无意义（`:434-443`）。

### 6.4 `element-collector.js`（批量扫描，191 行）

见 §4.2。值得单独记的点：
- `getIframeCollectableItems` 有前置优化：只有存在 `clientWidth² > 90000` 的 iframe 才发消息（`:18-35`）。
- ShadowRoot 递归只收 `IMG/VIDEO` 且带 src（`:36-63`）。
- SVG 序列化为 data URL（`:100-130`）；视频仅 mp4/webm（`:131-166`）。

### 6.5 `file-type-detector.js`（187 行）

- 前台：URL 后缀白名单（jpg/jpeg/png/gif/svg/webp/avif/mp4/webm），`data:image` 除外；有 query 时尝试从 query 再猜（`:1-60`）。
- 后台：`fetch` 看 `content-type/content-disposition`；`application/octet-stream` 时读 blob 前 16 字节做 magic number（JPEG/PNG/GIF/WEBP/AVIF/MP4/WebM）（`:62-169`）。
- 选择：扩展页/弹窗/收集窗/批量窗用前台，SW 用后台（`:170-186`）。
- 【坑】octet-stream 时会 `await d.blob()` 把整文件读进内存（`:77-84`）；大视频可能爆内存。

### 6.6 下载链：`downloader.js` + `bypass-downloader.js` + `base64-extractor.js` + `item.js`

**A. 浏览器下载模式（`downloadViaBrowser`，受 App 版本门控）**
1. `item.addFile`：若开启且 src 是 http → 不直接提交 41593，而是 `eagle.downloader.download(...)`（`js/lib/api/item.js:15-54`）。
2. 前台 `ForegroundDownloader`：`Queue` 并发 10；`tasks` 按 URL 去重（同一 URL 多次请求共享一次下载、回调追加）（`downloader.js:6-34`）；每次 `runtime.connect({name:id})`，后台回 `downloadViaIframe` 时插入隐藏 iframe（`:139-147`）。
3. 后台 `BackgroundDownloader`：**先 iframe 后 fetch**（`:287-327`）。iframe 路径利用 `webNavigation.onCommitted` 捕获子 frame 完成，再 `scripting.executeScript` 往该 frame 注入 `base64-extractor.js`（`:384-483`，extractor 内用 fetch+ReadableStream 读进度、FileReader 转 base64 写到 `data-base64`，`js/base64-extractor.js:1-56`）。fetch 路径直接流式读、转 base64（`:328-383`）。10s 超时、30s 任务超时（`:35-53, 248`）。
4. 回传：base64 按 60MB 切片经 port 发 `downloadResult`，最后 `downloadComplete`（`:299-316`）。
5. 落库：`item.addFile` 的 onComplete 里若 base64 含 `image/video` → `POST /api/item/addFromURL`，`url` 字段放 data URL（`item.js:27-49`）。失败回退 41593 原请求。
6. 进度 UI：页面右下角浮动任务列表（缩略图/视频预览 + 百分比），完成后淡出（`downloader.js:195-243`）。

**B. bypass-downloader（死了）**
- 设计：热链保护图片直接 fetch 会被拒，于是开 sandbox iframe 让浏览器自己加载 → 监听导航完成 → 在 frame 内 `fetch(location.href)` 转 blob URL 回传（`bypass-downloader.js:43-119`，frame 内注入逻辑 `:80-105`）。
- 全仓无调用者（grep 仅自身），且 `bypassDownloader` 只是被实例化（`:121-135`）。**不建议搬**：`webNavigation` + `scripting` + sandbox iframe 的成本和 MV3 兼容风险都不值得；Ant-col 的 `fetchMedia` 已有 Referer/凭证方案。

**C. 保存请求字段（`item.js`）**

| 方法 | 端点 | 关键字段 |
|---|---|---|
| `addFile` | 41593 表单 / 41595 addFromURL | `type:image, version, src, url, title, annotation, tags, star, folderID\|folderIDs, thumbnailURL, modificationTime, behavior` |
| `addBatchSaveFile` | 同上 | 同上 + `extendTags` 合并（`:56-136`） |
| `addScreenshot` | 41593 | `type:screen capture, title, url, base64`（`:137-152`） |
| `addURL` | 41593 | `type:save-url, title, url, base64, video*`（`:153-181`） |
| `batchSave`（旧） | 41593 | `type:import-images, url, images(JSON)`（`:182-211`） |

### 6.7 来源增强层坑汇总

| 坑 | 证据 |
|---|---|
| 规则字符串同时当正则用，个别规则写错（poco v1 https 不匹配） | `url-enlarger.js:250`；`isEnlargable:629-642` |
| 扩展内校验靠 `new Image()`，会二次下载且受 CORS/防盗链影响 | `url-enlarger.js:697-712` |
| 校验失败才回退，但 3s 竞速期间可能已让用户等待 | `url-enlarger.js:589-603` |
| 插件按 item 的 link 而不是页面 URL 匹配，跨站保存时行为可能变化 | `element-inspector.js:345` |
| `getMetaAsync` 统一 10s 超时，批量时最坏 10s/张（有 disableBatchSaver 缓解） | `element-inspector.js:351-363` |
| `file-type-detector` octet-stream 读全文件 | `file-type-detector.js:77-84` |
| `cacheHelper.toDataURL` 依赖新 App，否则静默返回 false | `cache-helper.js:6` |
| blob url 图片被 `getMeta` 判空丢弃（`src.startsWith("blob:")` → null） | `element-inspector.js:394-395` |

---

## 7. 站点插件体系

### 7.1 接口与注册（`js/lib/api/plugin.js:1-21`）

```js
class SitePlugin {
  disableBatchSaver = false;   // 批量扫描时是否跳过 getMetaAsync
  inject() {}                  // 在 document_end 注入时调用（打标/改 DOM/起定时器）
  getMeta(element) {}          // 同步覆盖 {src,title,link,annotation,...}
  getMetaAsync(element) {}     // 异步覆盖（站内 API / 页面 JSON）
}
eagle.plugin.register(domainRegex, pluginInstance);
eagle.plugin.get(link) → 首个匹配的 plugin
```
- 调用点：`element-inspector.getMeta`（`js/lib/api/element-inspector.js:344-364`）、`board-saver` 标题（`board-saver.js:93-107`，结果被丢弃）、收藏窗/批量窗间接。
- 注册语法：每个插件文件末尾 `new XxxPlugin(); eagle.plugin.register("regex", e); e.inject();`（如 `plugins/pinterest/pinterest.js:160-163`）。
- 插件脚本由 manifest 按站点单独注入，和主 content script 分属不同 `<script>`，但共享 `SitePlugin`/`eagle` 全局。
- 【观察】16 次 `register`、9 个文件真正注册；`500px`/`ezpay` 不注册（只 `inject`）；`archdaily/appstore/zcool` 只有 CSS。

### 7.2 逐站点表（15 个 JS 插件 + 3 个纯 CSS）

| 站点 | 文件 | disableBatchSaver | inject 做什么 | getMeta | getMetaAsync | 成熟度 |
|---|---|---|---|---|---|---|
| Pinterest | `plugins/pinterest/pinterest.js:1-163` | ✅ | ① 捕获 `dragstart` 把 closeup 图重派发给 DragSaver 的委托处理器（`:3-22`）；② 给多种视频容器打 `eagle-collectable`（`:23-37`）；③ SPA 路由 + MutationObserver 重扫（`:38-60`） | 用 `[data-grid-item]` 的 footer 链接/标题拼 `customTitle`（`:68-95`） | 调站内 `resource/PinResource/get/` 拿 `videos.video_list.V_720P.url`；HLS→mp4 多次 HEAD 探测（`:96-158`） | 高但脆（站内 API） |
| 小红书/Rednote | `plugins/xiaohongshu/xiaohongshu.js:1-138` | ✅ | 所有 video 打标；带 `play-icon` 的 note 封面标为 `eagle-type=video`（`:9-23`） | 从 `section` 的标题/作者拼标题（`:24-48`） | 抓笔记页 HTML，正则切 `"noteDetailMap":…,"serverRequestInfo":` 的 JSON，重试 10 次；取 EF7…EF4/h264/h265 最高档 `masterUrl`；过程中给元素加 `.eagle-breathing` 视觉反馈（`:75-131`） | 中（依赖页面结构） |
| Instagram | `plugins/instagram/instagram.js:1-200` | ✅ | 视频/`li video` 打标 + SPA（dialog/mount 变化）MutationObserver（`:3-60`） | 从 `article`/`a[href^="/p/"]` 取作者+alt 作标题（`:61-84`） | 短码 base64url→BigInt→media id；抓页面 `"appId"`；`i.instagram.com/api/v1/media/<id>/info/`（带 `x-ig-app-id`、cookies）取最高码率视频（`:85-195`） | 低（内部 API，易失效） |
| Twitter/X | `plugins/twitter/twitter.js:1-129` | ✅ | 视频/`videoComponent` 打标（`:3-16`） | `article` 里作者+正文作 `customTitle`，状态链接作 link（`:17-33`） | 调 `i/api/2/timeline/conversation/<id>.json`，**硬编码公开 bearer token** + csrf cookie；按图片/视频序号取 `extended_entities.media[n]`，选最高 bitrate mp4（`:34-93`） | 很低（旧端点+硬编码 token） |
| Midjourney | `plugins/midjourney/midjourney.js:1-42` | ❌ | 无 | lightbox 内 prompt 作 `annotation`，截断后作 `title`（非 ASCII 25 字符否则 50），追加 `@user`（`:9-23`） | 无 | 中 |
| Behance | `plugins/behance/behance.js:1-14` | ❌ | 无（CSS 负责 pointer-events/隐藏页脚） | `figcaption` 标题（`:2-9`） | 无 | 高（简单稳健） |
| Dribbble | `plugins/dribbble/dribbble.js:1-30` | ❌ | 无 | 检测 `data-video-teaser-original` 把图换成视频（`:3-25`） | 无 | 中 |
| 花瓣 | `plugins/huaban/huaban.js:1-26` | ❌ | 空 | 从 `.pin`/`.pin-view` 取描述作标题；`[F]` alt 特殊处理（`:3-21`） | 无 | 中（DOM 脆弱） |
| 淘宝/天猫 | `plugins/taobao/taobao.js:1-43` | ❌ | 无 | 按链接模式（doubleCard / m.taobao / item.taobao / view_image）取商品链接与标题（`:2-38`） | 无 | 中（选择器脆弱） |
| 微博 | `plugins/weibo/weibo.js:1-25` | ❌ | 无（CSS 修 pointer-events） | `article` 里作者+正文作 `customTitle`（`:2-19`） | 无 | 中 |
| Reddit | `plugins/reddit/reddit.js:1-12` | ❌ | 无 | `article` 第一个链接（`:2-7`） | 无 | 高（极简） |
| 500px | `plugins/500px/500px.js:1-71` | —（未注册） | 每 100 张 id 调 `api.500px.com/v1/photos?image_size[]=2048&ids=`，把 2048 原图写进 `eagle-src`（`:26-50`）；滚动/路由变化重跑（`:53-68`） | — | — | 中（站内公开 API） |
| Bing 图片 | `plugins/bing/bing.js:1-72` | ❌ | `m`/`data-m` JSON 里的 `murl/t` 写 `eagle-src/eagle-title`；SPA MutationObserver（`:6-38`） | 再解析一次 `data-m` 拿标题/src（`:51-67`） | 无 | 高 |
| YouTube | `plugins/youtube/youtube.js:1-18` | ❌ | 无 | 侧栏推荐视频的 `#video-title` 作标题（`:2-13`） | 无 | 低（场景很窄） |
| ezpay | `plugins/ezpay/ezpay.js:1-52` | — | **不是收藏插件**：支付页自动点选微信/支付宝、自动提交表单、隐藏页面（配 `ezpay.css`）；`location.href` 守卫（`:51-52`） | — | — | 与采集无关 |
| Archdaily | `plugins/archdaily/archdaily.css` | — | 纯 CSS：`.lazy-anchor{background-image:none}` 让懒加载图可拖 | — | — | 无逻辑 |
| App Store | `plugins/appstore/appstore.css` | — | 纯 CSS：去掉 `we-artwork` 的伪元素叠加，露出真图 | — | — | 无逻辑 |
| 站酷 | `plugins/zcool/zcool.css` | — | 纯 CSS：`-webkit-user-drag: initial`、禁用缩略图 `::after` 的 pointer-events | — | — | 无逻辑 |

### 7.3 共同模式/共同坑

**共同模式**：
1. **打标三件套**：`eagle-collectable`（允许识别）、`eagle-src`（直接指定原图 URL）、`eagle-type`（强制类型）——把“识别”从算法下放到站点 DOM。
2. **SPA 监听**：`setInterval(500/700/1000ms)` + `location.href` 变化 + MutationObserver，三件套反复出现（pinterest/instagram/bing/500px）。
3. **异步补全**：DOM 只能拿到缩略图时，用站内 API/页面内嵌 JSON 换原图；`getMetaAsync` 返回 `{src,title,...}` 与同步结果合并。
4. **视觉反馈**：小红书用 `.eagle-breathing` 呼吸动画标识“正在解析”（`xiaohongshu.js:89-98`，CSS `content.css`）。
5. **CSS 兜底**：站点用伪元素/覆盖层挡住图片时，用一行 CSS 让图片可拖（archdaily/appstore/zcool/weibo/behance/instagram）。

**共同坑**：
- 站内 API 的 token/端点/字段随时失效（twitter/instagram/xiaohongshu/pinterest），且没有自检/降级提示；失败只是静默回退。
- 轮询 `setInterval` 无清理、对每个页面常驻；`MutationObserver` 有时不 disconnect（instagram 分支）。
- 选择器大量依赖 `data-testid`/class 前缀（`Project-caption`、`Elements__PhotoCardWrapper`），站点改版即碎。
- `disableBatchSaver` 只跳过 async，同步 `getMeta` 仍会在批量扫描时执行 N 次（`element-inspector.js:344-363`），重 DOM 查询的插件会拖慢扫描。
- 插件按“item 的 link”匹配，而 `getMetaAsync` 里又用 `location.href`，两者可能不一致（跨域图片、`javascript:` 链接等）。

**对 Ant-col 的建议**：照抄**接口 + 打标属性**，插件只保留 5 个左右“纯 DOM、无站内 API”的（Bing/500px 式属性注入、Behance/Dribbble/Reddit 式标题/视频修正）；不搬内部 API 型插件。成本 S~M。

---

## 8. 基础设施与偏好

### 8.1 模块速览

| 模块 | 文件 | 职责 | 值得注意 |
|---|---|---|---|
| `env` | `js/lib/api/env.js` | OS/浏览器/画布上限/能力门控/就绪检测/主题 | 见 §1.4；`isBackground()` 启发式（`:196-215`） |
| `preference` | `js/lib/api/preference.js` | `shortcutsSettings`（macOS/Windows 两套）、主题、拖拽模式、黑白名单、截图设置、`usingCollect`、`downloadViaBrowser` | 默认值 `:7-36`；`storage.sync` 持久化；变更广播（`:136-148, 177-198`）；`isURLBlackList`（`:199-204`） |
| `storage` | `js/lib/api/storage.js` | chrome/browser storage 适配 | 只有 `sync/local` 两个实例（`:49-52`） |
| `queue` | `js/lib/api/queue.js` | 极简并发队列 + drain 回调 | 下载并发 10、画板 5（`downloader.js:166`、`board-saver.js:26`） |
| `tabs` | `js/lib/api/tabs.js` | 前台通过消息调后台 tabs API（因为内容脚本无 tabs 权限） | `sendMessage` 只回传 channel，不传 params（`:18-20`） |
| `i18n` | `js/lib/api/i18n.js` | 8 语言 JSON（en/es/de/ru/ja/ko/zh-CN/zh-TW），支持浏览器语言/覆盖 | 只 `fetch(locales/*.json)`；`changed` 只管 locale（`:55-63`） |
| `logger` | `js/lib/api/logger.js` + `js/vendors/logline.js` | 后台用 Logline + IndexedDB 存 7 天；前台经消息转发 | 每条日志都跨进程（`:60-62`）；`enableDebug` 无 UI 入口 |
| `log-viewer` | `log-viewer/app.js:1-109` | 扩展页查看日志、自动滚、点击复制、`fflate` 打包 zip 下载 | 靠 `logger.status()===2` 判断后台可读（`:103-108`） |
| `shortcut` | `js/lib/api/shortcut.js` + `js/modules/shortcut.js` + `popup/js/directives/shortcut-input.js` | Mousetrap 绑定；偏好变更时 `Mousetrap.reset()` 重绑；快捷键录入器（F1-F12、符号、Mac 符号展示） | 录入器会阻止重复键（`shortcut-input.js:80-86`） |
| `context-menu`（页面内） | `js/directives/context-menu.js` + `context-menu-items.html` | 通用数据驱动菜单：分隔/标签/色板/toggle/子菜单/搜索/排序/固定项/快捷键提示 | 见 §8.6 |
| `swal-dialog` | `js/lib/api/swal-dialog.js` | 用 iframe 承载 SweetAlert，绕开页面 CSP/样式 | 见 §5 与 §8.7 |
| `crypto` | `js/lib/api/crypto.js` | `crypto.randomUUID()` 兜底 | 1 行逻辑 |
| `extension` | `js/lib/api/extension.js` | `eagle.extension.path/manifest` | 所有 UI 拼路径依赖它 |
| `utils` | `js/lib/api/utils.js` | throttle/debounce/清字符/长文件名/URL/尺寸/base64 缩放/`raceAbort`/深度克隆/树遍历/同域判断 | 长文件名按 `isVersion4` 截 255 或 65（`:60-62`）；`clearWeirdCharacters` 去 emoji/非法字符（`:43-59`） |
| `vs-repeat` / `vs-grid-repeat` | `js/modules/vs-repeat.js:1-380`、`js/directives/vs-grid-repeat.js:1-309` | Angular 虚拟滚动/虚拟网格（二分查找可见区、绝对定位复用 DOM、ResizeObserver） | 几百行即实现高性能列表；Ant-col 若做批量网格可参考，但不必搬 Angular 版 |
| `angular-contenteditable` | `collect-window/js/modules/angular-contenteditable.js:1-128` | 受限 contenteditable（纯文本、去 br、maxlength、粘贴过滤、链接自动识别） | 收集窗标题/备注体验细节 |
| `tippy` / `stop-wheel` / `ng-right-click` | `js/modules/*` | 提示气泡、滚轮边界阻止（防止滚动穿透）、右键指令 | 小工具，可直接移植为原生实现 |

### 8.2 popup（动作菜单 + 偏好）

- 布局：一个 HTML 两种视图，`body.expand` 展开偏好（`popup.css`），`$root.showPreferences` 切换（`popup/popup.html:18-22, 447-578`）。
- 偏好项：主题（浅/深/跟随系统，`:42-121`）、语言（浏览器/8 语言，`:90-120`）、拖拽模式三选一（浮窗/底部/关闭，`:124-183`）、`usingCollect` 开关（`:185-202`）、`downloadViaBrowser` 开关（带版本不支持警告，`:204-235`）、截图格式/Retina/滚动延迟（`:239-313`）、5 个快捷键录入（`:315-401`）、自定义采集文档入口（`:403-424`）、下载调试报告（`:426-443`）。
- 动作菜单：保存画板（仅命中规则站点）、保存网址、批量保存、框选/可见/整页截图、按 URL/域名禁用拖拽、偏好入口（`:447-578`）。
- 拖拽禁用逻辑：读取当前 tab URL/hostname，与黑名单比对；选择“禁用 URL/域名”会写入偏好并保存（`popup/js/controllers/action.js:9-47`）。

### 8.3 右键菜单 API

见 §2.3：只有一个原生菜单项；无嵌套文件夹子菜单。页面内菜单是另一套（§8.6）。

### 8.4 日志/调试

- 后台 `Logline.using(INDEXEDDB)`、`new Logline("extension")`、保留 7 天、verbose 关闭（`js/lib/api/logger.js:72-84`）。
- 扩展启动时打印版本/UA/语言分隔块（`:80-84`），排障友好。
- popup“下载调试报告”→ 打开 `log-viewer/index.html?download=true`，5s 后自动关闭（`popup/js/controllers/preference.js:48-52`；`log-viewer/app.js:9-17, 56-85`）。

### 8.5 主题与样式

- 4 种主题变量（light/dark/gray/purple/dark-blue），通过 `[eagle-extension-theme=…]` 切换 CSS 变量（`css/content.css` 单行）；UI 根节点由 `content.js:3-14` / 各页面模板下发。
- 浏览器深色模式监听 `prefers-color-scheme`，变化时更新所有 `[eagle-extension]` 节点（`content.js:79-91`）。
- 【坑】CSS 全部手工维护、体积极大（见 §1.6），且主题变量与页面 UI 强耦合；Ant-col 若要移植，建议只抽“变量 + 关键组件类”，不要搬 300KB 级 CSS。

### 8.6 页面内 `context-menu` 指令（嵌套子菜单的真相）

- 数据结构：`{items:[{role?,label,icon?,image?,fallbackImage?,accelerator?,checked?,disabled?,submenu?,more?,pinned?,keepOpen?,click?,keywords?}], showSearch?, width?, sortable?, sortableHelper?, persistents?, onOpened?, onClosed?, onSorted?}`。
- 交互（`js/directives/context-menu.js`）：
  - 打开时过滤 `visible!==false`，递归过滤子菜单（`:117-150`）；
  - 有 `showSearch` 时显示输入框：输入即**压平搜索**（主菜单项 + 子菜单项，子菜单项前插入 label 分隔），过滤掉 role/子菜单/disabled（`:210-255`）；
  - 无搜索时支持**字母跳转**（500ms 内累积按键定位以该字母开头的项，`:182-195`）；
  - ↑↓ 选择、→ 打开子菜单、← 回根菜单、Enter/空格执行、Esc 关闭（`:159-209`）；子菜单在 hover 时打开（`hoverItem` → `p()`，`:69-72, 263-267`）；
  - 子菜单渲染：模板里递归 `<context-menu-items>`，靠 `#submenu-placeholder` + `autoPositionContextMenu` 计算位置（`context-menu-items.html:110-114, 247-261`；`context-menu.js:273-300`）；
  - 支持 SortableJS 拖拽排序（`:126-137`）、pin 固定（`:260-262`）、`role:color` 色板（模板 `:139-153`）、底部常驻项（`context-menu.html:25-63`）。
- 实际调用点只有 2 处：文件夹树右键（新建子/同级文件夹）、库切换菜单。
- 【坑】`left` 键直接回根菜单而不是父菜单（`:174`）；子菜单只在 hover 打开，键盘 → 可以，鼠标点击父项不会展开（`M()` 对带 submenu 的项直接不执行，`:76-81`）；`#submenu-placeholder` 的 id 在模板里出现两次（两个分支），靠 `ng-if` 保证同时只渲染一个。

### 8.7 对话框子系统（iframe SweetAlert）

- 原因【推断】：页面 CSP/样式会污染 SweetAlert，且内容脚本注入的 DOM 可能被站点重置；所以把 `sweetalert2` 放进扩展页 iframe（`js/lib/api/swal-dialog.js:18-26`），通过 `dialog-iframe-ready` → `swal-open` → `swal-confirm/swal-cancel` 握手（`dialog/controllers/dialog.js:30-71`）。
- 封装好的弹窗：新建文件夹（`:83-113`）、未开 Eagle（`:128-149`）、扩展被更新（`:150-162`）、隐私政策（Firefox，`:163-177`）、画板等待（`:178-192`，**无调用者**）。
- 【坑】`waitIframeReady` 没有超时（`:74-82`）；`open` 每次创建新 `<dialog>`，若前一个未关闭会叠加；`onConfirm` 用 `constructor.name==="AsyncFunction"` 判断是否 await（`:61-67`），跨环境不可靠。

---

## 9. 可复用性评级表

> 评级口径：**价值**看对 Ant-col（v1.2.1，原生 JS、MV3、FSA 本地库、单层项目）的收益；**成本** S=直接/少量改造、M=需要重写数据层或 UI、L=整套子系统移植。
> “依据”给的是 Eagle 侧位置；Ant-col 侧挂接点见附录 B。

| # | 功能/组件 | 价值 | 成本 | 建议 | 依据 |
|---|---|---|---|---|---|
| 1 | 文件夹树选择面板（树/最近/搜索/新建/多选/树线） | ★★★★★ | M | **搬**（去掉 41595、库切换、父窗新建） | `collect-window/js/directives/folder-select-panel.js:58-393` |
| 2 | 中文/拼音/繁简搜索（score + cartesian） | ★★★★★ | S | **搬**（引入 pinyinlite + chinese_convert 或更小替代） | `js/directives/select-panel.js:2-38`、`folder-select-panel.js:189-238` |
| 3 | URL 原图放大规则表（56 条） | ★★★★★ | S | **搬数据表**，去掉 Electron/41595 依赖 | `js/lib/api/url-enlarger.js:3-712` |
| 4 | 元素识别/取最大图/标题启发式 | ★★★★★ | S~M | **搬算法**到 `content/hover.js`/`media.js` | `js/lib/api/element-inspector.js:39-630` |
| 5 | 批量扫描三路 + 去重 + tracking pixel 过滤 | ★★★★★ | S | **搬** | `js/lib/element-collector.js:2-99`、`js/lib/iframe-batch-saver.js` |
| 6 | 批量面板过滤/排序/选择模型 | ★★★★☆ | M | 搬逻辑、重写 UI | `batch-saver-window/js/batch-saver.js:26-385` |
| 7 | 框选选择 `rect-selector` | ★★★★☆ | S | **搬**（修 destroy） | `batch-saver-window/js/directives/rect-selector.js:1-85` |
| 8 | 自动检测滚动加载 | ★★★★☆ | S | **搬**（套到 Ant-col 无限滚动站点） | `js/lib/batch-saver.js:237-294` |
| 9 | 每项就绪流水线（base64 兜底） | ★★★★☆ | M | 改造为“fetch 失败再 base64” | `batch-saver-window/js/batch-saver-item.js:33-133` |
| 10 | 整页滚动截图（隐藏浮层/暂停视频/漂移校正/画布分页） | ★★★★☆ | M | 改造进 `background/screenshot.js` | `screen-capturer.js:249-417`、`screen-capturer-scroll.js:1-520` |
| 11 | Cropper（元素吸附/键盘/滚动辅助） | ★★★★☆ | M | 改造（Ant-col 已有元素截图，可增强） | `js/lib/cropper.js:1-582` |
| 12 | 标签面板（搜索/最近/分组/新建/布局设置） | ★★★★☆ | M | 搬子集，砍星标/建议 | `js/directives/tag-select-panel.js:54-1045` |
| 13 | 拖拽浮层三态 + 最近文件夹直达 | ★★★★☆ | S~M | 改造 `content/drag-save.js` | `js/lib/drag-saver.js:95-399`、`content.js:32-50` |
| 14 | 文件夹 `extendTags` 自动标签 | ★★★★☆ | S | **搬** | `drag-saver.js:283-291`、`batch controller:137-145` |
| 15 | 站点插件接口（inject/getMeta/getMetaAsync/eagle-src） | ★★★★☆ | S | **搬接口**，只留 5 个 DOM 型插件 | `js/lib/api/plugin.js:1-21`、`element-inspector.js:344-364` |
| 16 | dHash/去重/命名/标题清洗 | ★★★☆☆ | S | 已有则对比；标题启发式可搬 | `element-inspector.js:584-630`、`utils.js:43-65` |
| 17 | 保存顺序（mtime 递减）/标题 `(n)`/批量 10 条 rAF | ★★★☆☆ | S | **搬** | `batch controller:146-201`、`batch-saver.js:397-417` |
| 18 | 收藏窗（预览/评分/备注/换原图） | ★★★☆☆ | M | 把评分/备注/换图并入现有保存面板，不搬 iframe | `collect-window/*` |
| 19 | Alt+右键快速保存 + 波纹 | ★★★☆☆ | S | **搬** | `js/lib/context-saver.js:12-82` |
| 20 | 页面内通用 ContextMenu（子菜单/搜索/排序/固定） | ★★★☆☆ | M | 若需要右键菜单再搬（否则用原生菜单） | `js/directives/context-menu.js:1-300` |
| 21 | 下载代理链（iframe→fetch→base64） | ★★★☆☆ | M | 只借“失败回退”思路 | `downloader.js:245-484`、`base64-extractor.js` |
| 22 | iframe SweetAlert 子系统 | ★★☆☆☆ | M | 不建议（Shadow DOM 更轻） | `swal-dialog.js`、`dialog/` |
| 23 | UI 隔离范式（属性作用域/dialog/主题变量） | ★★★★☆ | S | **借模式**，不搬 300KB CSS | `content.js:3-15`、`content.css` |
| 24 | vs-repeat/vs-grid-repeat 虚拟化 | ★★★☆☆ | M | 若做批量网格可借算法 | `js/modules/vs-repeat.js`、`vs-grid-repeat.js` |
| 25 | 日志 + log-viewer | ★★☆☆☆ | M | 后台 ring buffer 自研更轻 | `logger.js`、`log-viewer/` |
| 26 | 站点插件具体实现（twitter/instagram/xiaohongshu/pinterest） | ★☆☆☆☆ | — | **放弃** | `plugins/*` |
| 27 | `board-saver` 实现 | ★☆☆☆☆ | L | 只借滚动采集思路 | `board-saver.js:31-223` |
| 28 | `bypass-downloader` | ☆☆☆☆☆ | — | **放弃（死代码）** | `bypass-downloader.js:121-135` |
| 29 | `ezpay` 支付自动点击 | ☆☆☆☆☆ | — | **放弃（与采集无关）** | `plugins/ezpay/ezpay.js:1-52` |
| 30 | 双 API/41593/41595/能力门控 | ☆☆☆☆☆ | — | **放弃**（Ant-col 无宿主 App） | `env.js:144-180`、`item.js` |
| 31 | AngularJS + jQuery UI 全家桶 | ★☆☆☆☆ | L | **不搬框架**，只搬算法/交互 | `collect-window/index.html:205-235` 等 |
| 32 | 库切换 / 多库 | ★☆☆☆☆ | S | 放弃 | `library-switcher.js` |

### 9.1 三个阶段化落地建议（给方案引用）

1. **P0（1~2 周，S 为主）**：URL 放大规则表 + 元素识别/取大图 + 保存顺序技巧 + Alt 快速保存 + 标题清洗。
2. **P1（2~3 周，M）**：文件夹树面板 + 标签面板子集 + `extendTags` + 拖拽“最近文件夹直达” + 截图隐藏浮层/暂停视频/漂移校正。
3. **P2（3~6 周，L，按需）**：批量保存窗（拆成扫描/过滤/框选/保存四步）+ Cropper 增强 + 虚拟网格。

---

## 10. 未解、边界与不建议照抄

### 10.1 未解/未知（需要运行时或宿主侧证据）

1. **41593/41595 的服务端语义**：本文只从扩展请求侧确认字段；App 如何解析 `forceOpenCollectModal/forceHideCollectModal`、`behavior`、`folderIDs` 的多归属行为，属于主程序侧（见 `eagle-static-analysis.md`），未在本任务验证。
2. **重复注入的实际后果**（§1.1）：是否真的抛 `SyntaxError`、`batch-save-iframe` 是否重复响应——需加载扩展实测。
3. **`clipboard.readText()` 在浏览器扩展页是否可用**：`clipboard` 是 Electron 全局，扩展页大概率 `ReferenceError`；影响标签面板“粘贴批量创建”。
4. **插件内部 API 的存活状态**：Twitter 旧 endpoint、Instagram `x-ig-app-id`、Pinterest `PinResource`、小红书页面 JSON 结构均可能已变化；本文只描述“代码意图”。
5. **Firefox/Safari 分支**：`background.html`、MV2 分支、Firefox 3px 拼接补偿、Safari 焦点轮询——只读到代码，未验证。
6. **`fetchLargeJSON` 的真实动机**：代码注释缺失，只能推断为规避大对象消息序列化/解析。
7. **CSS 无法给行号**：`content.css`/`collect-window.css`/`popup.css` 等均为单行压缩，本文只给文件名。
8. **i18n 覆盖度**：`locales/en.json` 184 条；部分 key（如 `folder-select-panel.tabs.*`、`general.r-click`）只被 batch 版/提示使用；未逐 key 核对死键。

### 10.2 不建议照抄的清单（明确）

- 41593/41595 双服务、`fetch` 转发、`tabs` 转发、`runtime` 分块：Ant-col 无宿主 App，直接 `chrome.*` + 自身消息即可。
- buildVersion 能力门控与“旧 App 降级”分支：无意义，删掉能少 1/3 分支。
- AngularJS + jQuery + jQuery UI + vs-repeat：技术栈债务，只搬算法。
- 300KB 级单文件 CSS、4 套重复样式：改用 CSS 变量 + 组件级样式。
- `setInterval` 轮询站点 DOM 的插件实现：改用 MutationObserver + 节流，且必须清理。
- 站点内部 API 抓取：不搬；保留 DOM 型 `getMeta` + `eagle-src` 打标即可。
- `alert()` 收尾、无超时的 iframe 握手、`endpoint` 硬编码 token：反模式。

### 10.3 值得带进 Ant-col 的“工程习惯”

1. 所有外部输入（标题/文件名）统一清洗 + 长度上限（`utils.js:43-65`）。
2. 所有跨域资源统一走一个 `fetch` 包装（超时/重试/Referer/凭证/大小限制）。
3. 所有站点增强都通过“属性打标 + 插件注册表”，不把站点逻辑写进主流程。
4. 所有长任务都有进度 UI 与取消入口（下载浮条、批量进度胶囊、滚动截图进度条）。
5. 所有模态都有 Esc/点空白关闭 + 焦点回收。
6. 所有“用户排序/布局”偏好都持久化（localStorage/storage.sync）。
7. 对“图片是否原图/是否存在”做验证缓存，避免每次保存都等待。
8. 采集与保存分离：采集只管 `{src,title,url,x,y,w,h}`，保存层再决定下载/转换/入库。

---

## 附录 A：已知 bug / 死代码清单（便于避坑）

| # | 位置 | 现象 | 影响 |
|---|---|---|---|
| A1 | `js/lib/api/bypass-downloader.js:121-135` | `eagle.bypassDownloader` 无任何调用者 | 死代码 + 多余权限 |
| A2 | `js/lib/api/url-enlarger.js:616-628` | `enlargeBatch` 无调用者 | 死代码 |
| A3 | `js/lib/api/swal-dialog.js:178-192` | `showBoardSaverKeepWaitingDialog` 无调用者 | 死代码（画板等待体验缺失） |
| A4 | `collect-window/js/directives/folder-select-panel.js:330-368` | `createFolder/onCreatedFolder` 依赖全局 `swal/i18n` | 浏览器内不可用（实际走父窗 dialog） |
| A5 | `js/lib/board-saver.js:93-107` | 插件 `getMeta` 返回值被丢弃 | 画板标题解析不生效 |
| A6 | `js/lib/board-saver.js:200-202` | `document.querySelector("title").text` | 标题兜底失效（应为 textContent） |
| A7 | `js/lib/api/site-parser.js:18-23` + `js/lib/url-saver.js:66-69` | 无 `metaTitle` 字段 | 保存网址标题总回退 document.title |
| A8 | `js/directives/tag-select-panel.js:64,76,132` | `pinSelected` 无使用 | 配置项无效 |
| A9 | `js/directives/tag-select-panel.js:224-226` + 调用方 | `starredTags` 从未传入 | 星标组永远空 |
| A10 | `js/directives/tag-select-panel.js:236-237` + 调用方传 `[]` | `suggestions` 恒空 | 建议组永远空 |
| A11 | `collect-window/js/controllers/collect.js:125-131` | payload 白名单不含 `url` | 收集窗保存丢失 `url`（只保留 src/title/annotation/tags/folderIDs/star）——【观察】`addFile` 需要 `url` 作为来源，实际由 `{...meta,...result}` 里 meta 提供，不算 bug |
| A12 | `js/lib/collect-window.js:84` | `if (l.folderID) throw new Error("choose")` | 结果字段是 `folderIDs`，该分支不可达（死代码） |
| A13 | `collect-window/js/directives/folder-select-panel.js:14` | `isMultipleSelect` 未使用 | 无效字段 |
| A14 | `js/directives/context-menu.js:174` | ← 键回根菜单而非父菜单 | 交互瑕疵 |
| A15 | `js/directives/context-menu-items.html:111-114, 237-240` | 两处重复 `id="submenu-placeholder"` | 依赖 ng-if 只渲染一个，脆弱 |
| A16 | `batch-saver-window/js/directives/rect-selector.js:79-83` | `h.off("mousedown", null)` 解绑无效 | 潜在监听泄漏 |
| A17 | `js/lib/api/file-type-detector.js:77-84` | octet-stream 读整个 blob | 大文件内存风险 |
| A18 | `manifest.json:9-28` | 重复注入 element-inspector/collector/iframe-batch-saver；②③站点重叠 | 控制台错误/重复监听风险【未知】 |
| A19 | `js/lib/api/screen-capturer.js:9-12` | `debugCanvas` 未使用 | 死代码 |
| A20 | `js/lib/api/screen-capturer-scroll.js:26` | 有 rect 就强制 `scrollElement=documentElement` | 内层滚动容器框选错位 |
| A21 | `css/content.css`（单行） | 存在 `#eagle-extension-collect-preview` 一整套样式，但无 JS 创建该节点（grep 无） | 旧版预览 UI 残留 |
| A22 | `js/lib/api/logger.js:68-70` 等 | `enableDebug` 无 UI 调用 | 调试日志开关不可达 |
| A23 | `js/lib/api/site-parser.js:22` | `metaPicture` 返回但无人使用 | 无效字段 |
| A24 | `batch-saver-window/js/batch-saver.js:108-119` | `Object.entries(...).forEach` 里 `[e,,]` 解构 + 重新赋值 available | 写法怪异（结果正确） |

---

## 附录 B：Eagle 功能 → Ant-col 挂接点（供方案引用）

> Ant-col 侧我只做“文件名级”指向（详细行号见 `docs/research/antcol-current-state.md`），避免与主报告冲突。

| Eagle 功能 | Ant-col 可挂接位置 | 备注 |
|---|---|---|
| 取最大图/元素识别 | `content/hover.js`、`background/media.js` | Ant-col 已有 `elementFromPoint`/shadow 处理，可补 srcset/picture/背景图/标题启发式 |
| 原图放大规则 | `background/media.js`（fetch 前）或 `background/save.js` | 纯函数，S |
| 文件夹树面板 | `content/drag-save.js`（保存面板）+ `library/library.js`（组织视图） | 需先在数据层把单层项目升级为 folder 树（P0-3） |
| 标签面板 | `content/drag-save.js`（保存面板）+ `library/library.js`（筛选） | Ant-col 已有 tags 字段（`save.js`），缺输入体验 |
| 最近文件夹/`extendTags` | `content/drag-save.js`、`background/save.js`（自动标签合并） | 需扩展配置模型 |
| 批量扫描/过滤/框选 | `popup/popup.js`（扫描）+ 新页面/弹层（批量网格） | 可先做“扫描+过滤+全选”，后做框选/虚拟化 |
| 滚动截图增强 | `background/screenshot.js` | 补隐藏浮层/暂停视频/漂移重试/画布上限 |
| 裁剪器增强 | `background/screenshot.js` + `content/hover.js` | Ant-col 已有元素截图，可补吸附/键盘/滚动辅助 |
| 保存顺序/标题去重 | `background/save.js` + `background/naming.js` | mtime 递减 + `(n)` |
| 站点插件/`eagle-src` | `content/hover.js`（识别）+ 新增 `content/site-plugins/` | 建议只做 3~5 个 DOM 型 |
| 拖拽三态/Alt 快速保存 | `content/drag-save.js`、`content/hover.js` | 低成本体验提升 |
| UI 隔离/主题变量 | `content/` + 各 UI 页 CSS | 借模式，不搬体积 |

---

### 附：本次盘点的“数字速查”

- 非 vendor 格式化文件：**103**（js 75 / html 28）。
- `manifest.json` content_scripts：**21 个 entry**（3 个主批次 + 18 个站点插件/样式）。
- 站点插件：**15 个 JS**（16 次 `register`，9 个文件注册）+ **3 个纯 CSS**（zcool/archdaily/appstore）；`ezpay` 为支付辅助，不计入采集。
- `url-enlarger` 规则：**56 条**。
- `site-parser` 标签规则：**32 条**。
- 偏好项：快捷键 5 个 + 拖拽模式 3 态 + 截图 3 项 + 主题/语言 + 2 个采集开关。
- 支持语言：**8**（en/es/de/ru/ja/ko/zh-CN/zh-TW）。
- 原生右键菜单项：**1**（无文件夹子菜单）。
- 实体 UI 面：popup、collect-window、batch-saver-window、dialog、log-viewer、eagle-opener、页面内拖拽浮层、页面内右键菜单、下载进度条、画板进度条、自动检测进度条、裁剪器 —— 共 **12 个**。
