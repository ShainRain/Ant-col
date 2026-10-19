# Ant-col 终极修改优化方案

> 本方案合并三条证据线：
> ① Eagle 浏览器扩展 3.1.26 全量逆向（REA 应用图 + 103 个格式化源文件 + 运行时数据）；
> ② 前序《[Eagle 逆向 × Ant-col 优化方案](eagle-optimization-plan.md)》（库/保存路径层）；
> ③ Ant-col v1.2.1 现状审计（[扩展功能对照](research/antcol-features-gap.md)、[运行期基线](research/antcol-current-state.md)）。
>
> 目标不是“变成 Eagle”，而是：**保留 Ant-col「纯扩展、无客户端、无端口、文件即库」的核心优势，吸收 Eagle 扩展真正高价值的交互与算法，把采集 → 归类 → 整理 → 找回 → 交付做成一条闭环。**
>
> 证据边界见 §8；Eagle 扩展的逐条机制见 [eagle-extension-features.md](research/eagle-extension-features.md)，主程序保存路径见 [eagle-static-analysis.md](research/eagle-static-analysis.md) 与 [eagle-runtime-probe.md](research/eagle-runtime-probe.md)。

---

## 0. 终局定义（TL;DR）

### 0.1 目标形态

```text
网页任意图片/视频/链接/页面
  →（2 次交互内）入库：项目（可多选）+ 标签 + 星级 + 备注
  → 收件箱 Inbox：逐张/批量整理
  → 素材库：项目树 / 智能集合 / 评分 / 颜色 / 时间 / 全文搜索
  → 交付：复制路径 / 定位文件 / Markdown/CSV / 迁移 Eagle
```

**“终极”的五条验收线**（可量化，逐版本勾选）：

| # | 验收线 | 目标 |
|---|---|---|
| A1 | 采集路径 | 任意网页图片/视频/链接 ≤2 次交互入库，且可指定项目（多选）/标签/星级 |
| A2 | 库可靠性 | 清空浏览器扩展数据后，可由磁盘 sidecar 重建整个库；缩略图离线可见 |
| A3 | 规模 | 5000 条素材：库首屏 <500ms、排序切换 <100ms、批量保存线性 |
| A4 | 找回 | 项目树/多归属/评分/颜色/日期语法/智能集合全部可用 |
| A5 | 迁移 | 可导入 Eagle `.library`，可导出 `.eaglepack`，sidecar 可读可脚本化 |

### 0.2 Eagle 扩展教给我们的 5 件事

| # | 洞察 | Eagle 证据 | Ant-col 现状 |
|---|---|---|---|
| 1 | **采集必须“一步归类”** | 拖到文件夹即入库（`drag-saver.js:190-235` + `content.js:32-50`）；`folder-id=""`/`"choose"`/真实 id 三态 | 拖拽落项目后仍弹面板再点保存（`content/drag-save.js:362-378`） |
| 2 | **采集面板是“可编辑的收件单”** | 收集窗：预览/标题/备注/标签/星级/文件夹树/切库（`collect-window/index.html:20-185`） | 面板有标题/标签/备注/项目，缺星级、多项目、最近、标签历史 |
| 3 | **批量是“工作台”不是弹窗** | 三路扫描（DOM/iframe/Shadow）+ 自动滚动发现 + 框选 + 缩放 + 视频悬停 + 10 条/批（`js/lib/batch-saver.js`、`batch-saver-window/`） | popup 网格，无视频预览/失败重试/目标项目/框选 |
| 4 | **素材质量取决于“取哪张图”** | element-inspector 取 srcset 最大图、背景图/image-set、blob→base64、canvas/svg 序列化、链接推断；url-enlarger 56 条站点规则 | 已有基础识别，缺 srcset 最大图/背景 image-set/blob/站点放大 |
| 5 | **能力门控与降级** | 按 App `buildVersion` 开闭收集窗/浏览器下载/放大（`env.js:24-52`） | 无宿主 App，不需要；但需要“无权限/下载模式/离线”降级矩阵 |

### 0.3 要做 / 不做 / 缓办（一句话）

- **做**：采集即归类（项目树/多归属/星级/extendTags）、收集面板 2.0、元素识别与 URL 放大、批量工作台、截图裁剪、数据层 v3（可重建 + 缩略图落盘）、排序/评分/色板/回收站、Eagle 导入导出。
- **不做**：本地服务/端口、多库切换、Eagle 深链/本地 API、21 站点适配器生态、board-saver 站点抓取、站点内部 API 抓取、AngularJS/jQuery 技术栈、i18n（当前单用户中文）。
- **缓办**：完整日志查看器（先做轻量诊断）、快捷键编辑器（先只读展示）、i18n、XMP、主题系统。

---

## 1. 证据与方法

