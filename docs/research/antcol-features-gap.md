# Ant-col 蚁穴 · 扩展功能对照审计（vs Eagle 扩展亮点）

> - **审计对象**：`D:\DeepSeek Harness\Ant-Col`，`package.json` version `1.2.1`，git HEAD `a5b366a`（`chore(release): bump version to 1.2.1`）。
> - **审计范围**：扩展侧功能层（采集入口、收集窗、截图、批量、设置/系统能力）。保存路径 / library 数据模型本身不在本报告展开（见 `docs/eagle-optimization-plan.md`）。
> - **纪律**：只读审计，**没有修改任何源码**，**没有执行** `test/e2e.js`，**没有使用** REA MCP。所有行号以当前 HEAD 为准。
> - **证据分级**（本报告统一标注）：
>   - `[观察]` 本次直接阅读源码/产物文件得到的结论（file:line）。
>   - `[观察·e2e]` 只读 `test/e2e.js` 的测试步骤，以及仓库里既有的 `test/out/` 运行产物；**本次未复跑**。
>   - `[推断]` 由代码结构或既有文档合理推出，但没有直接执行验证。
>   - `[未知]` 仓库内没有证据，或 Eagle 侧基线只来自任务清单/文档、无法在本机复核。
> - **Eagle 基线口径**：Eagle 扩展能力以 Lead 给的 30 项清单为准；其中站点适配器（21 站点）、board-saver 瀑布流抓取、大图 URL 放大、批量工作台视频悬停预览等，本仓库文档（`docs/archive/eagle-research.md`、`docs/research/eagle-static-analysis.md`）**没有逐项证据**，凡涉及处标 `[未知]`，不冒充已核实。

---

## 0. TL;DR

### 0.1 30 项判定统计

| 判定 | 数量 | 明细 |
| --- | --- | --- |
| **已有** | 7 | 1 拖拽浮层、2 Alt+S、9 可见截图、10 元素截图（受限）、11 整页截图（受限）、19 备注、27 去重 |
| **部分** | 13 | 3 右键菜单、4 收集窗、5 文件夹树、6 标签面板、8 批量工作台、16 链接保存、20 进度/队列、21 偏好、25 快捷键、26 元数据提取、28 缓存性能、29 批量导入、30 权限门控 |
| **缺失** | 10 | 7 多库、12 截图编辑、13 大图放大、14 站点适配、15 下载回退+导入、17 收藏板抓取、18 星级、22 i18n、23 日志查看器、24 Eagle 深链 |

### 0.2 一句话结论

Ant-col 的**采集入口数量已经接近 Eagle**（拖拽、悬停、右键、popup 批量、三档截图共 11 个入口，全部汇入同一套 `saveItems`），真正的差距不在"能不能收"，而在：

1. **采集即归类**：右键菜单不能选项目、拖拽浮层松手后仍要二次确认、没有星级、收集窗没有文件夹树/最近/收藏；
2. **截图只到"截到"，没到"截好"**：无截图后裁剪/标注，元素截图不能覆盖超视口元素，整页有 16000px/80 tile 硬上限；
3. **批量工作台的"工作台感"不足**：没有目标项目选择、视频只有破图占位、失败项不可见不可重试；
4. **生态型功能**（21 站点适配、收藏板抓取、多库、i18n、Eagle 深链）按清单看起来差距大，但**多数不该照搬**——维护成本高、与"纯扩展 + 文件即库"的定位冲突。

### 0.3 最该先做的 3 件事（详见 §6）

1. **星级评分贯穿**（S，价值高）——数据模型缺一个字段，贯穿 sidecar / 索引 / 库筛选 / triage，是整理效率的最大杠杆。
2. **右键"保存到项目"动态子菜单 + 拖拽浮层直存**（S/M，价值高）——把"最快的入口"变成"一步完成归类"，几乎不改数据模型。
3. **批量工作台补视频预览 + 失败明细/重试 + 目标项目选择**（S/M，价值中高）——修复可见缺陷，且失败项 payload 已经在内存里，重试成本极低。

### 0.4 建议明确不做（详见 §7）

1. **21 个站点适配器 + board-saver 瀑布流抓取**：规则生态是负资产，用"通用提取器 + 自动滚动 + 少量 URL 规则"替代。
2. **多库切换 + Eagle 深链/本地 API**：违背"纯扩展、无本地服务"的核心优势；"项目"就是轻量多库，需要互操作时用导出/导入。

---

## 1. 方法与范围

### 1.1 本次实际阅读的文件

| 类别 | 文件 |
| --- | --- |
| 清单与入口 | `manifest.json`、`package.json`、`README.md` |
| 后台 | `background/service-worker.js`、`background/save.js`、`background/store.js`、`background/fs-writer.js`、`background/downloads-writer.js`、`background/media.js`、`background/screenshot.js`、`background/naming.js`、`background/thumb-store.js`、`background/config.js` |
| 内容脚本 | `content/hover.js`、`content/drag-save.js` |
| 页面 | `popup/popup.html`、`popup/popup.js`、`options/options.html`、`options/options.js`、`library/library.js`（`library.html` / CSS 抽查） |
| 测试与产物 | `test/e2e.js`（只读）、`test/out/` 既有运行产物（侧车 JSON、链接 HTML、截图 PNG、导出 MD） |
| 既有研究 | `docs/research/antcol-current-state.md`（基线，抽查核对）、`docs/archive/eagle-research.md`、`docs/research/eagle-static-analysis.md`、`docs/research/eagle-runtime-probe.md`、`docs/eagle-optimization-plan.md` |

### 1.2 "缺失"的证明方法

对每一条"缺失"，用**全仓检索**（范围：仓库内 `*.js` / `*.json` / `*.html` / `*.css`，排除 `.git/`、`test/out/`、`docs/`，共 ~20 个运行期文件）确认无实现，并在 §10.3 列出检索式与命中数。个别项的"未使用设置"也是用同样方式证明（如 `theme` 只在 `background/config.js:21` 出现 1 次、`toast` 设置 0 次读取）。

### 1.3 与既有基线文档的关系

- `docs/research/antcol-current-state.md` 的关键结论本次抽查**基本一致**：去重键 `sha::collectionPath`（`save.js:288-297`）、`update-items` 只接受 status/collection/annotation/tags（`service-worker.js:330-377`）、库搜索前缀（`library.js:90-101`）、Inbox triage（`library.js:531-662`）等均核对无误。
- **一处需要修正/补充的表述**：基线 §6.1「索引是唯一真相，且不可从文件重建」需要加限定——文件夹模式下 `root-changed` 会读回 `_index.json` 并 `appendIndex`（`service-worker.js:401-412`），所以**索引镜像可回灌，但仍没有 sidecar/目录扫描重建**；且 `_index.json` 只在文件夹模式写（`save.js:315-317`），下载模式没有镜像。本报告按"部分缓解、未闭环"处理。
- 基线 §7 的 Eagle 差距表与本报告的 30 项清单**不是同一口径**（基线偏数据层/库层）。本报告只覆盖扩展功能层，二者可互补，不互相替代。

### 1.4 审计不确定性（提前声明）

- 未复跑 e2e，所以"已有"是"代码路径完整 + 入口可达 + 既有 e2e 曾覆盖/产物存在"，不是本次运行验证。
- `captureVisibleTab`、`chrome.action.openPopup`、FSA 权限恢复等行为依赖浏览器版本与用户手势，代码里有兜底但有环境差异。
- 性能类判断（大库、批量）未实测，只做结构判断。
- Eagle 侧部分能力（21 站点、board-saver 等）本机没有 Eagle 扩展源码可复核，标 `[未知]`。

---

## 2. 30 项判定总览

> 评级口径：**价值** 高＝直接影响采集/整理/找回主链路；中＝特定场景明显收益；低＝边缘或单用户无收益。**成本** S≈≤1 天/单文件小改；M≈1–3 天/多文件+新 UI；L≈>3 天/新模块或数据模型变更。**建议**：做 / 缓 / 不做。