| 对象 | 身份 | 证据 |
|---|---|---|
| Eagle 扩展 | 3.1.26（Edge，MV3），目录 SHA-256 `7efbfff4…61aaf` | REA `analyze_javascript_application`：`ev_4c3accfe…`（102 个 JS、221 模块、覆盖 partial）；模块页 `ev_35d3cbeb…` |
| Eagle 主程序 | 4.0.0 build 20260401，app.asar SHA-256 `a33a48f2…173a2` | REA `ev_9fb963e4…`；静态报告 746 行 |
| 扩展源码 | `D:\eagle-ext-raw\`（103 个非 vendor 文件，prettier 格式化） | 逐文件精读，`文件:行号` 以此为准 |
| 运行时库 | `D:\eagle-probe\probe.library` 47 条 item | 运行时报告 14 节 + `evidence/` |
| Ant-col | v1.2.1 / git `a5b366a`，运行期 16 文件 4773 行 | [antcol-current-state.md](research/antcol-current-state.md)（326 处引用）、[antcol-features-gap.md](research/antcol-features-gap.md)（30 项矩阵） |

> 方法边界：Eagle 扩展只做静态精读，未在浏览器中实际点击；Eagle 主进程 `.jsc` 不可反编译，41593 服务端语义由运行时探针补齐。Ant-col 的“已有”判定基于代码路径 + 既有 e2e 产物，未复跑 e2e。

---

## 2. Eagle 扩展功能全景（18 个亮点）

> 价值按“对 Ant-col 主链路”评；成本 S≈≤1 天、M≈1–3 天、L≈>3 天。完整版见 [eagle-extension-features.md §0](research/eagle-extension-features.md)。

| # | 亮点 | 机制要点 | 证据（`D:\eagle-ext-raw\`） | 价值 | 成本 | 结论 |
|---|---|---|---|---|---|---|
| 1 | 文件夹树面板 | `tree.walk` 拍平 + depth/树线；`ALL/RECENT/SELECTED` 三 tab；最近排序（拖拽浮层 ≤16、收集窗 RECENT 最多 20）+ 已选优先；拼音/繁简/模糊搜索；搜索即新建；Ctrl 多选；折叠记忆 | `collect-window/js/directives/folder-select-panel.js:58-393`、`...html:1-172` | ★★★★★ | M | **搬**（去切库/父窗新建） |
| 2 | 批量保存窗 | 三路扫描（主文档/iframe/ShadowRoot）→ 按 src 去重 → 尺寸/格式/域名过滤 → 虚拟网格 + 框选 + 视频悬停 + auto-detect + 10 条/批 | `js/lib/batch-saver.js:184-351`、`batch-saver-window/js/controllers/batch-saver-window.js:96-478` | ★★★★★ | L（拆 4 步） | **分批搬** |
| 3 | 元素识别/取最大图 | srcset/picture/source 按 w/x 取最大；背景图/`image-set`/内联 SVG/canvas 序列化；blob→base64；`elementsFromPoint` + shadow + z-index 加权；链接推断；标题回退链 | `js/lib/api/element-inspector.js:39-630` | ★★★★★ | S~M | **搬算法** |
| 4 | URL 原图放大 | **56 条** `{site,srcPattern,replace|replaceAsync}` 规则；命中改写 → HEAD/Image 校验（按站点缓存成败）→ 3s 竞速回退 | `js/lib/api/url-enlarger.js:3-712` | ★★★★★ | S | **搬数据表** |
| 5 | 收集窗 | `<dialog>` + 全屏 iframe；预览（自动换原图/更新尺寸）/标题/备注/标签/5 星/文件夹树/切库；postMessage 双向协议 | `js/lib/collect-window.js:1-206`、`collect-window/js/controllers/collect.js:117-367` | ★★★★☆ | M | **改造并入现有面板** |
| 6 | 标签选择面板 | 历史(12)/分组/侧栏计数；搜索压平 + 相似度排序（Levenshtein/包含/前缀）；新建；布局/列宽持久化。**坑：星标/建议无数据源是空 UI；粘贴用 Electron `clipboard` 在浏览器不可用** | `js/directives/tag-select-panel.js:54-1045` | ★★★★☆ | M | **搬子集**（历史/分组/搜索/新建；砍星标/建议/粘贴） |
| 7 | 整页滚动截图 | 200px 重叠网格 + 隐藏 fixed/sticky + 暂停视频 + 漂移>2px 重截 + `env.canvas` 上限分段 | `screen-capturer-scroll.js:1-520` | ★★★★☆ | M | **改造** |
| 8 | 裁剪器 | jQuery UI 选框；Ctrl 吸附元素；方向键/Shift 微调；边缘自动滚动；全选/ESC/回车 | `js/lib/cropper.js:1-582` | ★★★★☆ | M | **改造** |
| 9 | 下载代理链 | 前台 port 任务（并发 10/URL 去重）→ 后台先隐藏 iframe 后 fetch → 注入 base64-extractor 流式读 → 60MB 分块回传 → `addFromURL` data URL；失败回退 41593 | `downloader.js:245-484`、`base64-extractor.js:1-56`、`item.js:15-54` | ★★★☆☆ | M | **借“失败回退 + base64 兜底”** |
| 10 | 站点插件体系 | `SitePlugin{inject,getMeta,getMetaAsync,disableBatchSaver}` + `register(regex)`；`eagle-src/-tags/-type/-title/-link/-annotation` 属性优先 | `js/lib/api/plugin.js:1-21`、`element-inspector.js:205-219,344-364`、`plugins/*` | ★★★★☆ | S（接口） | **搬接口，只留 5 个 DOM 型** |
| 11 | 拖拽浮层三态 | `dragMode 0/1/2`（关/浮动面板/底部条）；首次拖动拉最近文件夹(≤16)；`folder-id` 三态；`extendTags` 随文件夹附加；拖图预览；URL/域名黑名单 | `js/lib/drag-saver.js:95-399`、`content.js:21-52`、`env.js:48-52` | ★★★★☆ | S~M | **改造** |
| 12 | Alt+右键快速保存 | 右键坐标距离>5px 判拖动；Alt+右键 150ms 后波纹 + 直接保存；普通右键走原生单项菜单 | `js/lib/context-saver.js:12-82`、`api/context-menus.js:16-25` | ★★★☆☆ | S | **搬** |
| 13 | 批量 auto-detect | 隐藏面板 → 页面进度胶囊 → 每 500ms 采集 + 按 src 去重 → Esc/D 停止 → 恢复面板 | `js/lib/batch-saver.js:237-294` | ★★★★☆ | S | **搬** |
| 14 | 保存顺序工程 | 视觉顺序 → 标题重名 `(n)` → `modificationTime` 递减 → 每 10 条 postMessage + rAF；`extendTags` 合并去重 | `batch-saver-window/js/controllers/batch-saver-window.js:146-201` | ★★★☆☆ | S | **搬** |
| 15 | UI 隔离范式 | `[eagle-extension]` 属性作用域 + CSS 变量主题 + `<dialog showModal>` 全屏 iframe + `body.eagle-show-*{pointer-events:none}` + z-index 2147483647 | `js/content.js:3-15`、`css/content.css`（单行） | ★★★★☆ | S | **借模式**（不搬 300KB CSS） |
| 16 | 能力门控 | `buildVersion >= 20230901/20240222/20241106` 开闭放大/收集窗/浏览器下载 | `js/lib/api/env.js:24-52` | — | — | **不搬**（无宿主） |
| 17 | 偏好与快捷键 | 拖拽模式/开关/URL+域名黑名单/5 个采集快捷键(Alt+0..4)/Retina/延迟/格式/主题/语言 | `js/lib/api/preference.js:7-36` | ★★★☆☆ | S | **部分搬** |
| 18 | 日志/诊断 | logger + `log-viewer/`（4 级、下载日志） | `js/lib/api/logger.js`、`log-viewer/` | ★★☆☆☆ | S/M | **缓**（先做轻量诊断） |

**明确不搬（Eagle 侧已核实的反模式）**：

| 项 | 原因 |
|---|---|
| `bypass-downloader.js` | **死代码**：全仓无调用者，却引入 `webNavigation` + `executeScript` + sandbox iframe，MV3 风险/收益比极差 |
| `board-saver` 实现 | 规则从远端 JSON 拉取、选择器硬编码、`alert()` 收尾、依赖站内滚动，脆弱 |
| twitter/instagram/xiaohongshu/pinterest 的 `getMetaAsync` | 硬编码 bearer token / appId / 页面内嵌 JSON，高维护债；只留 DOM 型 `getMeta` |
| 21 个站点适配器全量 | 规则生态是负资产；用“通用提取器 + URL 规则 + 5 个 DOM 插件”替代 |
| 41593/41595 双服务、buildVersion 门控、AngularJS/jQuery | Ant-col 无宿主 App，技术栈不同 |

---

## 3. 与 Ant-col 的差距（30 项压缩版）

> 完整矩阵见 [antcol-features-gap.md §2](research/antcol-features-gap.md)。统计：**已有 7 / 部分 13 / 缺失 10**。

### 3.1 三个必须先纠正的认知

1. **Eagle 原生右键菜单只有 1 项**（`context.all`，`api/context-menus.js:17-24`），点它给页面发 `context-save`，由页内 ContextSaver 决定保存目标。所谓“右键按文件夹保存”在 Eagle 里并不存在——真正实现“归类”的是**拖拽浮层 + 收集窗**。Ant-col 已有 4 个右键菜单项（图/视频/链接/页），在这方面**不落后**；差距是“入口不能选项目”。
2. **Ant-col 的页内 UI 已是 Shadow DOM**（`content/hover.js:160-190`、`drag-save.js:225-344`），UI 隔离范式与 Eagle 同级，**不要重写成 iframe**；收集面板只需在 Shadow DOM 内扩展。
3. **“21 站点适配 + 收藏板抓取”不是必须补的差距**，而是应主动放弃的负担。真正值得搬的是“取最大图/换原图”的**算法与规则表**，不是站点逻辑生态。

### 3.2 按工作流的差距

| 工作流 | Ant-col 现状 | Eagle 水准 | 差距 |
|---|---|---|---|
| 单张采集 | 拖拽/Alt+S/右键/截图 11 入口，统一 `saveItems` | 入口相近，但拖到项目=直接入库 | **入口不能一步归类**；拖拽后必弹面板 |
| 采集面板 | 标题/多标签/备注/项目（`drag-save.js:604-956`） | + 星级/文件夹树/最近/标签历史/切库 | 缺星级、多项目、最近、标签历史 |
| 批量 | popup 网格 + 尺寸筛选（`popup.js:170-312`） | 全屏工作台 + 三路扫描 + 自动滚动 + 框选 + 视频预览 + 失败重试 | 差一个量级 |
| 截图 | 可见/元素/整页（有 16000px/80 tile 上限） | + 裁剪编辑器 + 元素吸附 + 滚动健壮性 | 缺“截好” |
| 原图质量 | 通用识别，无站点放大 | srcset 最大图 + 56 条 URL 规则 | 存的可能不是原图 |
| 组织 | 单层项目 + 扁平标签 | folder 树 + 多归属 + extendTags + 标签分组 | 与数据层 v3 一起补 |
| 排序/找回 | 4 种排序 + 5 个搜索前缀 | 12 排序键 + 手动序 + 置顶 + 智能集合 + 颜色 | 前序方案 P1 |
| 可靠性 | 索引唯一真相、缩略图只在 IDB | 每条 `.info/` 自包含、可扫描重建 | 前序方案 P0 |

---

## 4. 终极产品设计（6 条工作流）

### 4.1 WF1「采集即归类」

**目标**：把“最快的入口”变成“一步完成归类”。

1. **拖拽直存（默认）**
   - 拖到左侧“收件箱”或某个项目行 → 立即 `save`（自动标题/自动标签），Toast 显示“已存入 <项目> · 撤销（5s）· 编辑”。
   - `Shift` 拖放 / 点底部“编辑后再存” → 打开收集面板（保留现有能力）。
   - 遗留缺口：外部/桌面拖入（`dataTransfer.files`）可后置到“本地导入”。
2. **收集面板 2.0**（Shadow DOM，替换现有保存面板）
   - 左：预览（图片/视频/音频）、尺寸、5 星、标题（contenteditable）、备注、标签 chip。
   - 右：项目树（最近/全部/选中三 tab，搜索即过滤、可多选、可新建子级）+ “记住上次项目”。
   - 底：保存并继续采集 / 仅保存 / 取消；快捷键 `Enter` 保存、`Esc` 关闭、`1–5` 评分、`T` 标签、`F` 项目。
   - 多项目：`folderIds: string[]`；文件夹带 `extendTags` 时自动并入标签。
3. **右键菜单分层**
   - 图片/视频/链接/页面 → 「保存到 <上次项目>」/「保存到…（最近 5 个项目）」/「选择项目并编辑…」/「批量扫描本页…」。
   - 动态子菜单上限 12 个项目；项目增删/改名后重建菜单（`add-collection` 后必须重建）。
4. **Alt+S 悬停保存**保留；新增 **Alt+右键** 快捷保存（波纹反馈）。
5. **反馈**：保存中进度、失败原因 + 重试、成功后 5s 撤销（不立即落盘索引，见 WF5）。

### 4.2 WF2「批量工作台」

**目标**：100 张图一次完成，失败可见可重试。

- 入口：popup「批量扫描」/ 右键「批量扫描本页」/ 快捷键 `Alt+1`（可改）。
- 页内全屏 `<dialog>`（Shadow DOM，不搬 iframe）：
  1. **扫描**：主文档 + 同源 iframe + ShadowRoot；过滤 tracking pixel（≤5×5 或面积<10）；按 `src` 去重。
  2. **自动发现**：`D`/按钮进入 auto-detect，每 500ms 重扫 + 自动滚动，进度胶囊显示“已发现 N 张”，`Esc/D` 停止。
  3. **筛选/选择**：尺寸（min/max）、类型、域名、关键词；点击/Shift 区间/Ctrl 多选/框选；缩放（Ctrl+滚轮）。
  4. **预览**：图片懒加载；视频 `preload=metadata` + hover 播放；失败/待检测状态占位。
  5. **保存**：目标项目（多选）/标签/星级；每 10 条一批提交，显示进度；结束后给“失败明细 + 重试”。
- 实现映射：`elementCollector`/`batch-saver` 的三路扫描与 auto-detect 直接移植；UI 用原生 DOM + `dialog`（不引入 AngularJS/vs-repeat）。

### 4.3 WF3「截图与裁剪」

- 保留 4 模式：可见 / 元素 / 区域（新增自由矩形）/ 整页。
- 截图后进入**裁剪器**（Shadow DOM）：拖动选框、方向键 1px / Shift 10px 微调、`Ctrl+A` 全选、`Enter` 保存、`Esc` 取消；超视口元素自动改用整页截图裁剪。
- 整页健壮性：fixed/sticky 处理、视频暂停、漂移重截、超上限提示（可分段保存）。
- 截图命名/标签模板复用 `naming.js`；保存到项目/标签/星级与 WF1 一致。

### 4.4 WF4「原图质量与来源增强」

1. **元素识别器升级**（移植 `element-inspector` 算法到 `content/extract.js`）：
   - `srcset`/`picture`/`source` 取最大候选；`background-image`、`image-set()`、内联 SVG、`canvas.toDataURL`、`svg` 序列化；`blob:` → base64；`a` 链接推断；`document.title` 回退链；tracking pixel 过滤。
2. **URL 放大规则表**（移植 56 条，转为声明式）：
   - 首批全量搬入（纯函数），命中 → 改写 → HEAD/Image 校验（按站点缓存）→ 3s 超时回退原图。
   - 规则可开关；每条规则记录命中/失败统计，便于清理腐化规则。
3. **认证图片兜底**：
   - 优先 `fetch(url, {credentials:'include', referrer})` 取 blob（已有 `media.js`）；
   - 失败时用**元素截图**兜底（不做 Eagle 的隐藏 iframe/base64-extractor 复杂链路）；
   - 失败原因给可行动提示（防盗链/登录/超时/过大）。
4. **站点插件（轻量 DOM 型，首批 5 个）**：
   - 接口：`register(domainRegex, {inject, getMeta, disableBatchSaver})`；
   - `inject()` 只做“打标”（`eagle-src`/`eagle-title`/`eagle-type`/`eagle-tags`/`eagle-annotation`），`getMeta()` 只读 DOM；
   - 首批：小红书（笔记标题/视频）、Pinterest（pin 标题）、Behance、Dribbble、B 站（封面/标题）；
   - **不搬** `getMetaAsync` 抓站内 API 的实现。

### 4.5 WF5「库的可重建与可整理」

> 详细设计见 [eagle-optimization-plan.md §5](eagle-optimization-plan.md)。本方案只补充与采集侧衔接的部分。

- **数据层 v3**：sidecar 升为真相；`_library.json` 快照 + `_journal.ndjson` 追加日志；`ensureIndex/rebuild` 可从磁盘重建。
- **采集侧新增字段**：`folders[]`（多归属）、`star`、`extendTags`、`annotation`、`palettes`、`duration`、`lastModified`。
- **缩略图落盘**：`_thumbs/<xx>/<id>.webp`；视频首帧；IDB 降级为渲染缓存。
- **组织与找回**：folder 树（`parentId` + 数组顺序）、12 排序键、手动序 `order[folderId]`、置顶 `pinned[folderId]`、智能集合（规则）、评分/颜色检索、回收站。
- **性能**：分页 `library-page` + 虚拟滚动 + worker 排序 + 索引分片。

### 4.6 WF6「互操作与诊断」

- **Eagle 导入**：读 `.library/metadata.json`（folder 树/tagsGroups/quickAccess）与 `images/*.info/metadata.json`，复制原文件、映射 folder/star/palettes/order，写 v3 sidecar。
- **Eagle 导出**：生成 `.eaglepack`（zip store：`pack.json` + 各 `<id>.info/`），便于回迁或归档。
- **本地导入**：库页面 drop zone（desktop 文件/剪贴板），补 `file` kind 生产者。
- **轻量诊断**：后台 ring buffer（最近 200 条：采集/保存/失败/耗时），设置页可查看/导出 JSON；不做完整 log-viewer。
- **深链**：库页面 `#id=<id>`（不引入 `eagle://`）。

---

## 5. 技术设计

### 5.1 采集协议 v2（统一 payload）

```jsonc
// 单条
{
  "kind": "image|video|audio|link|page|screenshot|file",
  "src": "https://…",              // 原始资源；截图时为 dataURL
  "url": "https://…",              // 来源页
  "linkUrl": "…",                  // 链接类
  "title": "…", "alt": "…", "pageTitle": "…",
  "width": 1600, "height": 1000, "duration": 0,
  "site": "xiaohongshu",
  "behavior": "drag|context|hover|batch|screenshot|import",
  "captureMode": "visible|element|area|full",
  "thumbnailURL": "…",             // 可选，来自 srcset 最小图
  "siteMeta": { "title": "…", "tags": ["…"] },  // 站点插件
  "base64": "data:image/…",        // 可选（截图/认证图兜底）
  "meta": {                        // 采集时用户输入
    "folderIds": ["fld_a"], "tags": ["…"], "annotation": "…", "star": 0
  }
}
// 批量结果
{ "total": 12, "saved": 9, "duplicate": 2, "error": 1,
  "items": [{ "id": "…", "status": "saved|duplicate|error", "error": "…", "code": "HTTP_ERROR", "relativePath": "…" }] }
```

**错误码（可行动）**：`HTTP_ERROR`（防盗链→试原图规则/截图）、`NOT_MEDIA`（登录墙→截图）、`TIMEOUT`（重试）、`TOO_LARGE`（>220MB）、`BLOB_URL`（页面内读→截图）、`NO_PERMISSION`（重新授权）。

### 5.2 页内窗口架构

- 统一使用 `[antcol-ui]` Shadow DOM 容器 + `<dialog>`（不搬 300KB CSS、不搬 AngularJS）。
- 每个面板一个模块：`content/panels/collect.js`、`batch.js`、`crop.js`；共享 `content/panels/base.js`（主题变量、焦点、Esc、`pointer-events` 隔离）。
- 与 SW 通信：`chrome.runtime.sendMessage({type, payload})`；长任务用 `chrome.runtime.connect` port 回传进度（避免 sendMessage 超时）。
- IME 安全：`keydown` 只置 flag，`keyup` 才提交（Eagle 的 `select-panel.js:64-110` 经验）。

### 5.3 站点插件 API（最小）

```js
// content/site-plugins/index.js
AntColSite.register('www\\.xiaohongshu\\.com', {
  inject(root) { root.querySelectorAll('section.note-item img').forEach(el => {
    el.setAttribute('antcol-collectable', 'true');
  }); },
  getMeta(el) {
    const sec = el.closest('section');
    return { title: sec?.querySelector('a.title')?.textContent?.trim() || '' };
  },
  disableBatchSaver: false
});
```

- 加载方式：manifest per-domain content script（与 Eagle 同思路），或 `content/plugins-loader.js` 按域名动态注入；**每个插件必须可关闭、必须清理 interval/observer**。
- 属性契约（优先级最高）：`antcol-src` / `antcol-title` / `antcol-type` / `antcol-tags` / `antcol-annotation` / `antcol-link`。
- 安全边界：插件只读 DOM，不 fetch 站内 API（避免 token/反爬/维护债）。

### 5.4 URL 放大规则

```js
// content/url-rules.js
export const URL_RULES = [
  { site: 'Reddit', pattern: /preview\.redd\.it\/(.*)/, replace: m => `https://i.redd.it/${m[1].split('/').pop().replace(/^.*-v\d+-/, '')}` },
  { site: 'Behance', pattern: /behance\.net\/(project_modules|projects)\/(.*)/, replace: s => s.replace('/max_1200/', '/source/') },
  // …共 56 条（按 eagle-extension-features.md §6.1 的清单逐条搬）
];
```

- 校验：命中后用 `Image()` 或 `HEAD` 验证可加载（3s 超时），失败回退原 URL；按站点缓存成功/失败（TTL 1 天）。
- 开关：设置页「尽量保存原图」；规则表可导出/更新。

### 5.5 与数据层 v3 的字段映射

| 采集 payload | sidecar v3 | 说明 |
|---|---|---|
| `meta.folderIds` | `folders: string[]` | 多归属；旧 `collection` 保留显示名 |
| `meta.star` | `star: 0-5` | 库筛选/排序/triage |
| `meta.tags` | `tags: string[]` | 合并文件夹 `extendTags` |
| `meta.annotation` | `annotation` | — |
| `siteMeta` | `site` + `pageTitle` + `tags` | 站点插件产出 |
| `behavior` | 新增 `behavior` | 分析采集来源 |
| `captureMode` | 已有 `captureMode` | 截图 |
| `src`/`thumbnailURL` | `sourceUrl`/`thumb` | 缩略图落盘路径 |

### 5.6 降级矩阵

| 场景 | 行为 |
|---|---|
| 未选素材库文件夹 | `auto` 落下载目录；面板提示“选择素材库以启用整理” |
| FSA 权限失效 | 保存前检测 → 提示重新授权；`folder` 模式报错，`auto` 回退下载 |
| 离线 | 采集/保存本地可用；URL 放大跳过；缩略图本地 |
| 不支持页面（chrome://、商店） | 禁用页内 UI；popup 提示 |
| 图片 403/登录墙 | URL 规则 → 重试 → 元素截图兜底 |
| 大文件 >220MB | 明确报错，不静默失败 |

### 5.7 代码落点（新增/修改）

| 文件 | 改动 | 波次 |
|---|---|---|
| `background/save.js` | record/sidecar 加 `star/folders/behavior/lastModified`；link 缩略图；失败 `code` | W1 |
| `background/service-worker.js` | 动态菜单（项目子菜单 + 重建）；`update-items` 接受 star/folders；port 进度；诊断 ring buffer | W1/W2 |
| `content/drag-save.js` | drop 直存分支（Shift 开面板）；最近项目；面板星级/多项目/标签历史 | W1 |
| `content/collect-panel.js`（新） | 收集面板 2.0（Shadow DOM dialog） | W1 |
| `content/extract.js`（新） | 元素识别器（srcset/背景/blob/canvas/svg/链接/标题） | W1 |
| `content/url-rules.js`（新） | 56 条放大规则 + 校验缓存 | W1 |
| `content/tag-panel.js`（新） | 标签面板（历史/分组/最近/搜索/新建） | W1 |
| `content/batch-workbench.js`（新） | 批量工作台（扫描/自动发现/框选/预览/保存/重试） | W2 |
| `content/shot-editor.js`（新） | 裁剪器 | W2 |
| `background/screenshot.js` | 整页健壮性 + 自由矩形 | W2 |
| `background/index-store.js`（新） | journal/snapshot/rebuild | W2 |
| `background/thumb-store.js` / `fs-writer.js` | 缩略图落盘 + 扫描 | W2 |
| `library/library.js` / `library.html` | 项目树/排序/评分/颜色/回收站/分页 | W2/W3 |
| `content/site-plugins/*`（新） | 5 个 DOM 插件 + loader | W4 |
| `background/import-eagle.js` / `export-eagle.js`（新） | `.library` 导入 / `.eaglepack` 导出 | W4 |

---

## 6. 版本路线图（4 个可独立发布的版本）

> 依赖顺序：W1 建立数据模型 v3a；W2 建立可靠性与批量；W3 建立整理与规模；W4 建立互操作。

### W1 — v1.3「采集即归类」（2–3 周）

**范围**：数据层 v3a（folders 树/多归属/star/extendTags）、收集面板 2.0、拖拽直存、右键项目子菜单、标签面板、元素识别器、URL 放大规则表、Alt+右键、链接缩略图。

**DoD**
- 拖到项目 = 一次入库，5s 内可撤销；Shift 拖放进面板。
- 任意图片可取到 srcset 最大图；16 条核心站点规则生效且失败回退。
- 保存后可多项目/标签/星级；库页面能按项目/星级筛选（最小实现）。
- `node test/e2e.js` 全绿 + 新增 3 条用例（直存、收集面板、右键子菜单）。

### W2 — v1.4「批量与截图」（2–3 周）

**范围**：批量工作台（扫描/自动发现/筛选/框选/预览/保存/失败重试）、截图裁剪器、整页健壮性、诊断面板、失败码与重试。

**DoD**
- 100 张图批量保存一次完成，失败项可见且可重试。
- 视频在批量网格 hover 播放；自动发现能滚动加载 ≥3 屏。
- 截图后可裁剪（方向键微调），超视口元素完整。
- 诊断面板可导出最近 200 条事件。

### W3 — v1.5「库即可重建」（3–4 周）

**范围**：sidecar 真相 + journal + rebuild；缩略图落盘；12 排序键/手动序/置顶；评分/色板/时长；智能集合；回收站/撤销；分页 + 虚拟滚动 + worker 排序；搜索语法（`star:`/`after:`/`color:`）。

**DoD**
- 清空扩展数据 → 重开库 → 全部素材恢复；缩略图离线可见。
- 5000 条：首屏 <500ms、排序 <100ms、保存线性。
- 删除→回收站→恢复→清空全链路通过；颜色相似 Top20 命中。

### W4 — v1.6「互操作」（2–3 周）

**范围**：Eagle `.library` 导入 / `.eaglepack` 导出；5 个 DOM 站点插件 + loader；本地文件/剪贴板导入；轻量 i18n 骨架（可选）。

**DoD**
- 100 条 Eagle 库导入后 folder 树/标签/星级/顺序一致。
- 导出包可被 Eagle 打开或 zip 工具读取。
- 5 个站点标题/视频源命中率 ≥80%（以真实页面样本计）。

---

## 7. 取舍清单

### 7.1 做（本方案纳入）

| 项 | 理由 |
|---|---|
| 采集即归类（拖拽直存/收集面板/右键项目） | 最高频路径，收益/成本比最高；Eagle 的核心体验 |
| 元素识别 + URL 放大 | 决定“存的是不是原图”，纯算法/数据，S 成本 |
| 批量工作台 | 与现有 popup 差距一个量级，回访高频 |
| 截图裁剪 | 补齐“截好”，复用现有 dataUrl 通道 |
| 数据层 v3 + 缩略图落盘 | 可靠性底座，前序方案 P0 |
| 排序/评分/色板/回收站 | 整理与找回效率 |
| Eagle 导入导出 | 迁移与互操作的唯一低风险形态 |

### 7.2 不做（明确）

| 项 | 理由 |
|---|---|
| 41593/41595 本地服务、Eagle 深链、本地 API | 违背“纯扩展无端口”核心优势 |
| 多库切换 | 项目=轻量多库；多库是架构级改造，收益低 |
| 21 站点适配器生态、board-saver | 规则腐化是负资产；用通用提取 + 5 个 DOM 插件替代 |
| 站点内部 API 抓取（getMetaAsync） | token/反爬/维护债，且涉及隐私与合规 |
| AngularJS/jQuery/vs-repeat、300KB CSS | 技术栈债务；用原生 DOM + 虚拟滚动 |
| 完整 log-viewer / i18n / 主题系统 | 单用户中文场景收益低；诊断面板/深色固定即可 |

### 7.3 缓办（有触发条件）

| 项 | 触发条件 |
|---|---|
| 外部/桌面拖入 | 本地导入（W4）一起做 |
| 颜色/语义搜索 | 素材 ≥3000 条或用户明确需要 |
| XMP 导出 | 与 Eagle/其他软件互操作需求出现 |
| 快捷键编辑器 | 用户明确要求（先只读展示） |
| 多语言 | 上架商店/多语言用户 |
| 站点插件异步增强 | 仅当 DOM 型命中率不足且可维护 |

---

## 8. 风险与边界

| 风险 | 影响 | 缓解 |
|---|---|---|
| 页内 Shadow DOM 与宿主站冲突 | 控件错位/被覆盖 | `z-index` 最高 + `all: initial` 重置 + 焦点管理；Eagle 同范式已验证 |
| 批量扫描触发站内懒加载/反爬 | 扫描不全/被限 | 限速（500ms/轮）、可停止、只对可见页；不做站内 API |
| URL 规则腐化 | 放大失败 | 规则可开关 + 命中统计 + 失败回退原图 |
| 隐私 | 页面 fetch/base64 会把内容带入扩展 | 明确只在用户点击时执行；不落远端；诊断不含 URL 内容 |
| MV3 service worker 休眠 | 长批量/下载中断 | port + keepalive alarm；分片提交（10 条/批） |
| 截图大图内存 | 崩溃 | 分段 canvas + 上限提示 |
| 数据模型迁移 | 旧 sidecar 丢失字段 | v3 读取兼容 v2；迁移脚本 + 备份 `backup/` |
| 规则/插件维护 | 长期成本 | 插件只读 DOM，5 个上限；规则表集中管理 |

**未确认项**：Eagle 收集窗在真实站点的布局细节（未实机点击）；`getMetaAsync` 站点 API 的当前有效性（只描述代码意图）；Ant-col 的 e2e 未复跑（“已有”为代码+历史产物判断）。

---

## 9. 证据索引

### 9.1 REA 证据

| 目标 | 操作 | 证据 ID |
|---|---|---|
| Eagle 扩展 3.1.26 | `analyze_javascript_application`（directory，summary） | `ev_4c3accfe07412cfe494526cd811c8b268008650f69e37f3157f39b01bff27b9c`；102 JS / 221 模块 |
| 扩展模块页 | `inspect_analysis_view`（page/modules） | `ev_35d3cbeb951898bbae4baba4713864137cd5256849363122525a36edca8eb6ad` |
| Eagle app.asar | `analyze_javascript_application`（asar，summary） | `ev_9fb963e4fb9b7270d22ad0cc421ac4698a78842c53a333a8496ea0ba182662b8`；SHA-256 `a33a48f2…173a2` |

### 9.2 报告

- [eagle-extension-features.md](research/eagle-extension-features.md)（825 行 / 92KB）：扩展 18 亮点、30 项可复用性评级、已知 bug/死代码、工程习惯。
- [eagle-static-analysis.md](research/eagle-static-analysis.md)（746 行 / 64KB）：主程序保存管线、库模型、排序、导出、trash。
- [eagle-runtime-probe.md](research/eagle-runtime-probe.md)：47 条 item 实测（缩略图 WebP/软删/多归属/Referer）。
- [antcol-features-gap.md](research/antcol-features-gap.md)（884 行 / 84KB）：30 项矩阵、Top10、实现草图。
- [antcol-current-state.md](research/antcol-current-state.md)（730 行 / 62KB）：运行期基线、技术债。
- [eagle-optimization-plan.md](eagle-optimization-plan.md)：库/保存路径层方案（P0/P1/P2）。

### 9.3 关键源码引用（Eagle 扩展，相对 `D:\eagle-ext-raw\`）

- 入口调度：`js/content.js:21-92`；拖拽：`js/lib/drag-saver.js:95-399`；右键：`js/lib/context-saver.js:12-82`。
- 收集窗：`collect-window/index.html:20-237`、`collect-window/js/controllers/collect.js:117-367`、`collect-window/js/directives/folder-select-panel.js:58-393`。
- 批量：`js/lib/batch-saver.js:184-351`、`batch-saver-window/js/controllers/batch-saver-window.js:96-478`。
- 识别/放大：`js/lib/api/element-inspector.js:39-630`、`js/lib/api/url-enlarger.js:3-712`。
- 截图/裁剪：`js/lib/api/screen-capturer.js`、`js/lib/api/screen-capturer-scroll.js`、`js/lib/cropper.js`。
- 插件：`js/lib/api/plugin.js:1-21`、`plugins/pinterest/pinterest.js`、`plugins/xiaohongshu/xiaohongshu.js`。
- 偏好/门控：`js/lib/api/preference.js:7-36`、`js/lib/api/env.js:24-52`。

### 9.4 关键源码引用（Ant-col）

- 采集/保存：`background/save.js:72-184, 240-379`；`content/hover.js:114-135`；`content/drag-save.js:195-218, 362-378, 604-956`。
- 菜单/消息：`background/service-worker.js:43-105, 414-489`。
- 数据/索引：`background/store.js:76-99`；`background/fs-writer.js:73-115`；`background/naming.js:78-96`。
- 库：`library/library.js:61-133, 227-257, 531-662, 685-721`。
- 截图：`background/screenshot.js:5-122`；`background/media.js:151-167`。

---

## 10. 实施进度（v1.3.0）

> 本轮按 W1「采集即归类」启动实施，已完成可独立发布的第一批；未完成项保留在后续版本。

| W1 工作项 | 状态 | 落点 |
|---|---|---|
| 星级评分贯穿（记录/索引/面板/库/批量/搜索/导出） | ✅ | `background/save.js`、`service-worker.js`、`content/drag-save.js`、`library/library.js`、`popup/` |
| 拖拽「丢到项目即入库」（Shift 保留编辑面板） | ✅ | `content/drag-save.js` |
| 右键「保存到项目」动态子菜单（项目变更自动重建） | ✅ | `background/service-worker.js` |
| URL 原图放大（56 条规则 + 失败回退） | ✅ | `background/url-rules.js` + `save.js` 集成 |
| 元素识别升级（srcset/picture/image-set/懒加载/标题） | ✅ | `content/extract.js` + `hover.js` / `drag-save.js` |
| 收集面板 2.0（完整文件夹树/多归属/最近/标签历史） | ⏳ 未开始 | 依赖组织模型 v3 |
| 标签面板升级（历史/分组/搜索） | ⏳ 未开始 | `content/tag-panel.js` |
| 批量工作台 / 截图裁剪 / 数据层 v3 / Eagle 互操作 | ⏳ 未开始 | W2–W4 |

**本轮验证**

- `node test/e2e.js`：全流程通过；新增「星级持久化」「拖拽直存不开面板」两条断言（`star=5`、`panelAbsent=true`）。
- `node test/unit-url-rules.mjs`：74 项通过；`node test/unit-extract.mjs`：42 项通过。
- 版本：`manifest.json` / `package.json` → `1.3.0`。