| # | Eagle 扩展能力 | 判定 | 核心证据（Ant-col） | 价值 | 成本 | 建议 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 拖拽保存浮层（拖到中央/指定项目） | **已有**（有 3 个缺口） | `content/drag-save.js:195-218, 362-378, 412-421`；`test/e2e.js:215-271` | 高 | S/M | 做（直存 S）；外部拖入 M 缓 |
| 2 | 悬停快捷保存（Alt+S） | **已有** | `content/hover.js:114-135`；`service-worker.js:107-125`；`manifest.json:55-59` | 高 | S | 保持；可补 Alt+右键（S） |
| 3 | 右键菜单按文件夹直接保存（嵌套子菜单） | **部分** | `service-worker.js:43-55, 57-105`；**无项目子菜单**；`add-collection` 不重建菜单 `:430-437` | 高 | S | **做** |
| 4 | 页内收集窗（文件夹树/多标签/备注/星级/切换库） | **部分** | `drag-save.js:604-956`（标题/多标签/备注/项目/图片↔链接） | 高 | M | 做（星级 S 先做） |
| 5 | 文件夹树 + 最近使用 + 收藏夹 | **部分** | 扁平 `collections`：`config.js:19`；`service-worker.js:292-315`；`drag-save.js:381-410` | 高 | M/L | 缓（随组织模型 v3） |
| 6 | 标签选择面板（历史/星标/建议/分组/搜索） | **部分** | 建议=最近 800 条 top40：`service-worker.js:253-261`；面板 12 个：`drag-save.js:823-836`；库标签 top24：`library.js:175-190` | 中高 | M | **做** |
| 7 | 多库切换 | **缺失** | 单 rootHandle：`store.js:6, 159-171`；全仓无 `switchLibrary/多库` | 中 | L | 不做 |
| 8 | 批量保存工作台（扫描/筛选/选择/进度/视频预览/区域框选） | **部分** | `popup.js:170-312`（扫描/尺寸筛选/选择）、`:376-422`（进度） | 中高 | M | **做**（预览/失败/项目 S/M） |
| 9 | 可见区域截图 | **已有** | `screenshot.js:5-11`；`service-worker.js:156-172`；`e2e.js:474-479` | 高 | — | 保持 |
| 10 | 元素框选截图 | **已有**（受限：元素≠任意矩形；超视口元素被裁断） | `hover.js:206-298`；`service-worker.js:173-176`；`media.js:151-167`；`e2e.js:481-498` | 中高 | M | 做（超视口裁剪 S/M） |
| 11 | 整页滚动截图 | **已有**（16000px/80 tile 上限，fixed/sticky 只隐藏一次） | `screenshot.js:70-122`；`e2e.js:523-529` | 中 | S/M | 做（健壮性 S） |
| 12 | 截图前裁剪/编辑 | **缺失** | 无 canvas 编辑器；`cropImage` 仅服务元素截图 `media.js:151-167`；但 `captureAndSave` 已支持传入 `dataUrl` `service-worker.js:156-160` | 中高 | M | **做** |
| 13 | 大图 URL 放大（站点规则） | **缺失** | 全仓无 `urlEnlarger/站点规则`；`media.js:40-94` 只 fetch 原 URL。Eagle 侧见 `docs/research/eagle-static-analysis.md:138` | 中 | M | 缓 |
| 14 | 站点适配插件（21 站点） | **缺失** | 全仓无 `siteParser/站点适配`；只有通用识别 `hover.js:24-112`、`drag-save.js:120-179` | 中 | L | 不做（改为通用提取器） |
| 15 | 浏览器下载回退 + 导入（认证/cookie 场景） | **缺失**（仅有缓解） | `media.js:52-69`（credentials+referer）；失败直接报错 `:73-86`；`service-worker.js:401-412` 只导入索引镜像 | 中 | S/L | 做（截图兜底 S）；完整回导不做 |
| 16 | 链接/书签保存（页面截图 + .url） | **部分**（替代实现：自包含 HTML 卡片） | `save.js:195-238, 267-273`；产物 `test/out/downloads/Ant-col素材/链接/2026-10/*.html`；无 `.url`、链接无缩略图 | 中 | S | 做（缩略图 S） |
| 17 | 收藏板/瀑布流批量抓取（board-saver） | **缺失** | popup 只扫当前 DOM 一次 `popup.js:278-293`；无自动滚动/翻页/board 概念 | 中低 | L | 不做（只做自动滚动 S） |
| 18 | 星级评分 | **缺失** | record 无 star `save.js:87-118`；sidecar 无 star `:121-147`；`update-items` 不接受 star `service-worker.js:334-348` | 高 | **S** | **做** |
| 19 | 备注 annotation | **已有** | `save.js:84`；面板 `drag-save.js:730`；详情 `library.js:393, 453, 500-508`；`service-worker.js:342` | 中 | — | 保持 |
| 20 | 采集进度/队列/错误提示 | **部分** | 并发 3 内存队列 `save.js:346-368`；`save-progress`：`save.js:362-364` + `popup.js:496-502`；无持久队列/重试/失败面板；无 keepalive（全仓 0 处 `alarms/setInterval`） | 中高 | M | 做（失败明细/重试 S-M） |
| 21 | 偏好设置（主题/语言/格式/质量/Retina/延迟/拖拽模式/快捷键/日志） | **部分** | 可用 11 项：`options.html:26-126` + `options.js:48-62`；`theme` 设置**声明但未使用** `config.js:21`；`toast` 设置未使用 `config.js:16`；无质量/Retina/延迟/拖拽模式 UI；三处 UI 均写死深色（`popup.css:2`、`library.css:2`、`options.css:2`） | 中 | S/M | 做小项打包（S） |
| 22 | i18n/多语言 | **缺失** | 无 `_locales`、无 `chrome.i18n`（全仓 0 命中）；文案硬编码中文 | 低 | L | 不做 |
| 23 | 日志查看器 | **缺失** | 无日志模块（全仓 0 命中 `logger/日志`），只有 toast/统计 | 低 | S/M | 缓（做轻量诊断） |
| 24 | Eagle 深链跳转（eagle://） | **缺失** | 全仓无 `eagle://`；`reveal` 只打开下载目录 `service-worker.js:468-474` | 低 | S | 不做（可做库内 hash 深链） |
| 25 | 快捷键自定义 | **部分** | 5 个 `commands`：`manifest.json:55-75`；靠浏览器 `extensions/shortcuts` 改（`README.md:155`、`options.html:147`）；无扩展内编辑器 | 低 | S | 缓（设置页展示即可） |
| 26 | 元素元数据提取（srcset/CSS 背景/懒加载/视频封面/base64） | **部分**（较完整） | `hover.js:17-112`；`drag-save.js:43-55, 78-179`；`popup.js:170-246`；`media.js:13-38, 42-45`；缺 data-src/og:image/视频首帧 | 中高 | M | 做（统一提取器 M） |
| 27 | 去重/重复提示 | **已有**（按项目维度，非全局） | SHA-256 `media.js:96-99`；键 `sha::collectionPath` `save.js:288-297, 328-334`；面板提示 `drag-save.js:913-915`；`e2e.js:500-507` | 中 | S/M | 做（提示增强 S）；全局清理缓 |
| 28 | 缓存与性能（queue、cache-helper） | **部分** | 写入串行链 `store.js:74-99`；镜像串行 `fs-writer.js:84-105`；缩略图 IDB `thumb-store.js:21-42`；无持久队列/虚拟滚动/分页消息（`service-worker.js:299-327` 全量 items） | 高（大库） | M/L | 缓（并入优化方案 P1-3） |
| 29 | 批量导入图片（import-images） | **部分** | popup 本页批量 `popup.js:170-312`，上限 300 `:245`；无本地文件/多 URL/剪贴板导入 | 中高 | M | **做**（本地文件导入） |
| 30 | 权限/能力门控 | **部分** | 权限面较宽 `manifest.json:8-20`；运行时门控：tab URL `popup.js:264-272`、popup 降级 `service-worker.js:140-146`、FSA 权限 `fs-writer.js:5-10`、不支持页提示 `:148-154` | 中低 | S/M | 缓 |

---

## 3. 逐项详述

### A. 采集入口与收集窗（清单 1–7、15–17、26）

#### 3.A.1 拖拽保存浮层（清单 1）— 判定：**已有**（有 3 个明确缺口）

**Eagle 口径**：`DragSaver` 把图片/链接/视频拖到页面中央的 "Add to Eagle" 浮层，浮层右侧是收藏夹，可直接落到指定文件夹（`docs/archive/eagle-research.md:104`）。

**Ant-col 现状**
- `[观察]` 页面内 `dragstart` 捕获（`drag-save.js:217-218`）→ 识别拖拽起点（图片/链接/视频/CSS 背景，`:120-179`）→ 30ms 后显示浮层（`:205-208`, `:412-421`）。浮层结构：左侧"拖到这里添加到 <默认项目>"、右侧收藏夹列表、底部"＋ 建立或选择文件夹"（`:324-343`）。
- `[观察]` 松手落到左侧或某个项目行都会进入保存面板（`:362-378`），落 `choose` 则打开文件夹选择器（`:451-568`），选择器支持临时新建项目（`:534-556`）。
- `[观察·e2e]` 浮层出现、项目行渲染、drop→面板、保存落盘都已被 e2e 覆盖（`test/e2e.js:215-271, 314-350`），并有 `test/out/drag-page.png`、`drag-panel.png` 产物。
- `[观察]` 有正确的边界保护：不劫持 contenteditable（`:40, 122`）、图片被 `<a>` 包裹时识别为图片并保留 `linkUrl`（`:147-168`）、`blob:` 在页面内转 dataURL（`:43-55`）。

**缺什么**
1. **"拖到项目"仍不是一步完成**：所有 drop 都 `openPanel(...)`，用户还要再点一次"保存到「项目」"（`drag-save.js:372-377, 870-928`）。Eagle 的拖拽落文件夹是"放下即入库"（`[推断]`，按清单描述）。
2. **不支持外部/桌面拖入**：只监听页面 `dragstart`，没有 document 级 `dragover/drop`，也没有 `dataTransfer.files` 处理；README 自认（`README.md:272`）。
3. `drag-save.js` 只在主 frame（`manifest.json:49-54` 未设 `all_frames`），iframe 里的图片不能拖存（`hover.js` 反而有 `all_frames: true`，`manifest.json:42-48`）。

**落点建议**
- 直存：`drag-save.js` drop handler 增加分支——默认直存（`save` 消息带 `meta.collection` + 不打开面板，成功 toast 显示 `relativePath`），按住 Shift/Alt 或点左侧"预览/改标签"时才打开面板。
- 外部拖入：`library/library.html`（或 content script）监听 `drop`，`File` 对象可直接用 FSA 写入库目录，然后走 `saveItems`/新 `importFiles` 生成 sidecar。
- iframe：`manifest.json` 给 `drag-save.js` 加 `all_frames: true`，但要处理跨 frame 的 `chrome.runtime.sendMessage` 与浮层只在 top frame 显示（`window.top === window`）。

**评级**：价值 **高**；成本 **S（直存）/ M（外部拖入）**；建议 **做直存，外部拖入缓/做**。

---

#### 3.A.2 悬停快捷保存（Alt+S）（清单 2）— 判定：**已有**

**Eagle 口径**：`ContextSaver` 支持 Alt+右键 / 右键菜单触发（`docs/archive/eagle-research.md:105`）；清单里的 Alt+S 是"悬停 + 快捷键"路线。

**Ant-col 现状**
- `[观察]` `hover.js` 记录 `pointermove/mouseover`，`currentItem()` 用 `elementFromPoint` + 6 秒回退（`hover.js:114-135`）；覆盖 `<img>`、`<video>`（无 src 时用 poster）、`<canvas>`（`toDataURL`）、CSS 背景（向上 5 层）（`:24-112`）。
- `[观察]` `Alt+S` → `chrome.commands`（`manifest.json:55-59`）→ 后台 `save-hovered` → 向 tab 取悬停项 → `saveItems`（`service-worker.js:107-125`）；没有可保存对象时给 toast 提示（`:116-119`）。
- `[观察]` 已处理 `blob:`（跳过）与 `MIN_SIZE=24` 小图噪声（`hover.js:11, 26-27`）。

**缺什么**
- 没有 Eagle 的 "Alt+右键" 入口（`[观察]` 全仓无 `contextmenu` + `altKey` 组合处理）。
- 悬停判定依赖"鼠标先动过"；键盘触发时如果没有 `pointermove`，`lastPoint` 为 `{0,0}`（`hover.js:5, 128`），可能取到左上角元素——`[推断]`，多数真实场景有鼠标移动，影响小。

**落点建议**：`content/hover.js` 增加 `contextmenu` 监听（`event.altKey` → `preventDefault()` → 直接 `sendMessage({type:'save', items:[currentItem()]})`），复用现有命令处理器。

**评级**：价值 高；成本 S；建议 **保持 + 补 Alt+右键（S）**。

---

#### 3.A.3 右键菜单按文件夹直接保存（清单 3）— 判定：**部分**

**Eagle 口径**：右键菜单里直接是文件夹树/子菜单，选中即保存到该文件夹（`[未知]` 具体层级，按清单）。

**Ant-col 现状**
- `[观察]` 有二级根菜单 `Ant-col 蚁穴`，下挂 8 个条目 + 1 条分隔线：图片、视频、链接、批量、本页链接卡片、三档截图（`service-worker.js:43-55`）。图片/视频/链接会直接 `saveItems` 到默认项目（`:62-92`）。
- `[观察]` 菜单只在 `onInstalled` / `onStartup` 重建（`:21-34`）；`add-collection` 只改 settings（`:430-437`），**不会刷新菜单**——现在无所谓（菜单是静态的），但一旦做动态项目子菜单就是必须修的坑。

**缺什么**
1. 菜单里**没有项目/收藏夹维度**：不能在右键菜单选择"保存到 日常审美"；只能进默认项目后再去库里改分类（或拖拽浮层）。
2. 批量/截图入口与"保存图片"挤在同一个根菜单里，缺少分组（截图可单独一个子菜单）。
3. 菜单项不随 settings.collections 变化。

**落点建议**
- `createMenus()` 遍历 `settings.collections` 生成 `save-image-to:<index>` 子项（图片/视频/链接/页面各一组或共享），`onClicked` 解析 id 取项目名；`add-collection` / 设置页改项目后调用 `createMenus()`。
- 注意 Chrome 菜单 id 长度/数量限制，建议只给前 12 个项目建菜单，其余走"更多…"进 popup。
- 记住"最近使用项目"并置顶（与清单 5 联动）。

**评级**：价值 高；成本 S；建议 **做**。

---

#### 3.A.4 页内收集窗（清单 4）— 判定：**部分**

**Eagle 口径**：收集窗（collect window iframe）可选文件夹树、多标签、备注、星级、切换库（清单 + `eagle-research.md:106`、`eagle-optimization-plan.md:82`）。

**Ant-col 现状（其实比"部分"更接近可用）**
- `[观察]` 拖拽后打开的是页面内 Shadow DOM 面板（`drag-save.js:604-956`），已具备：预览图/尺寸（`:714-719, 760-780`）、可编辑标题（`:720, 849`）、多标签 chips + 历史标签建议（`:725-729, 800-836`）、备注（`:730`）、目标项目显示与"更换"（`:731, 840-846`）、图片↔链接卡片模式切换（`:721-724, 786-799`）、保存中/重复/错误状态（`:870-928`）、Esc 关闭（`:947-955`）。
- `[观察]` 面板数据来自 `quick-state`（`service-worker.js:420-429`），15 秒缓存（`drag-save.js:181-191`）。
- `[观察·e2e]` 面板标题/目标项目/标签/备注/保存均被测过（`e2e.js:248-270`），`test/out/drag-panel.png` 可见。

**缺什么**（相对 Eagle 清单）
1. **星级**：没有（见 3.B.2 / 清单 18）。
2. **文件夹树**：只有扁平项目列表（见 3.A.5）。
3. **切换库**：单库（见 3.A.6）。
4. 没有"最近使用"项目置顶/记忆；打开面板永远是当前默认项目或拖拽落点。
5. 标签上限 12（`drag-save.js:819`），后台 patch 支持 24（`service-worker.js:344`）——不算缺口，但 UI 与模型不一致。

**落点建议**：在面板 `.field` 区插入 5 星组件（`data-star`），payload 加 `star`；项目行改为"最近 3 个 + 全部"两段（读 `recentCollections`）；多库不做。

**评级**：价值 高；成本 M（星级子项 S）；建议 **做，先做星级与最近项目**。

---

#### 3.A.5 文件夹树 + 最近使用 + 收藏夹（清单 5）— 判定：**部分**

**Eagle 口径**：`metadata.json` 的 `folders` 是含 children 的树，另有最近/收藏夹语义（`eagle-research.md:230-231`、`eagle-runtime-probe` 的 folder 实测）。

**Ant-col 现状**
- `[观察]` 组织模型是**单层字符串数组**：`collections: ['灵感收集','日常审美','帮催作品']`（`config.js:19`）、`defaultCollection`（`:20`）；保存时 `resolveCollection` 把非默认项目变成一级子目录（`save.js:38-48`）；路径形如 `<项目>/图片/2026-10/...`（`save.js:308-311`）。
- `[观察]` 拖拽浮层右侧叫"收藏夹"，渲染扁平列表 + 默认徽章（`drag-save.js:336-410`）；库侧栏项目列表带计数与颜色点（`library.js:148-173`，计数来自 `service-worker.js:304-315`）。
- `[观察]` 没有树/父子、没有最近使用集合、没有收藏/置顶；项目改名/删除无入口，改项目只改元数据不搬文件（`service-worker.js:339-341`；README:211）。

**缺什么**
1. 层级（父子文件夹）与多归属（一条素材进多个项目）——Eagle 是多 `folderIDs`（`eagle-optimization-plan.md:82, 295`）。
2. 最近使用（`recentCollections`）与收藏/置顶。
3. 项目元数据（描述/颜色/图标/排序）——现在只有名字，颜色是哈希出来的（`library.js:55-59`）。
4. 项目改名/合并/删除，以及"改项目后磁盘路径不一致"的处理策略。

**落点建议**
- **不建议现在单独做树**：`docs/eagle-optimization-plan.md §5.3` 已经规划了"组织模型 v3（folder 树 + 多归属 + 智能集合）"。本项应与该方案合并，否则会出现两套组织模型。
- 可以先做**低风险子集**（S）：`recentCollections`（保存后记录最近 3 个）+ 拖拽浮层/右键菜单置顶；`collectionsMeta`（颜色/置顶）存 settings，侧栏渲染用它替代哈希色。
- 改名/删除要同时决定磁盘目录策略（建议：只改元数据，保留旧目录，索引记录 `collectionPath` 历史）。

**评级**：价值 高；成本 M/L；建议 **缓（随组织模型 v3 一次到位）；最近使用可先做 S**。

---

#### 3.A.6 多库切换（清单 7）— 判定：**缺失**

**Ant-col 现状**
- `[观察]` 单一句柄：`ROOT_KEY='rootHandle'`（`store.js:6`），`getRootHandle/setRootHandle/clearRootHandle`（`:159-171`）只存一个；`resolveTarget` 永远用这一个 root（`save.js:24-36`）。
- `[观察]` 全仓检索 `switchLibrary / library/switch / 多库` **0 命中**；设置页只有"选择文件夹/更换/移除"（`options.js:128-174`）。
- `[观察]` "项目"承担了轻量多库的角色，且同一张图可以按项目重复保存（去重键含 `collectionPath`，`save.js:288-297`）——这是有意的设计。

**缺什么**：多 rootHandle、当前库指针、库级统计/切换 UI、跨库搜索、库导入导出（zip/文件夹）。

**落点建议**：**不做**。真需要"分库"时，用"项目 + 导出/导入"覆盖 90% 场景；如果未来做，建议做成"库 = 一个 rootHandle 列表 + 当前指针"，同时提供 `导出库（zip/json）`，否则会动摇 `_index.json` 与 sidecar 的单一路径假设。

**评级**：价值 中；成本 L；建议 **不做**。

---

#### 3.A.7 浏览器下载回退 + 导入（清单 15）— 判定：**缺失**（有部分缓解，无回退/回导机制）

**Eagle 口径**：扩展抓不到（cookie/认证/防盗链）时，回退到浏览器/Electron 下载，再导入库（清单；Eagle 的实现是 Electron 网络栈 + 本地库，`eagle-static-analysis.md:138`、`eagle-optimization-plan.md:95`）。

**Ant-col 现状**
- `[观察]` 抓取只有 SW `fetch`：`credentials:'include'` + `referrer`（`media.js:52-69`），带 `AbortController` 45s（`config.js:42`）；失败分类 `HTTP_ERROR / NOT_MEDIA / TIMEOUT / TOO_LARGE`（`media.js:73-90`），**失败即抛错，没有回退**（`save.js:358-360` 把错误记入结果）。
- `[观察]` 输出侧的"下载目录模式"（`downloads-writer.js:50-80`）是**写入目标**，不是抓取回退；`downloads/` 只是兜底落盘位置。
- `[观察]` 唯一的"导入"是 `root-changed` 时读 `_index.json` 回灌索引（`service-worker.js:401-412`），**不扫描素材文件、不读 sidecar**。
- `[观察]` 页面侧有两个局部兜底：`blob:` → dataURL（`drag-save.js:43-55`）、canvas → dataURL（`hover.js:70-85`）；但它们只覆盖"页面内可读"的资源。

**缺什么**
1. fetch 失败后的**用户可执行兜底**：提示"改用元素截图/重试/打开原图"。
2. 下载→回导：扩展沙箱无法读 Downloads 任意文件（没有本地服务），完整回导需要用户再选一次文件夹，成本 L 且体验割裂。
3. 失败原因的用户可读文案（现在 `HTTP_ERROR` 之类会直接透出 `err.message`，可读但无行动建议）。

**落点建议**
- **做轻量兜底（S）**：`saveOne` 抓取失败时，若该 item 来自页面（有 `pageUrl`），返回 `fallbackHint: 'element-shot'`，popup/面板提供"截取该元素"一键动作，复用 3.C.2 的元素截图管线（`service-worker.js:148-176`）。这能把大量防盗链失败转成"至少存到视觉副本"。
- 可选：失败项自动重试 1 次（换无 Referer 的 fetch），参考 Eagle 的二次尝试策略（`eagle-optimization-plan.md:95`）。
- **不做完整下载回导**：受 MV3 沙箱限制，收益/成本不划算。

**评级**：价值 中；成本 S（兜底）/ L（完整）；建议 **做兜底，完整方案不做**。

---

#### 3.A.8 链接/书签保存（清单 16）— 判定：**部分**（Ant-col 是替代实现，且更"可读"）

**Eagle 口径**：保存页面截图 + `.url` InternetShortcut（`eagle-research.md:164`、`eagle-optimization-plan.md:165`、`eagle-runtime-probe.md:112-120`）。

**Ant-col 现状**
- `[观察]` 链接保存为**自包含 HTML 卡片**：带标题、URL、备注、来源页、深/浅色样式（`save.js:195-238`），保存走 `kind:'link'` 分支（`:267-273`），扩展名 `html`；`record.linkUrl` 同时写（`:117`）。
- `[观察·e2e]` 链接卡片已测（`e2e.js:518-521`），产物 `test/out/downloads/Ant-col素材/链接/2026-10/...Example-Article.html`（1.6KB）存在；面板里图片带链接时可切换"保存为链接卡片"（`drag-save.js:786-799`，`e2e.js:273-312`）。
- `[观察]` 链接条目**没有缩略图**：`save.js:320-326` 只对 `image/*` 生成缩略图；库里 link 走 glyph 占位（`library.js:248-257, 467-485`）。
- `[观察]` 没有 `.url` 文件，也没有页面截图；`test/e2e.js:508-517` 曾探测 `chrome.downloads` 直接下载 `.url`，但 `test/out` 只留下 `.txt` 产物，**结论未记录（未知）**——若要做 `.url` 需先实测浏览器下载策略。

**缺什么**
1. 链接缩略图（页面截图或 og:image）。
2. `.url` 兼容（可选，给需要 Windows 资源管理器双击打开的人）。
3. 页面截图作为卡片背景（Eagle 的书签缩略图就是页面截图）。

**落点建议**
- `save.js` link 分支：保存卡片后调用 `captureVisible(tab.windowId)` 截当前页，`resizeImage(...,360,0.74)` 后 `putThumb(id)`（S，复用现有缩略图链路）；库/详情无需改。
- `.url` 可选：在写 sidecar 之外再写一个 `.url` 文本（`[InternetShortcut]`，`URL=`），但需先验证 `chrome.downloads` 对 `.url` 的处理（e2e 探测未留结论）。

**评级**：价值 中；成本 S；建议 **做缩略图（S）**；`.url` 缓。

---

#### 3.A.9 收藏板/瀑布流批量抓取（清单 17）— 判定：**缺失**

**Eagle 口径**：board-saver 对收藏板/瀑布流做批量抓取（清单；本仓库无对应 Eagle 证据，`[未知]`）。

**Ant-col 现状**
- `[观察]` 批量扫描只在 popup 里对**当前 DOM** 执行一次 `chrome.scripting.executeScript(collectImages)`（`popup.js:276-293`），收集 `img/video/CSS 背景`（`:170-246`），上限 300（`:245`）、背景扫描最多 4000 节点（`:218`）；**不滚动、不翻页、不点"加载更多"**。
- `[观察]` 没有 board / pin / 采集板概念，也没有按页面结构识别"卡片列表"的逻辑。

**缺什么**：自动滚动加载、翻页、去重合并（跨滚动轮次）、按 board 结构抓取、进度反馈。

**落点建议**
- **不做 board-saver**（规则/站点耦合，且涉及自动操作页面，风险高）。
- 可做**通用"自动滚动扫描"（S/M）**：popup 里加"滚动加载更多"——循环 `window.scrollBy` + 等待 + 重新收集（同一 `collectImages`，按 URL 去重），这是对瀑布流站点 80% 的收益，且不写站点规则。需注意页面生命周期与用户打断。

**评级**：价值 中低；成本 L（完整）/ S（自动滚动）；建议 **完整不做，自动滚动可做**。

---

#### 3.A.10 元素元数据提取（清单 26）— 判定：**部分**（覆盖面不错，但有 3 个系统性缺口）

**Eagle 口径**：`elementInspector.getMeta` + `siteParser.getMeta`，支持 base64 解析、站点元数据合并（`eagle-research.md:108`）。

**Ant-col 现状**
- `[观察]` **srcset**：三处都用 `img.currentSrc || img.src`（`hover.js:25`、`drag-save.js:60`、`popup.js:187`），即浏览器选中的当前源——能拿到 srcset 的"当前/最大已选"候选，但没有显式解析 `srcset/sizes` 选最大。
- `[观察]` **CSS 背景**：悬停向上 5 层（`hover.js:96-110`）、拖拽自身+祖先 3 层且要求无文本（`drag-save.js:88-101`）、popup 扫描 4000 节点/≥40px（`popup.js:216-242`）；能解析 `url(...)` 第一个背景。
- `[观察]` **视频封面**：`video.poster` 兜底（`hover.js:40-67`、`drag-save.js:127-144`、`popup.js:204-214`）；`blob:` 视频跳过或退 poster。
- `[观察]` **base64/data URL**：`media.js:13-38` 解码、`:42-45` 直接返回；canvas `toDataURL`（`hover.js:70-85`）；页面内 blob→dataURL（`drag-save.js:43-55`）。
- `[观察]` **懒加载**：无 `data-src / data-original / data-lazy-src` 等属性兜底（全仓 0 命中）；图片未加载时 `currentSrc` 可能是占位图/空。
- `[观察]` **页面级元数据**：无 `og:image / twitter:image / JSON-LD / link[rel=image_src]` 提取（全仓 0 命中）。
- `[观察]` **视频首帧**：无（`createImageBitmap` 不能解视频；没有 `<video>` seek + canvas 抓帧）。
- `[观察]` **多背景/伪元素**：只取第一个 `url()`；`::before/::after` 的背景不处理（`getComputedStyle` 默认伪元素需显式参数）。

**缺什么**：懒加载属性兜底、srcset 最大候选、og:image、视频首帧、伪元素/多背景、跨 iframe（drag-save 非 all_frames）。

**落点建议**
- 抽 `content/extract.js`（纯函数，无副作用），把"img/video/canvas/bg"识别与"元数据候选排序"统一，三处调用方（hover/drag/popup）共用：
  - 图片候选：`currentSrc > srcset 最大 > src > data-src/data-original > CSS 背景`；
  - 页面候选：`og:image > twitter:image > link[rel=image_src] > JSON-LD.image`；
  - 视频：`src > <source> > poster`，可选首帧抓取（M）。
- 顺手修 `drag-save.js` 的 `all_frames`（见 3.A.1）。

**评级**：价值 中高；成本 M；建议 **做（统一提取器）**。

---

### B. 组织与元数据（清单 5–7、18–19）

（清单 5/7 已在 A 组，避免重复。）

#### 3.B.1 标签选择面板（清单 6）— 判定：**部分**

**Eagle 口径**：历史标签、星标标签、建议、分组、搜索（`eagle-research.md:230-231` 的 `tags.json` historyTags/starredTags + `tagsGroups`；清单）。

**Ant-col 现状**
- `[观察]` 标签建议来自**最近 800 条索引**的标签计数 top 40（`service-worker.js:253-261`），拖拽面板显示前 12（`drag-save.js:823-836`）；popup 用 `<datalist>` 全量建议（`popup.js:136-144` + `popup.html:85-86`）；库侧栏显示 top 24 标签 chips（`library.js:175-196`）。
- `[观察]` 标签的增删改：面板 chips 删除（`drag-save.js:800-816`）、popup chips（`popup.js:146-168`）、库详情（`library.js:437-462`）、批量 `addTags`（`service-worker.js:346-355`）。
- `[观察]` 没有标签历史/星标/分组/重命名/合并/删除；没有独立"标签选择面板"，只有输入框+建议。

**缺什么**
1. 历史标签（最近使用/常用）与星标标签（Eagle `historyTags/starredTags`）。
2. 分组（tagsGroups）与标签搜索面板。
3. 标签重命名/合并/删除（现在删标签只能在单条素材上删）。
4. 标签计数来源是最近 800 条，老库统计会偏（`service-worker.js:255`）。

**落点建议**
- 新增 `tagsMeta`（storage.local）：`{ history: [{name,lastUsedAt,count}], starred: [name], groups: [{name,tags}] }`；保存时 `bumpTagHistory`（在 `saveItems` 成功后 / `update-items` 后）。
- 面板改成"输入框 + 折叠面板"：最近 8 / 星标 / 全部（可搜索），复用现有 chips 渲染。
- 标签管理页（M）：重命名/合并/删除，删除时批量 patch 所有索引条目与 sidecar（复用 `updateItems` 的 sidecar 重写逻辑 `service-worker.js:357-369`）。

**评级**：价值 中高；成本 M；建议 **做**（历史+搜索先做 S，分组/管理 M）。

---

#### 3.B.2 星级评分（清单 18）— 判定：**缺失**

**Eagle 口径**：payload `star`（`eagle-research.md:141`），item metadata 落盘 `star`（`eagle-runtime-probe.md:203`），`/api/item/update` 可改（`eagle-research.md:212`）。

**Ant-col 现状**
- `[观察]` `buildRecord` 字段表里**没有 star**（`save.js:87-118`）；`sidecarFor` 也没有（`:121-147`）；现有 sidecar 产物可验证（`test/out/downloads/Ant-col素材/图片/2026-10/*.json` 无 star 字段）。
- `[观察]` `updateItems` 只接受 `status / collection / annotation / tags / addTags`（`service-worker.js:334-355`）；库筛选/排序无 rating（`library.js:103-133`）；详情抽屉无星级（`:369-515`）；triage 只有 K/A/→/Esc（`:655-660`）。
- `[观察]` 全仓检索 `star|rating|星级`：0 命中（排除 `start` 类词后）。

**缺什么**：字段、UI（面板/详情/批量）、筛选/排序、triage 快捷键、导出列、sidecar 兼容。

**落点建议**（详见 §6.1）：`star: 0-5`；`sidecarFor` 增字段；`update-items` patch 接受 `star`；库加 `is:star` / `minstar:N` 或独立"星标"视图；triage 加数字键 1–5；CSV/MD 导出加星级列；旧数据默认 0。**这是全报告 ROI 最高的一项**。

**评级**：价值 高；成本 **S**；建议 **做（第一优先）**。

---

#### 3.B.3 备注 annotation（清单 19）— 判定：**已有**

- `[观察]` payload/record/sidecar 都有 `annotation`（`save.js:84, 105, 140`）；拖拽面板 textarea（`drag-save.js:730`）、popup 备注（`popup.html:88`、`popup.js:392`）、库详情编辑（`library.js:393, 453, 500-508`）；`update-items` 接受并写 sidecar（`service-worker.js:342, 357-369`）。
- `[观察·e2e]` 拖拽保存时写入了 `annotation: "drag e2e"`（`e2e.js:264`），产物 sidecar 可见。
- 可选增强（低价值）：详情里 markdown 渲染、备注模板。**建议保持**。

---

### C. 截图能力（清单 9–14）

#### 3.C.1 可见区域截图（清单 9）— 判定：**已有**

- `[观察]` `captureVisible(windowId)`（`screenshot.js:5-11`）→ `captureAndSave({mode:'visible'})`（`service-worker.js:156-172`）→ 走同一个 `saveItems`；入口：菜单（`:52`）、快捷键 `Alt+Shift+S`（`manifest.json:60-63`、`service-worker.js:126-127`）、popup 可编程入口（`e2e.js:476`）。
- `[观察]` 截图格式可选 png/jpg（`options.html:110-116`），jpg 时用 `resizeImage(...,100000,quality/100)` 转码（`save.js:255-262`）。
- `[观察·e2e]` 已覆盖（`e2e.js:474-479`），产物 `test/out/downloads/Ant-col素材/截图/...png`。
- 缺口：无延迟/Retina/选区（与清单 12 相关）；`captureVisibleTab` 依赖激活窗口，后台窗口可能失败（有错误处理但无自动激活）。

**评级**：价值 高；成本 —；建议 保持。

---

#### 3.C.2 元素框选截图（清单 10）— 判定：**已有**（受限）

- `[观察]` `hover.js:206-298`：注入全屏 shadow 遮罩，`pointermove` 高亮 `elementFromPoint` 的元素，点击回传 `rect + dpr`；Esc 取消；命中后 toast。
- `[观察]` 后台 `captureAndSave({mode:'element', rect})` → 可见截图 → `cropImage(dataUrl, rect, dpr)`（`service-worker.js:173-176`、`media.js:151-167`，越界 clamp）。
- `[观察]` 元素不在视口时先 `scrollIntoView` 再延迟 260ms 截（`hover.js:262-268`）。
- `[观察·e2e]` 已覆盖（`e2e.js:481-498`）。
- **限制**：① 是"选元素"不是"自由框选矩形"；② 元素**高于视口**时会被视口截断（从可见截图裁，`media.js:151-167`），没有分片拼接；③ 滚动后截图与 rect 之间有时序窗口（260ms），慢页面可能错位 `[推断]`；④ iframe 内元素不可选（`hover.js` 只 top frame 执行 startCapture，`:148`）。

**落点建议**
- 超视口元素：改用"整页截图 + 元素全局坐标裁剪"——先从 content 拿元素的 `rect + scrollY`（或 `getBoundingClientRect` 转换），后台整页截图后按全局坐标裁剪；复用 `captureFullPage`（`:70-122`）。成本 M，但收益明确（长图/长卡片）。
- 自由矩形：在同一套遮罩里加"拖出矩形"模式（模式切换：元素/矩形），`rect` 直接可用，成本 S/M。
- 修 iframe：`startCapture` 支持指定 frameId（`chrome.tabs.sendMessage` 带 `frameId`），成本 M。

**评级**：价值 中高；成本 M；建议 **做（超视口裁剪 + 自由矩形）**。

---

#### 3.C.3 整页滚动截图（清单 11）— 判定：**已有**（限制明确）

- `[观察]` `captureFullPage`（`screenshot.js:70-122`）：注入 `prepareFullPage` 隐藏 fixed/sticky、滚到顶、量高度（`:13-38`）；循环滚动 + `captureVisibleTab` 分片 + `OffscreenCanvas` 白底合成（`:81-109`）；失败回退可见截图并标 `visible-fallback`（`service-worker.js:162-168`）。
- `[观察]` 硬上限 `MAX_HEIGHT=16000`、`guard<80` 个 tile（`screenshot.js:81, 93`），超出静默截断；fixed/sticky 只在开始时隐藏一次（`:16-25`），滚动中出现/变化的吸顶元素可能被重复截入；每 tile 等待 220ms + 360ms（`:97, 108`），长页耗时长且中途切 tab 会失败 `[推断]`。
- `[观察·e2e]` 已覆盖（`e2e.js:523-529`）。
- 缺口：无进度反馈（长时间无 UI）、无分段输出（超长页）、无"截取当前区域/元素整块"、无编辑（清单 12）。

**落点建议**：低成本健壮性（S）——每次滚动后重新隐藏 fixed/sticky、捕获失败重试、把 `MAX_HEIGHT`/tile 数变成设置项、超限分段保存（M）。**建议做 S 项，分段输出 M 缓**。

**评级**：价值 中；成本 S/M；建议 做（S）。

---

#### 3.C.4 截图前裁剪/编辑（清单 12）— 判定：**缺失**

- `[观察]` 没有截图编辑器：全仓检索 `crop|裁剪` 只命中 `media.js:151-167`（元素截图内部裁剪）与 `service-worker.js:14, 174-175` 的调用；没有 canvas 标注/裁剪 UI、没有"保存前预览编辑"。
- `[观察]` **一个重要有利条件**：`captureAndSave` 支持传入 `dataUrl`（`service-worker.js:156-160`），意味着"编辑后的截图"可以直接回传保存，后台无需新链路。
- 缺什么：裁剪框、箭头/方框/文字、马赛克、撤销、尺寸显示；以及非截图图片的"编辑后另存"。

**落点建议（比预想便宜）**
- 新增 `content/shot-editor.js`（或复用 hover 的 shadow 遮罩）：截图 → 在页面内以 `<canvas>` 打开编辑器 → 输出 `dataURL` → `chrome.runtime.sendMessage({type:'save-screenshot', dataUrl})`，后台 `captureAndSave` 已支持。
- 第一版只做裁剪（S/M）：拖拽矩形 + 确认；第二版加箭头/文字/马赛克（M）。
- 注意：大图（整页）canvas 内存与最大尺寸（16000px）；建议先只对"可见/元素/小整页"开放编辑 `[推断]`。

**评级**：价值 中高；成本 M；建议 **做**（第一版只做裁剪）。

---

#### 3.C.5 大图 URL 放大（清单 13）— 判定：**缺失**

- `[观察]` 无 URL 改写/站点规则：全仓无 `urlEnlarger/站点规则/siteRule`；`fetchMedia` 只 fetch `item.url`（`media.js:40-94`）；hover/drag/popup 也只用当前 `currentSrc`。
- Eagle 侧有 `eagle.urlEnlarger` 与下载器里"先尝试转大图"（`docs/research/eagle-static-analysis.md:138`）。
- 缺什么：host → URL transform 规则（如去掉 `?imageView2/...`、`_thumb` 后缀、`/w/300` 段），以及"先试大图、失败回退原图"的流程。
- 落点建议：新增 `background/site-rules.js`（`host` 正则 → 改写函数数组），`fetchMedia` 前应用；**先只做 3–5 个高频站点**，并且必须在失败时回退原 URL。规则会腐化，需可关闭（设置项）。**建议缓**（先观察真实失败分布，别为清单而做）。

**评级**：价值 中；成本 M；建议 **缓**。

---

#### 3.C.6 站点适配插件（21 站点）（清单 14）— 判定：**缺失**

- `[观察]` 无 `siteParser`/站点适配（全仓 0 命中）；只有通用 DOM 识别（`hover.js:24-112`、`drag-save.js:120-179`）。
- Eagle 侧有站点适配器概念（`eagle-research.md:108`；21 站点数量来自清单 `[未知]`）。
- **判断**：这类功能是"生态型"投入：每个站点要维护选择器/字段映射，站点改版即失效，且需要逐个测试。Ant-col 是个人本地工具，收益/维护比不划算。
- **替代**：3.A.10 的通用提取器 + 可配置 `site-rules`（少量 URL 改写）+ 手动兜底（元素截图/悬浮保存）。**建议不做**。

---

### D. 批量工作台、队列与导入（清单 8、20、27–29）

#### 3.D.1 批量保存工作台（清单 8）— 判定：**部分**

**Eagle 口径**：批量保存面板（`import-images`，`eagle-static-analysis.md:42-68`；清单提到扫描/筛选/选择/进度/视频悬停预览/区域框选）。

**Ant-col 现状**
- `[观察]` popup 有：本页扫描（`popup.js:248-312`）、尺寸筛选（`popup.html:45-50`、`popup.js:297-300`）、网格多选/全选（`popup.js:314-374`）、进度条（`:393-401` + `:496-502`）、保存汇总（`:404-408`）、最近列表（`:108-134`）；扫描上限 300（`:245`），≤12 张自动全选（`:308-310`）。
- `[观察]` 扫描通过 `chrome.scripting.executeScript` 注入函数（`:278-283`），包含 CSS 背景图（`:216-242`）。
- `[观察·e2e]` 扫描已测（`e2e.js:203-210`）；批量保存下载模式已测（`:399-424`）。
- **缺口**：
  1. **不能选目标项目**：`saveSelected` 的 meta 只有 `tags/note`（`popup.js:392`），后台 `resolveCollection` 落到默认项目（`save.js:38-48, 341`）。
  2. **视频在网格里是破图**：`renderGrid` 一律 `img.src = img.url`（`popup.js:323-333`），视频 URL 无法当图片渲染 → error → ⊘；没有 `<video>` 预览/悬停播放/时长。
  3. **失败不可见/不可重试**：只 toast 汇总（`:404-408`），没有失败清单；但 `results` 里 error 项**保留了原始 item**（`save.js:359`），所以前端重试成本很低。
  4. **无区域框选**（清单要求）、无自动滚动（见 3.A.9）、无"按域名/类型筛"。
  5. 无"扫描后去重标记"（已保存过的项没有视觉标记）。

**落点建议**（详细见 §6.3）
- `renderGrid` 按 `kind` 分支：`video` 渲染 `<video muted preload="metadata" poster=...>`，hover 播放 1–2s；`image` 保持 `<img>`。
- 失败列表：保存后展示 `res.error` 项（url/error），提供"重试失败项"（复用 `state.images` 里同 URL 的 payload）。
- 目标项目：header 加 `<select id=batchProject>`（数据来自 `state.settings.collections`），save 时 `meta.collection`。
- 区域框选：不一定要在 popup；可复用元素截图（清单 10）作为"框选"补充。

**评级**：价值 中高；成本 M（视频+失败+项目 S/M）；建议 **做**。

---

#### 3.D.2 采集进度/队列/错误提示（清单 20）— 判定：**部分**

- `[观察]` 队列：`saveItems` 内部 3 并发 worker（`save.js:349-368`），先算 `knownHashes/knownLinks`（`:343-345`），每条结果 push，`save-progress` 消息（`:362-364`）；popup 进度条（`popup.js:496-502`）。
- `[观察]` 结果汇总：`saved/duplicate/error/mode/collection/items`（`save.js:370-378`）；`afterSave` 生成 toast/通知（`service-worker.js:194-210`），失败用 error tone（`:209`）。
- `[观察]` 没有：持久 job 记录（SW 被回收即丢）、失败重试、逐条错误详情面板、任务历史、`alarms/keepalive`（全仓 0 命中）、节流/限速设置。
- **风险** `[推断]`：MV3 SW 在批量大图（fetch+hash+写盘）期间可能被判空闲回收；代码没有 `offscreen`/keepalive 保活，长任务失败率随文件数与体积上升。
- 落点建议：
  - `saveItems` 返回里已有 error item；`background` 把 job 摘要写 `storage.local.jobs`（最近 20 条：时间/总数/成功/失败/错误码分布），popup/settings 展示（S）。
  - 批量期间每 20s 调一次 `chrome.runtime.getPlatformInfo()` 或 `chrome.storage` 轻量保活（`[推断]` 有效但非官方保证）；更稳的是把大批量拆成小批（每批 10 条）由 popup 驱动（S/M）。
  - 失败重试：popup 重发失败 payload（S）。

**评级**：价值 中高；成本 M；建议 **做（失败明细/重试/任务记录）**。

---

#### 3.D.3 去重/重复提示（清单 27）— 判定：**已有**（项目维度，非全局）

- `[观察]` 抓取后 `sha256Hex`（`media.js:96-99`），去重键 `sha::collectionPath`（`save.js:288-297`）；链接按 URL + 项目（`:291-293`）；命中返回 `{status:'duplicate', existing}`（`:293-296`），不重复写盘。
- `[观察]` 提示：面板显示"这个收藏夹里已有相同内容 + 路径"（`drag-save.js:913-915`）；批量 toast 汇总"跳过 N 项重复"（`service-worker.js:200-208`）；`e2e.js:500-507` 覆盖。
- `[观察]` 设计优势：**同一张图可以进不同项目**（去重键含项目），这是有意的（README:35），不要改成全局去重。
- 缺口：① 去重源是内存里的索引（`save.js:343-345`），索引超 8000 被裁剪（`store.js:10, 92`）后，老素材不再参与去重 `[推断]`；② 没有"查看已有/仍要保存"选择；③ 没有全局重复清理/合并；④ 下载模式下重名 `conflictAction:'uniquify'`（`downloads-writer.js:72`）会生成 `-1` 副本，但索引不会记录同名关系 `[推断]`。
- 落点建议：面板重复状态加"查看已有 / 仍要保存（换名）"；可选持久 dedupe 索引（sha 列表，独立 storage key，S/M）；全局重复审查（M）缓。
- **评级**：价值 中；成本 S/M；建议 **做提示增强（S），全局清理缓**。

---

#### 3.D.4 缓存与性能（清单 28）— 判定：**部分**

- `[观察]` 已有：写入串行链 `indexWriteChain`（`store.js:74-99`）、镜像串行 `mirrorChain`（`fs-writer.js:84-105`）、并发 3（`save.js:349`）、缩略图 IDB 缓存（`thumb-store.js:21-42`；`save.js:320-326`；`library.js:227-258` 的 blob URL 内存缓存）、`fetch` 用 HTTP 缓存 `force-cache`（`media.js:54`）。
- `[观察]` 缺：下载/抓取结果的扩展侧缓存（无 cache-helper 等价物）、持久任务队列、库页面虚拟滚动（`library.js:313-336` 一次 render 最多 120，可"加载更多"，但没有回收/虚拟化）、`library-state` 全量 items 消息（`service-worker.js:299-327`；8000 条时消息数 MB 级 `[推断]`，基线 §6.5 同结论）、无 sidecar 重建扫描。
- **注意**：这项与 `docs/eagle-optimization-plan.md` 的 P0-1/P0-2/P1-3 高度重叠。**本任务不建议单独立项**，应并入优化方案统一做，否则会和"文件即真相/缩略图落盘/组织模型 v3"打架。
- **评级**：价值 高（大库）；成本 M/L；建议 **缓（并入优化方案）**。

---

#### 3.D.5 批量导入图片（清单 29）— 判定：**部分**

- `[观察]` 现有"本页批量"（`popup.js:170-312`）是网页内图片导入，不是 Eagle 的 `import-images`（本地文件/多 URL 批量入面板，`eagle-static-analysis.md:42-68`）。
- `[观察]` 无本地文件选择/拖入（全仓无 `<input type=file>`、无 `dataTransfer.files`；`FileReader` 只在 `drag-save.js:49` 用于 blob→dataURL）；无剪贴板图片粘贴；无多 URL 文本导入；无"OS 拖入"（README:272 自认）。
- 落点建议：在 **素材库页面**加 drop zone（`File` → 读取 arrayBuffer → FSA 写入 `文件/YYYY-MM/` 或按类型目录 → 生成 record/sidecar/索引；缩略图同链路）。好处：不依赖 content script、不改采集入口、天然补"本地文件"类型（现在 `file` kind 无生产者 `config.js:25-31`）。
- 另可加剪贴板粘贴（`paste` 事件图片）——比拖入更简单（S）。
- **评级**：价值 中高；成本 M；建议 **做**。

---

### E. 系统、设置与生态（清单 21–25、30）

#### 3.E.1 偏好设置（清单 21）— 判定：**部分**

**Ant-col 实际可用的设置（11 项）**
- `[观察]` `targetMode`（auto/folder/downloads）、`downloadsSubfolder`、`filenameTemplate`、`collections`、`minImageSize`、`screenshotFormat`（png/jpg）、`dedupe`、`saveSidecar`、`autoTags`、`includeBackgroundImages`、`useReferrer`（`options.html:34-125`；`options.js:48-62` 渲染、`:199-227` 绑定）。
- `[观察]` 导出索引 JSON/CSV、清空索引、打开库、打开下载目录（`options.html:135-141`）。
- `[观察]` 快捷键说明书在 footer（`options.html:147`）与 README（`README.md:144-155`）。

**与清单的差距（逐项）**
| 清单项 | 现状 | 证据 |
| --- | --- | --- |
| 主题 | **声明未实现**：`theme:'system'` 只在默认设置里出现 1 次，无 UI、无读取；三处 CSS 都写死 `color-scheme: dark` | `config.js:21`；`popup.css:2`、`library.css:2`、`options.css:2` |
| 语言 | 缺失（见 3.E.2） | 无 `_locales` |
| 格式 | 部分：截图 png/jpg 可选；图片转码格式无选择 | `options.html:110-116` |
| 质量 | **有字段无 UI**：`screenshotQuality:92` 仅内部使用 | `config.js:14`、`save.js:256` |
| Retina/DPR | 缺失：元素截图用 `devicePixelRatio` 但无开关/缩放策略 | `hover.js:284` |
| 延迟 | 缺失：整页截图等待硬编码 220/360ms | `screenshot.js:97, 108` |
| 拖拽模式 | 缺失：拖拽必弹面板（无"直存/面板"偏好） | `drag-save.js:362-378` |
| 快捷键 | 部分：靠浏览器快捷键页，无产品内 UI（见 3.E.3） | `manifest.json:55-75` |
| 日志 | 缺失（见 3.E.4） | — |
| 其他 | `toast` 设置声明但无人读取 | `config.js:16`，全仓 0 处读取 |

**落点建议（打包做，S）**
- 主题：三处 CSS 已经集中深色，改成 `:root[data-theme=light]` 变量 + `theme` 读取（`library.css` 已有变量；popup/options 需抽变量）；或干脆从 DEFAULT_SETTINGS 删掉 `theme`，避免"假设置"。
- 质量滑杆（jpg）、整页等待时间、拖拽模式（直存/面板）、元素截图 DPR 策略。
- 设置页加"高级"折叠区，把低频项收进去，避免主界面膨胀。

**评级**：价值 中；成本 S/M；建议 **做小项打包（S）；主题按需**。

---

#### 3.E.2 i18n/多语言（清单 22）— 判定：**缺失**

- `[观察]` 无 `_locales/`、无 `chrome.i18n`（全仓 0 命中）；`manifest.json` 名称/描述、所有 UI 文案硬编码 `zh-CN`（如 `manifest.json:3-6`、`popup.html:3`、`options.html:3`、`library.js:7-9`）。
- 现实收益：单用户中文场景 ≈ 0；成本 L（要抽几百条文案 + manifest 本地化 + 布局适配）。**建议不做**（若未来上商店再评估）。

---

#### 3.E.3 快捷键自定义（清单 25）— 判定：**部分**

- `[观察]` 5 个 `commands`：`save-hovered`(Alt+S)、三档截图（Alt+Shift+S/E/F）、`save-page-images`（无默认键）（`manifest.json:55-75`）；后台分发（`service-worker.js:107-138`）；popup/options 都只是文字说明（`popup.html:59-64`、`options.html:147`）。
- `[观察]` 用户可通过浏览器扩展快捷键页改（README:155 明确指引）——**功能上可自定义，产品内无编辑器**。
- 缺口：不能在 Ant-col 内部查看/改/冲突检测；`save-page-images` 无默认键容易被忽略。
- 落点建议：设置页加只读快捷键列表 + `chrome.commands.getAll()` 显示实际绑定 + "去修改"按钮（打开 `chrome://extensions/shortcuts` 不能直接 `tabs.create` `[未知]`，可能需提示用户手动打开）；成本 S。**建议缓/顺手做**。

**评级**：价值 低；成本 S；建议 **缓**。

---

#### 3.E.4 日志查看器（清单 23）— 判定：**缺失**

- `[观察]` 无日志模块（全仓 0 命中 `logger/日志/log-level`）；只有 toast（`hover.js:192-202`）与通知（`service-worker.js:219-226`），以及 `stats`（`store.js:134-155`）。
- 现实收益：低；但"保存失败为什么失败"目前只有一次性 toast，用户无法回看。**替代方案**：轻量"诊断"面板（最近 20 条 job 结果 + 错误码分布 + 当前设置摘要 + 复制诊断 JSON），成本 S，价值中低。**建议缓（做轻量诊断，不做完整日志查看器）**。

---

#### 3.E.5 Eagle 深链跳转（清单 24）— 判定：**缺失**

- `[观察]` 全仓无 `eagle://`；"定位"能力是 `chrome.downloads.show(id)` / `showDefaultFolder()`（`service-worker.js:468-474`、`downloads-writer.js:87-103`）；文件夹模式"定位"实际只 toast 路径（`library.js:491-494`）。
- 说明：`eagle://` 是 Eagle 客户端协议，Ant-col 没有客户端，**不应照搬**；等价价值是"从外部链接/脚本直接打开库并选中某条素材"。
- 落点建议：**不做 Eagle 深链**；如需互操作，可给 `library/library.html#id=<id>` 内部 hash 深链（S，顺带提升可分享/可脚本化）。

**评级**：价值 低；成本 S；建议 **不做（可顺手做内部 hash 深链）**。

---

#### 3.E.6 权限/能力门控（清单 30）— 判定：**部分**

- `[观察]` `manifest.json` 权限较宽：`storage, unlimitedStorage, downloads, contextMenus, scripting, activeTab, tabs, notifications` + `host_permissions: <all_urls>`（`:8-20`）；没有 `optional_permissions/optional_host_permissions`。
- `[观察]` 已有运行时门控：
  - popup 只允许 `http/https/file` 页面扫描，浏览器内部页给出可读提示（`popup.js:264-272`）；
  - `chrome.action.openPopup()` 失败降级为提示（`service-worker.js:140-146`）；
  - 元素截图在不可注入页面提示（`:148-154`）；
  - FSA 权限检查与三种目标模式（`fs-writer.js:5-10`、`save.js:24-36`）；
  - 保存失败按 error tone 提示（`service-worker.js:194-210`）。
- 缺口：无能力矩阵/降级策略文档；错误码（`MediaError.code`）没有映射为可行动文案；没有实验开关/功能门控；权限请求时机不区分（`<all_urls>` 一次全要）。
- 落点建议：`background/capabilities.js`（能力探测：FSA、OffscreenCanvas、`createImageBitmap`、`chrome.action.openPopup`、下载 API）集中判断；错误码→用户文案表；设置页"能力与限制"卡片。成本 S/M，价值中低。**建议缓**。

**评级**：价值 中低；成本 S/M；建议 **缓**。

---

## 4. Ant-col 相对 Eagle 的优势（明确列为优势，**不要建议推翻**）

> 这一节是给后续方案设边界的：下面这些是 Ant-col 的**设计优势**，任何"对齐 Eagle"的改动都不应以牺牲它们为代价。

| # | 优势 | 证据 | 为什么重要 | 建议 |
| --- | --- | --- | --- | --- |
| 1 | **纯扩展、无本地服务、无端口** | 全仓无 server/listen/port 代码；`manifest.json` 只有 SW；对比 Eagle 需要 Electron + 41593/41595（`eagle-research.md:54-83`） | 安装即用、无进程常驻、无端口暴露面；这是 Ant-col 最核心的差异化 | **保持**；任何"本地 API/深链"需求都不应引入常驻服务 |
| 2 | **File System Access 直写 + 下载目录兜底 + auto 模式** | `fs-writer.js:5-54` 直写；`downloads-writer.js:50-80`；`resolveTarget` auto/folder/downloads（`save.js:24-36`）；权限失效静默回退下载（`:32-35`） | 不选文件夹也能用；选了文件夹文件就在用户指定位置；失败有兜底，不会"收不进来" | **保持**；新增写入路径必须复用 `resolveTarget`/`writeRecord` |
| 3 | **统一 payload + 项目维度去重** | 所有入口汇入 `saveItems`（`service-worker.js:445-450`、`save.js:339-379`）；11 个入口共用一套 record（`save.js:72-119`）；去重键 `sha::collectionPath`（`:288-297`） | 一图多项目是刻意设计；入口再多也不产生第二套数据模型 | **保持**；不要改成全局去重 |
| 4 | **sidecar + `_index.json`（文件可读、可迁移）** | `sidecarFor`（`save.js:121-147`）、写 sidecar（`:162-164, 175-182`）、`_index.json` 镜像（`fs-writer.js:73-105`、`save.js:315-317`）、`root-changed` 回灌（`service-worker.js:401-412`） | 资源管理器可读、丢浏览器 profile 仍能救回部分元数据；这是"文件是真相"的雏形 | **保持并强化**（补目录扫描/重建，见优化方案 P0-1；不要退回纯 IDB） |
| 5 | **Inbox triage（K/A/→/Esc）+ 状态机 inbox/kept/archived** | `library.js:531-662`（键盘 `:655-660`）、状态筛选（`:108-110`）、徽标计数（`service-worker.js:229-236`）、批量 kept/archived（`library.js:761-762`）、`e2e.js:627-645` | "先收再整理"是产品哲学；清单里 Eagle 没有等价的 Inbox 状态机，这是 Ant-col 的顺手体验 | **保持**；星级/评分应接进 triage，而不是替代它 |
| 6 | **Markdown / CSV 导出（当前筛选/选中）** | 库导出：`library.js:685-721`（选中优先 `:687-688`）；索引导出 JSON/CSV：`service-worker.js:384-399`；e2e:646-648；产物 `test/out/downloads/Ant-col-导出-20261019.md` | 交付到设计/文档/表格的最后一公里；纯文本可 diff/可脚本 | **保持**；新增字段（star）时同步导出列 |
| 7 | **搜索前缀语法** | `parseQuery`：`tag:/#`、`project:`、`site:`、`kind:`、`is:`（`library.js:90-101`）；组合筛选（`:103-133`）；`/` 聚焦搜索（`:786-791`） | 比纯文本搜索更精确，且实现极轻 | **保持**；可扩展 `star:`/`minsize:`（S） |
| 8 | **缩略图 IDB 缓存（离线可用）** | `thumb-store.js:21-42`；保存时生成 360px JPEG（`save.js:320-326`）；库/详情 blob URL + 内存缓存（`library.js:227-258, 464-485`） | 不依赖远端 URL、无需落盘；清索引可清缓存（`service-worker.js:458-461`） | **保持**；若按优化方案落盘缩略图，IDB 应降级为渲染缓存而非删除 |
| 9 | **自包含 HTML 链接卡片** | `save.js:195-238, 267-273`；产物 `test/out/.../链接/...html` | 比 `.url` 信息量大（标题/备注/来源/样式），离线可读、可打印 | **保持**；补缩略图即可，不要退回 `.url` 单一格式 |
| 10 | **UI 隔离与轻量** | 所有页内 UI 用 Shadow DOM（`hover.js:160-190, 210-229`；`drag-save.js:225-344, 457-510, 619-739`），`z-index` 固定最高；无框架、无构建 | 不污染宿主页面样式；加载快、易维护 | **保持**；新增页内 UI 继续走 shadow |
| 11 | **完全本地 / 无账号 / 无遥测 / 无第三方依赖** | `package.json` 无依赖；无网络上报；`host_permissions` 仅用于抓取；README:6 | 隐私与可审计性；也是"文件可迁移"的前提 | **保持** |
| 12 | **错误可见 + 逐项结果** | `afterSave` 汇总/通知（`service-worker.js:194-210`）、逐项 `{status,error,code}`（`save.js:346-368`）、面板内联错误（`drag-save.js:870-928`） | 批量保存不是黑盒；为失败重试提供了数据基础 | **保持**；扩展成"失败清单/重试"（本报告建议） |

---

## 5. Top 10 缺口（按价值/成本排序）

> 排序原则：先看"价值/成本"比，再看是否卡住主链路。依赖未完成的大项（组织模型 v3、优化方案 P1-3）不硬塞进前 10。

| 排名 | 缺口 | 价值 | 成本 | 建议 | 落点 | 依赖/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **星级评分贯穿**（面板/详情/筛选/triage/导出/sidecar） | 高 | **S** | **做** | `save.js:87-147`、`service-worker.js:334-355`、`library.js:103-133, 369-515, 531-662`、`drag-save.js:604-956` | 无；见 §6.1 |
| 2 | **右键"保存到项目"动态子菜单** | 高 | **S** | **做** | `service-worker.js:43-55, 57-105, 430-437` | 需在 add-collection 后重建菜单 |
| 3 | **拖拽浮层"丢到项目即入库"（可 Shift 开面板）** | 高 | **S** | **做** | `drag-save.js:362-378, 870-928` | 无；见 §6.2 |
| 4 | **批量工作台：视频预览 + 失败明细/重试 + 目标项目** | 中高 | S/M | **做** | `popup.js:314-351, 376-422`、`popup.html:80-98` | 失败 payload 已在 `save.js:359` 保留，重试成本低 |
| 5 | **截图裁剪/标注（先只做裁剪）** | 中高 | M | **做** | 新增 `content/shot-editor.js`；`service-worker.js:156-160` 已支持 dataUrl 回传 | 大整页图内存需限制 |
| 6 | **标签面板升级（历史/星标/搜索/标签管理）** | 中高 | M | **做** | `service-worker.js:253-261`、`drag-save.js:823-836`、`library.js:175-196` | 需 `tagsMeta` 存储；管理页可后置 |
| 7 | **本地文件/剪贴板导入（补 `file` kind 生产者）** | 中高 | M | **做** | `library/library.html` + 新 `background/import.js`；复用 `writeRecord`/`sidecarFor` | 需决定文件目录（`文件/YYYY-MM/`） |
| 8 | **元素截图覆盖超视口元素 + 自由矩形** | 中 | M | **做** | `hover.js:206-298`、`service-worker.js:173-176`、`screenshot.js:70-122` | 超视口走整页截图裁剪 |
| 9 | **抓取失败兜底（元素截图/重试）+ 失败原因文案** | 中 | S | **做** | `save.js:275-286, 356-360`；复用 `service-worker.js:148-176` | 不做完整下载回导 |
| 10 | **链接卡片缩略图（页面截图/og:image）** | 中 | S | **做** | `save.js:267-273, 320-326`；复用 `captureVisible` + `putThumb` | 需当前 tab 可用 |

**紧随其后（不占 Top 10，但值得排期）**：
- 文件夹树/最近/收藏夹（价值高、成本 M/L）——**必须并入** `docs/eagle-optimization-plan.md §5.3` 的组织模型 v3，单独做会返工。
- 整页截图健壮性（S）→ 建议跟着"截图编辑器"一起做。
- 轻量诊断面板（S）→ 跟着"失败明细"一起做。

---

## 6. 建议先做的 3 个功能（实现草图）

### 6.1 星级评分（贯穿数据/交互/检索）

**为什么第一**：数据模型只缺一个字段，但收益贯穿"采集→Inbox→整理→找回→导出"；Eagle 的 `star` 也是同款字段（`eagle-research.md:141`、`eagle-runtime-probe.md:203`），未来互操作零成本。

**数据层**
- `buildRecord` 增 `star: Number(meta.star ?? item.star ?? 0)`，clamp 0–5（`save.js:87-118`）。
- `sidecarFor` 增 `star`（`save.js:121-147`）；旧 sidecar 无该字段 → 读时默认 0（`importFolderIndex`/库加载做默认）。
- `updateItems` patch 接受 `star`（`service-worker.js:334-348`），写 sidecar 时自动带上（`:357-369` 已按 `sidecarFor` 重写）。
- `_index.json` 无 schema 版本，字段向前兼容（`fs-writer.js:73-105`）。

**交互层**
- 拖拽面板：`.field` 加 5 星按钮（`drag-save.js:661-668` 的 field 样式复用），payload 加 `star`（`:886-902`）。
- popup 批量：composer 加 5 星（`popup.html:80-98`），`saveSelected` 的 `meta` 加 `star`（`popup.js:392`）。
- 库详情：状态行下加 5 星（`library.js:391` 附近），`detailSave` 的 patch 加 `star`（`:500-508`）。
- 库批量栏：`#batchStar`（可直接用 prompt 或 5 个小按钮），调用 `updateItems([...selected], { star })`（`library.js:751-762` 现有模式）。
- triage：数字键 1–5 设星级，0 清除；与 K/A/→ 并存（`library.js:655-660`）。

**检索/展示/导出**
- 卡片角标显示星级（`library.js:285-288` 的 badge 旁）。
- 筛选：`is:starred`（star>0）、`star:>=3` 或独立"星标"导航项；排序加 `star`。
- 导出：CSV header 加 `star`（`library.js:692`）；MD 行加"星级"（`:712`）；索引 CSV 同步（`service-worker.js:387`）。

**验收（建议补 e2e，不在本任务执行）**
- 保存带 star → sidecar 含 star；库详情改 star → `_index.json` 镜像更新；`is:starred` 过滤正确；旧数据默认 0。

**成本**：S（约 150–250 行，6 个文件）。**风险**：无；唯一注意是"sidecar 是旧版"的默认值路径。

---

### 6.2 右键项目子菜单 + 拖拽直存（"采集即归类"套餐）

**为什么第二**：Ant-col 的采集入口已经够多，但**最快的两个入口都不能选项目**（右键只能进默认项目，拖拽落项目后还要点保存）。补齐这两点，Eagle 的"拖到文件夹"优势就被抵消，且几乎不碰数据模型。

**6.2.1 右键动态子菜单**
- `createMenus()` 读取 `settings.collections`（`service-worker.js:43-55`），生成：
  - `save-image-to:<name>` / `save-video-to:<name>` / `save-link-to:<name>` / `save-page-to:<name>`（只给前 12 个项目，避免菜单爆炸）；
  - 可选"最近使用"置顶（配合 `recentCollections`）。
- `onClicked`：解析 `menuItemId` 前缀 → `saveItems([...], { tags: [], note: '', collection: name })`（复用 `:62-92`，`resolveCollection` 在 `save.js:38-48` 已支持 `meta.collection`）。
- **必须**：`add-collection`（`:430-437`）、设置页改项目（`options.js:210` 的 `parseCollections` 保存后）都调用 `createMenus()`；否则菜单与设置不同步。
- `contexts` 要分别给 image/video/link/page，避免在错误上下文出现。

**6.2.2 拖拽直存**
- 在 `drop` 处理里区分两种意图（`drag-save.js:362-378`）：
  - 默认：直接 `sendMessage({type:'save', items:[payload], meta:{collection: name}})`，成功 toast 显示 `relativePath`，**不打开面板**；
  - 按住 Shift/Alt（或点左侧"先改标签"）：保留现有 `openPanel`。
- 保留面板的价值：标题/标签/备注。直存时用自动命名 + 自动标签（`save.js:56-70`），并在 toast 里给"撤销/再编辑"？——**第二版**可加"编辑"按钮（打开详情抽屉），第一版不做。
- 需要给"直存"一个可见反馈（toast 已有 `vv-toast`，`hover.js:142-146`），否则用户不知道是否成功。

**6.2.3 外部/桌面拖入（可后置）**
- 在库页面加 drop zone：`File` → `arrayBuffer` → 新 `importFiles`（复用 `writeRecord`/`sidecarFor`/`putThumb`），按 `文件/图片/视频` 分目录。
- 与 §6.3 的"本地文件导入"合并做更划算。

**成本**：S（右键+直存）/ M（外部拖入，与 6.3 合并）。**风险**：Chrome 菜单数量上限与 id 稳定性；直存会让"标题/标签"默认化，需要保留一个显式入口进面板（Shift）。

---

### 6.3 批量工作台补完（视频预览 + 失败明细/重试 + 目标项目）

**为什么第三**：这是"看起来在哪、实际不能用"的典型：视频在网格里是破图，失败只弹一个 toast，批量只能进默认项目。三处都有现成数据，成本低收益直接。

**6.3.1 视频预览**
- `renderGrid`（`popup.js:314-351`）按 `img.kind` 分支：
  - `video`：`<video muted playsinline preload="metadata" src=...>` + `hover` 时 `play()`，移出 `pause()`；无 poster 时也可用第一帧（`[推断]` 浏览器会显示首帧）。
  - `image`：现状不动。
- 顺带：`collectImages` 对视频应记录 `poster`（`popup.js:204-214` 目前 video 无 poster 字段），便于静态占位。
- 库页面同问题：`save.js` 只给 image 生成缩略图，video 退 glyph（`library.js:248-257`）——可选后续补"视频缩略图落盘"（优化方案 P0-2）。

**6.3.2 失败明细/重试**
- `saveSelected`（`popup.js:376-422`）已经把 `res.items` 全量返回；把 `status==='error'` 的项渲染成列表（URL + `error`），每条给"重试"，全部失败给"重试全部"。
- 重试不需要重新扫描：`state.images` 里按 URL 找到原 payload，重新 `send({type:'save', items:[...失败项]})`。
- 失败原因按 `code` 给行动建议：`HTTP_ERROR`（防盗链→试试元素截图）、`TIMEOUT`（重试/换网络）、`TOO_LARGE`（>220MB，`media.js:3`）、`BLOB_URL`（用元素截图）。

**6.3.3 目标项目选择**
- `popup.html` header 加 `<select id="batchProject">`，初始化自 `state.settings.collections`（`state` 已有 `settings`，`popup.js:55-68`）。
- `saveSelected` 的 `meta` 加 `collection`（`:392`）；后台 `resolveCollection` 已支持（`save.js:38-48`）。
- 顺便记"最近使用项目"（localStorage），下次默认。

**6.3.4 可选（S）**
- 网格角标"已保存过"（已知 sha 需要先算，成本高；可先用 URL 在 `state.recent` 里匹配，弱判据，标"可能已保存"）。
- 自动滚动加载（见 3.A.9）。

**成本**：S/M。**风险**：视频 `<video>` 在 popup 尺寸下多实例可能卡顿 → 只对 hover 的实例 `play()`，并 `preload="metadata"`。

---

## 7. 建议明确不做 / 缓办的

### 7.1 明确不做①：21 个站点适配器 + board-saver 瀑布流抓取

**理由**
- **维护成本是负资产**：每个站点是一组选择器/字段映射，站点改版即失效；21 个站点意味着持续回归测试，而 Ant-col 是个人项目（`package.json` 无依赖、无 CI）。
- **与定位冲突**：Ant-col 的差异化是"纯扩展、本地、文件即库"；站点适配与收藏板抓取会把复杂度拉向"爬虫工具"，且需要模拟滚动/登录态，风险（触发反爬/账号风控）高于收益。
- **通用方案已覆盖大部分**：本页批量（`popup.js:170-312`）+ 悬停/拖拽识别（`hover.js`、`drag-save.js`）已经能处理绝大多数页面；补"自动滚动"和"通用提取器"即可。
- **Eagle 侧证据不足**：21 站点/board-saver 在本仓库文档中无逐项核实（`[未知]`），不值得按清单盲抄。

**替代路线**
1. `content/extract.js` 通用提取器（srcset 最大候选、data-src、og:image、视频首帧）——见 3.A.10；
2. popup "自动滚动加载更多"——见 3.A.9；
3. 极少量 `site-rules`（只做 URL 改写，不做 DOM 适配）——见 3.C.5，且规则可关闭。

### 7.2 明确不做②：多库切换 + Eagle 深链/本地 API

**理由**
- **多库**：`store.js` 单 `rootHandle` 的设计让所有路径/镜像/sidecar 只有一个根；改成多库要动 `resolveTarget`、`_index.json`、权限恢复、统计、设置页、库页面，成本 L，而"项目"已经提供 90% 的分库心智（`config.js:19`、`save.js:38-48`）。真需要隔离时，用"导出/导入 + 换文件夹"更符合"文件即库"。
- **Eagle 深链 / 本地 API**：`eagle://` 依赖 Eagle 客户端存在；41595 API 需要常驻服务（`eagle-research.md:54-83`）。Ant-col 的核心优势正是"没有本地服务/端口"（§4 优势 1）。引入本地 API 会把安装复杂度、防火墙/端口、安全面全部拉回来，收益只是"第三方脚本可调用"。
- **替代**：需要外部可寻址时，给 `library/library.html#id=<id>` 内部 hash 深链（S）；需要互操作时，用导出 JSON/CSV/MD + sidecar（已有，`service-worker.js:384-399`、`library.js:685-721`）。

### 7.3 建议缓办清单

| 项 | 原因 | 触发条件 |
| --- | --- | --- |
| 文件夹树/最近/收藏夹（清单 5） | 与组织模型 v3（`docs/eagle-optimization-plan.md §5.3`）重复，单独做会返工 | 优化方案 P0-3 启动时一起做；"最近使用"可先做 S |
| 大图 URL 放大（清单 13） | 规则腐化、需按站点维护 | 有真实失败样本（≥3 个高频站点）再按数据做 |
| i18n（清单 22） | 单用户中文场景收益≈0，成本 L | 上架商店/多语言用户出现 |
| 完整日志查看器（清单 23） | 收益低；失败信息可用轻量诊断替代 | 诊断面板不够用时 |
| 快捷键编辑器（清单 25） | 浏览器已提供，产品内编辑器价值低 | 用户明确要求时（先做只读展示 S） |
| 主题（清单 21 子项） | 三处 UI 已定深色品牌；主题要抽变量 | 用户明确要求时；否则删掉死设置 |
| 全局重复清理（清单 27 扩展） | 当前项目维度去重是有意设计；全局清理需先有"重复组"模型 | 库规模 ≥ 万级或用户反馈重复多 |
| 权限门控/能力矩阵（清单 30） | 当前运行时门控已覆盖主要失败面 | 接入新 API（如 offscreen）时一起做 |
| 多库（清单 7） | 架构性，见 7.2 | 不触发（用项目替代） |

---

## 8. 改动落点索引（按文件）

| 文件 | 涉及的清单项 | 具体落点建议 | 优先级 |
| --- | --- | --- | --- |
| `background/save.js` | 18, 16, 15, 20, 27 | record/sidecar 加 `star`（`:87-147`）；link 保存后补缩略图（`:267-273, 320-326`）；失败返回 `fallbackHint`（`:358-360`）；job 结果已有（`:370-378`） | P0/P1 |
| `background/service-worker.js` | 3, 18, 20, 23, 30 | 动态菜单 + `createMenus` 在 add-collection 后调用（`:43-55, 430-437`）；`update-items` 接受 `star`（`:334-355`）；job 记录/诊断（`:194-236`）；能力门控（`:140-154`） | P0 |
| `content/drag-save.js` | 1, 4, 6, 18 | drop 直存分支（`:362-378`）；面板星级（`:604-956`）；最近项目（`:381-410`）；标签面板（`:823-836`） | P0/P1 |
| `popup/popup.js` + `popup.html` | 8, 18, 20, 29 | 视频 `<video>` 预览（`:314-351`）；失败明细/重试（`:376-422`）；目标项目下拉（`:392`）；星级 | P1 |
| `library/library.js` + `library.html` | 5, 6, 18, 24, 29 | 星级筛选/展示/详情（`:103-133, 285-288, 391, 500-508`）；标签管理入口；drop zone 本地文件导入；`#id=` 深链 | P1 |
| `content/hover.js` | 2, 10, 12 | Alt+右键（`:137-153`）；框选模式（元素/矩形，`:206-298`）；交给编辑器前的入口 | P1 |
| `background/screenshot.js` | 10, 11, 12 | 超视口元素整页裁剪；fixed/sticky 每轮重隐藏（`:13-38`）；分段输出（`:81-109`） | P1/P2 |
| `background/fs-writer.js` | 4, 28, 29 | 目录扫描重建（P0-1，优化方案）；本地文件导入写入 | P2 |
| `background/store.js` | 21, 28 | `tagsMeta`/`recentCollections`/`jobs` 存储；索引增量（优化方案 P1-3） | P2 |
| `background/config.js` | 21 | 删/实现 `theme`、`toast` 死设置（`:16, 21`）；加 `star` 默认、质量/延迟设置 | P2 |
| `background/media.js` | 13, 15, 26 | URL 规则挂载点（fetch 前）；失败分类→行动建议 | P2 |
| `manifest.json` | 1, 25 | `drag-save.js` 加 `all_frames`；快捷键说明 | P2 |
| `options/options.html` + `options.js` | 21, 25, 30 | 高级设置区（质量/延迟/拖拽模式/主题）；快捷键只读展示；能力与限制 | P2 |
| 新增 `content/extract.js` | 14, 26 | 统一提取器（供 hover/drag/popup 复用） | P1 |
| 新增 `content/shot-editor.js` | 12 | 裁剪/标注编辑器，输出 dataURL | P1 |
| 新增 `background/import.js` | 29 | 本地文件/剪贴板导入（File→FSA→record/sidecar/thumb） | P2 |

---

## 9. 未知与边界

1. **未复跑 e2e**：所有"已有"结论基于代码阅读 + 既有 e2e 步骤 + `test/out/` 既有产物（生成于 2026-10-19），不是本次运行结果。若需发布前确认，建议先跑一次 `node test/e2e.js`（本任务按纪律未执行）。
2. **`.url` 下载行为未知**：`test/e2e.js:508-517` 曾探测 `chrome.downloads` 直接下载 `.url/.txt/.html`，但 `test/out/downloads/Ant-col素材/链接/` 只留下 `.txt` 产物，没有记录结论；若要做 `.url` 兼容，需先单独实测。
3. **Eagle 侧 21 站点/board-saver/批量视频预览/大图放大**：本仓库没有 Eagle 扩展源码可复核（仅有客户端逆向文档），这些能力的具体交互按清单口径描述，标 `[未知]`；对 Eagle 的"拖拽落文件夹即入库"等行为为 `[推断]`。
4. **性能判断未实测**：8 处以上"大库会慢"为结构推断（全量 items 消息、全量索引重写），与基线 §6.3/§6.5 结论一致，但未做万级压测。
5. **浏览器版本差异**：`chrome.action.openPopup`、`captureVisibleTab` 后台窗口、FSA 权限恢复、`chrome.downloads` 对特殊扩展名的处理，代码有兜底但未逐一验证。
6. **并发/数据一致性未验证**：多 tab 同时保存时的索引写链（`store.js:74-99`）是进程内串行，跨 SW 实例/多窗口的一致性未验证；sidecar 与索引在异常中断时的偏差未测。
7. **清单 5/7 的 Eagle 语义**（"最近使用收藏夹""多库切换"的具体 UI）来自通用认知 + 清单，本仓库 Eagle 文档只覆盖文件夹树/库切换 API（`eagle-research.md:203, 230-231`）。

---

## 10. 附录

### 10.1 e2e 覆盖对照（只读 `test/e2e.js`，未复跑）

| 清单项 | e2e 行号 | 说明 |
| --- | --- | --- |
| 2 悬停 | `:174-213` | 指针移动 + `vv-get-hovered` |
| 1 拖拽浮层/面板 | `:215-271`、`:314-350`、`:666-742` | 浮层、项目落点、图片/链接双模式、CSS 背景、`<a>` 包裹图回归 |
| 4 收集窗（选择/新建项目） | `:352-397` | 「＋ 建立或选择文件夹」→ 新建"临时收藏" → 面板目标项目更新 |
| 8 批量扫描 | `:203-210`、`:399-424` | 扫描 + 下载模式批量保存 |
| 4/16 链接卡片 | `:273-312`、`:518-521` | 图片内嵌链接双模式、链接卡片落盘 |
| 9 可见截图 | `:474-479` | — |
| 10 元素截图 | `:481-498` | 遮罩点击 → 裁剪保存 |
| 11 整页截图 | `:523-529` | `captureMode` 断言 |
| 27 去重 | `:500-507` | 重复保存返回 `duplicate` |
| 保存链路（sidecar + `_index.json`） | `:426-464`、`:602-625` | OPFS 目录树、sidecar、镜像 |
| 库页面（5/6） | `:531-601` | 初始化、缩略图 blob、分页、批量移项目、搜索、详情 |
| 19 备注/triage | `:586-645` | 详情更新、triage 保留 |
| 6 导出 | `:646-648` | Markdown 导出 |
| 21 设置页 | `:650-664` | `showDirectoryPicker` 存在性 |

### 10.2 既有运行产物（`test/out/`，本次未重新生成）

- `drag-page.png`（浮层）、`drag-panel.png`（收集面板）、`library.png`、`library-detail.png`、`library-triage.png`、`options.png`、`popup.png`。
- `downloads/Ant-col素材/` 下：拖拽图片 + sidecar、链接 HTML 卡片 + sidecar、可见/元素截图、项目子目录、`Ant-col-导出-20261019.md`。
- 这些产物证明"下载模式落盘、sidecar、链接卡片、截图、导出、项目目录"曾经真实跑通；**不能**证明本次代码仍通过（未复跑）。

### 10.3 "缺失"检索式与结果（全仓，排除 `.git/`、`test/out/`、`docs/`）

| 检索式 | 命中 | 用于 |
| --- | --- | --- |
| `_locales` / `chrome.i18n` | 0 | 22 i18n 缺失 |
| `eagle://` | 0 | 24 深链缺失 |
| `star(?!t)` / `rating` / `星级` | 0 | 18 星级缺失 |
| `switchLibrary` / `library/switch` / `多库` | 0 | 7 多库缺失 |
| `siteParser` / `站点适配` / `urlEnlarger` / `站点规则` | 0 | 13/14 缺失 |
| `srcset` | 0 | 26 无显式 srcset 解析 |
| `data-src` / `data-original` / `lazyload` / `懒加载` | 0 | 26 无懒加载兜底 |
| `board` / `瀑布流` / `收藏板` | 0（仅无关词 `clipboard`） | 17 缺失 |
| `logger` / `日志` / `log-viewer` | 0 | 23 缺失 |
| `historyTags` / `starredTags` / `tagGroups` | 0 | 6 标签面板缺失子项 |
| `offscreen`（API）/ `keepAlive` / `alarms` / `setInterval` | 0（`OffscreenCanvas` 除外） | 20/28 无持久队列/保活 |
| `theme` | 1（仅 `config.js:21`） | 21 主题死设置 |
| `settings.toast` | 0 | 21 toast 死设置 |
| `downloadFallback` / `回退下载` | 0（`visible-fallback`/缩略图 fallback 除外） | 15 无抓取回退 |
| `import-images` / `importFiles` / `dataTransfer.files` | 0 | 29 无本地文件导入 |

### 10.4 关键行号速查（本报告反复引用）

- 采集/保存：`save.js:24-36`（目标解析）、`:38-48`（项目解析）、`:56-70`（标签）、`:72-147`（record/sidecar）、`:240-337`（saveOne/去重/写盘/缩略图）、`:339-379`（批量队列/结果）。
- 后台：`service-worker.js:43-55`（菜单）、`:57-105`（菜单点击）、`:107-138`（快捷键）、`:156-192`（截图）、`:194-236`（保存后/通知/徽标）、`:238-328`（状态）、`:330-399`（更新/导出）、`:401-412`（索引回灌）、`:414-489`（消息表）。
- 内容脚本：`hover.js:24-135`（识别）、`:137-153`（消息）、`:155-202`（toast）、`:206-298`（元素框选）；`drag-save.js:120-179`（describe）、`:195-430`（拖拽页）、`:451-568`（项目选择器）、`:604-956`（保存面板）。
- 库：`library.js:90-133`（搜索/过滤）、`:135-218`（侧栏/头部）、`:227-336`（缩略图/卡片/网格）、`:338-367`（批量/更新）、`:369-515`（详情）、`:531-662`（triage）、`:685-721`（导出）。
- 存储/写入：`store.js:60-171`；`fs-writer.js:5-115`；`downloads-writer.js:50-103`；`media.js:40-167`；`screenshot.js:5-122`；`naming.js:5-128`；`thumb-store.js:21-42`。
