# Eagle 4.0.0 运行时落盘探针报告（保存路径 / library 排列）

> 角色：Team Lead 的并行研究员 `eagle-runtime`
> 环境：Windows 10.0.26300，Eagle **4.0.0 Build23 (20260401)**（`D:\Eagle\Eagle.exe`，Electron 22.3.7）
> 探针库：`D:\eagle-probe\probe.library`（从空库 `D:\Eagle\文章.library` 复制而来，未写入用户真实库）
> 原始证据：`D:\eagle-probe\evidence\`；探针脚本：`D:\eagle-probe\*.mjs`；本地测试服务器：`D:\eagle-probe\server.js`（127.0.0.1:8765）
> 时间：2026-10-19 18:50–19:09（Asia/Taipei）

标记约定：**[观察]** = 本机实测；**[源码]** = 只读参考 `D:\eagle-app\extracted`（app.bundle.js / background.js / config.js / api-server.js）；**[推断]** = 由观察+源码推导但未直接实测；**[未解]** = 未验证。

---

## 0. 摘要：最重要的 12 条

1. **[观察] 41595 JSON API 只有在库成功加载后才会监听**；库加载失败时只有 41593 在监听（日志 `Local server success to start and port is 41593`）。
2. **[观察] 启动时可用 `Eagle.exe --library-path=<绝对路径>` 直接打开指定库**；二次实例转发 argv 到已运行实例**不会**打开库（只打印 argv）。
3. **[观察] `ELECTRON_RUN_AS_NODE=1` 会让 Eagle 启动即退出（本环境 DSH 注入该变量）**；从探针 pwsh 启动必须先 `Remove-Item Env:ELECTRON_RUN_AS_NODE`。
4. **[观察] 库不能放在安装目录内**：`D:\Eagle\文章.library` 被 bg 拒绝，日志原文
   `[error] [bg] Library path error: D:\Eagle\文章.library, It is forbidden to put metadata.json in the installation directory: D:\Eagle`。
   因此「切回 `D:\Eagle\文章.library`」**失败**（详见 §11）。
5. **[观察] 单条素材落盘路径固定为** `images/<itemID>.info/<name>.<ext>`（主文件）+ `<name>_thumbnail.png`（缩略图）+ `metadata.json`；回收站**不移动文件**。
6. **[观察] itemID 为 13 位大写字母数字**（本次全部以 `MVF5…` 开头，如 `MVF577K8G9ODQ`；疑似时间序 + 随机，未解）。
7. **[观察] 扩展名由内容嗅探并小写化**：`UPPER.PNG`→`png`；把 PNG 字节命名为 `.JPG` 导入→落盘 `UPPER.png`、`ext:"png"`；无扩展名 `noext`→`noext.png`。
8. **[观察] `_thumbnail.png` 实际是 WebP(VP8) 字节**（magic `52 49 46 46 … 57 45 42 50` = `RIFF…WEBP`），扩展名仍是 `.png`；实测高度封顶 320（2400×1600→480×320；2880×1704 书签截图→540×320；200×150 GIF 不放大保持 200×150）。
9. **[观察+源码] noThumbnail 触发条件**：jpg/png/bmp/jxl 且 `width<=960 && height<=960 && size<=15,000,000`；PNG 额外 `size>1MB` 时强制生成缩略图；GIF 恒生成缩略图（`config.js` 的 `NO_THUMBNAIL_SIZE:960 / NO_THUMBNAIL_FILE_SIZE:15000000 / THUMBNAIL_SIZE:320`；`app/js/thumbs/jpg.js`、`png.js`）。
10. **[观察] 文件名清洗**：URL/书签 name 先 `substr(0,128)` 再 `sanitize()` 并去 `%`、`&lt;`、`&gt;`；本地路径导入名来自 basename，`%` 被去；**非 BMP 字符（emoji）被删除**（sanitize-filename 的 `nonPrintableRe` 覆盖 `\uD7FC-\uF8FF` 代理对区间）；中文/空格/`#;=` 保留。
11. **[观察] 无内容去重**：同 URL 同 name 重复 addFromURL、同内容不同路径的两次 addFromPaths 都产生**独立 item**。
12. **[观察] `/api/item/list` 的 `orderBy` 参数实际无效**：最终被 `sortData(items,"IMPORT")` 覆盖，恒为「最新导入在前」；且新导入 item 在**不重载库**时可能暂时从 item/list 缺失（本次最多缺 16 条，`/api/library/switch` 重载后仅剩已删除的 1 条缺失）→ 实时同步竞态。

---

## 1. 探测前提：让 41595 起来（关键踩坑）

初始状态：仅 41593 监听，41595 连接拒绝；`%APPDATA%\Eagle\log.log` 最后为
`[bg] Start to load library: undefined` + 空库在安装目录内被拒。
`/api/application/info` 无法访问（`ERR_CONNECTION_REFUSED`）。

| 尝试 | 结果 | 证据 |
|---|---|---|
| `Start-Process Eagle.exe --library-path=D:\eagle-probe\probe.library`（环境含 `ELECTRON_RUN_AS_NODE=1`） | 进程立即退出，无新日志 | 本环境 `Get-ChildItem Env:` 显示 `ELECTRON_RUN_AS_NODE 1` |
| 直接 start 但 `Remove-Item Env:ELECTRON_RUN_AS_NODE` 后带 `--library-path` | 成功：日志出现 `[bg] Start to load library: D:\eagle-probe\probe.library`、`[app] Library loaded`，41595 开始监听 | log.log 19:57:42–19:57:46 |
| 二次实例（首实例已运行）再传 `--library-path` | 只打印 argv，不打开库 | log.log 18:54:28 `[ 'D:\\Eagle\\Eagle.exe', '--library-path=…', '--allow-file-access-from-files' ]` |

成功后在日志中可见库加载全流程（19:57:45）：
`No library cache` → `Get /images folders finished, total: 0` → `Eagle version / Library location / Folders: 0 / Files: 0` → `mtime watcher start fail, because path is not exists: …\mtime.json` → `Load Library: D:/eagle-probe/probe.library` → `Library loaded`。

`GET /api/application/info`（截断）：
```json
{"status":"success","data":{"version":"4.0.0","prereleaseVersion":null,"buildVersion":"20260401","showCollectModal":false,"platform":"win32","preferences":{…,"proxy":{"enable":"false","ip":"127.0.0.1","port":1087},"developer":{"apiToken":"4cce6ddb-ea98-4c32-be66-cfee14496cb6"}}}}
```
`GET /api/library/info`：`{"status":"success","data":{"applicationVersion":"4.0.0","folders":[],"smartFolders":[],"quickAccess":[],"tagsGroups":[],"modificationTime":…,"library":{"path":"D:\\eagle-probe\\probe.library","name":"probe"}}}`

---

## 2. 磁盘布局（库根 / item 目录 / 全局文件）

库根（`D:\eagle-probe\probe.library`，加载后生成）：
```
Desktop.ini           75 B   [.ShellClassInfo] IconResource="C:\ProgramData\Eagle\eaglelibrary.ico",0
images/                     ← 每个 item 一个 <ID>.info/ 目录
metadata.json        1930 B  ← 全局：folders/smartFolders/quickAccess/tagsGroups/modificationTime/applicationVersion
mtime.json            1150 B ← { "<itemID>": lastModifiedMs, …, "all": 47 }
tags.json              62 B  ← {"historyTags":["tagA","tagB","probe","url"],"starredTags":[]}
saved-filters.json      2 B  ← []
backup/                     ← backup-2026-10-19 19.01.04.724.json（metadata.json 的整份快照，1930 B）
```
item 目录示例（均为 [观察]）：
```
images/MVF577K8G9ODQ.info/
  红色图片.png              3322 B   ← 主文件，<name>.<ext>
  metadata.json              536 B
images/MVF578WUM0FRJ.info/
  MVF578WQE4J4P.gif        10840 B
  MVF578WQE4J4P_thumbnail.png 9490 B ← 实际 WebP 字节
  metadata.json              630 B
images/MVF59H199P42K.info/
  not-an-image.txt            42 B   ← 非图片也可入库（ext=txt、有 text 字段、无 width/height/palettes）
  metadata.json              292 B
```
- **主文件名 = `item.name + "." + item.ext`**；缩略图名 = **`item.name + "_thumbnail.png"`**（与 id 无关）；SVG 例外：`noThumbnail=false` 时路径为 `<name>.svg` 或 `forceThumbnail` 时 `_thumbnail.png`（`app.bundle.js` `getThumbnailPath()`，L2363-2389）。[源码]
- 重命名响应：[观察] 无独立 rename API；`update` 不改 name；文件改名由 UI 走 `renewThubnail`（L19713-19754）。

---

## 3. 保存路径 / 命名实测表

> 全部来自 `D:\eagle-probe\evidence\10-disk-items.json`、`04-url-items.json`、`05-path-items.json`、`08-phase4.json`。
> 「落盘名」指 `images/<ID>.info/` 内的主文件名。

| # | 输入 | API | item.name | item.ext | 落盘名 | 备注 |
|---|---|---|---|---|---|---|
| 1 | URL `/img/red-400x300.png` + `name:"红色图片"` | addFromURL | 红色图片 | png | `红色图片.png` | 中文保留 |
| 2 | URL 同 1，无 name | addFromURL | `MVF5788M17K99`（**新 guid，≠itemID**） | jpg | `MVF5788M17K99.jpg` | URL 无 name 时 name=guid() |
| 3 | URL `/img/UPPER.PNG` | addFromURL | guid | png | `<guid>.png` | **扩展名小写** |
| 4 | URL `/img/noext`（PNG 字节） | addFromURL | guid | png | `<guid>.png` | **内容嗅探**补扩展名 |
| 5 | URL `/img/space%20name.png` | addFromURL | guid | png | `<guid>.png` | URL 空格不影响（name 为 guid） |
| 6 | URL `/img/中文图片.png` | addFromURL | guid | png | `<guid>.png` | 同上 |
| 7 | URL 名字含 `斜杠/冒号:星号*问号?"<>&%` | addFromURL | `斜杠冒号星号问号引号&` | png | `斜杠冒号星号问号引号&.png` | 去 `/ : * ? " < > %`，保留 `&` |
| 8 | URL 名字 200×`c` | addFromURL | 128×`c` | jpg | `cccc…(128).jpg` | API `name.substr(0,128)` |
| 9 | 本地 `same-name.png`（300×200） | addFromPaths | same-name | png | `same-name.png` | |
| 10 | 本地 `UPPER.JPG`（内容实为 PNG） | addFromPaths | UPPER | png | `UPPER.png` | **按内容嗅探改 ext** |
| 11 | 本地 `noext`（PNG 字节） | addFromPaths | noext | png | `noext.png` | |
| 12 | 本地 `hash#name%.png` | addFromPaths | `hash#name` | png | `hash#name.png` | `%` 被去，`#` 保留 |
| 13 | 本地 `semi;colon=eq.png` | addFromPaths | `semi;colon=eq` | png | `semi;colon=eq.png` | |
| 14 | 本地 `dot.in.name.png` | addFromPaths | `dot.in.name` | png | `dot.in.name.png` | |
| 15 | 本地 `emoji-😀.png` | addFromPaths | **`emoji-`** | png | `emoji-.png` | **U+1F600 被删**（见 §4） |
| 16 | 本地 224 字符名 `x…x.png` | addFromPaths | 224 字符（保留） | png | 224 字符`.png` | 未截断 |
| 17 | 本地 249 字符名（经 `D:\lp` 短路径） | addFromPaths | 249 字符（保留） | png | 249 字符`.png` | 未截断（MAX_FILENAME=240 未生效于本路径） |
| 18 | 本地 200 字符 folder 名 | folder/create | 200 字符（保留） | — | — | folder 是虚拟的，不落盘目录 |
| 19 | 同 URL 同 name 二次导入 | addFromURL | 新 itemID、同名 | png | 第二个 `红色图片.png` | **无去重** |
| 20 | 同内容不同路径（`sub2\same-name.png` 与根目录字节相同） | addFromPaths | same-name | png | 各自 `same-name.png` | **无去重** |
| 21 | 书签 `http://…/page/article.html` | addBookmark | `Probe Article Title`（**页面 title 覆盖传入 name**） | url | `Probe Article Title.url` + `Probe Article Title_thumbnail.png` | `.url` 内容见下 |
| 22 | 书签 URL 404 | addBookmark | `127.0.0.18765imgmissing.png` | url | `127.0.0.18765imgmissing.png.url` | 由 URL 清洗而来（`: /` 等被删） |

书签 `.url` 文件内容（`images/MVF5BIH2QBMVS.info/Probe Article Title.url`，68 B）：
```
[InternetShortcut]
URL=http://127.0.0.1:8765/page/article.html
```
书签 metadata：`ext:"url"`, `width:2880, height:1704`（页面截图尺寸）, `url:"http://…/article.html"`, `size:68`（.url 文件大小）。

**ID 格式 [观察]**：`MVF577K8G9ODQ`、`MVF5G91GBAUZR` —— 13 位 `[A-Z0-9]`，本次全部 `MVF5` 前缀；文件夹 id 同格式。**[未解]** 位段编码（时间/随机）未验证。

---

## 4. 名称清洗的源码级解释

- **[源码]** `app/js/background.js` L788（扩展上传通知名）：
  `sanitize(encodeURIComponent(params.name).replace(/\(/g,"\\(").replace(/%/g,"").replace(/\)/g,"\\)"))` → 解释 `%` 被去、括号转义。
- **[源码]** `background.js` L825（书签）：`name = sanitize(websiteInfo.title).replace(/%/g,"")…` → **页面 title 覆盖 API 传入 name**。
- **[源码]** `background.js` L3808（路径导入）：`path.basename(file).replace(extname,"").replace(/[/]/g,"").replace(/%/g,"").trim() || id`。
- **[源码]** `my_modules/sanitize-filename/index.js`：`illegalRe=/[\/\?<>\\:\*\|":]/g`，另有超长 `nonPrintableRe` 覆盖 `\uD7FC-\uF8FF`（**正好包含 UTF-16 高低代理区**）→ 所有非 BMP 字符（emoji 等）被删；`truncate(...,255)`。
- **[源码]** API 层 `api-server.js` L658-659 / L591-592：`name = name.substr(0,128); name = sanitize(name).replace(/%/g,"").replace(/&lt;/g,"").replace(/&gt;/g,"").trim()`。

---

## 5. 缩略图（真实格式 / 尺寸 / 触发条件）

**[观察]** `_thumbnail.png` 文件头：`52 49 46 46 … 57 45 42 50 …` = `RIFF....WEBP`，VP8 有损编码，**扩展名是 .png 但内容是 WebP**。

| item | 原图 | 缩略图文件 | 缩略图字节/格式 | 尺寸 |
|---|---|---|---|---|
| big-jpg-2400 | 2400×1600 JPG | `big-jpg-2400_thumbnail.png` | 15200 B, RIFF/WEBP VP8 | **480×320** |
| big-png-2400 | 2400×1600 PNG | `big-png-2400_thumbnail.png` | 11356 B, WEBP | **480×320** |
| 书签页面 | 2880×1704 截图 | `Probe Article Title_thumbnail.png` | 3528 B, WEBP | **540×320** |
| green GIF | 200×150 | `MVF578WQE4J4P_thumbnail.png` | 9490 B, WEBP | **200×150（不放大）** |
| edge-960 JPG | 960×960 | **无缩略图** | — | noThumbnail |
| edge-961 JPG | 961×961 | `edge-961_thumbnail.png` | 25624 B WEBP | 见规则 |
| noise-900 PNG | 900×900 / 2.77 MB | `noise-900-png_thumbnail.png` | 35540 B WEBP | PNG>1MB 强制 |

**[源码]** 触发规则（`D:\eagle-app\extracted\config.js` L8-10 + `app/js/thumbs/*.js`）：
```
THUMBNAIL_SIZE: 320, NO_THUMBNAIL_SIZE: 960, NO_THUMBNAIL_FILE_SIZE: 15000000
jpg/png/bmp/jxl: noThumbnail = (w<=960 && h<=960 && size<=15000000)
png 额外: forceThumbnail = (w<=960 && h<=960 && size>1MB)
gif: 恒生成 thumbnail；svg: 默认直接引用原文件
```
**[观察/推断]** 缩略图高度封顶 320（宽度等比，3:2→480、1.69:1→540；小于 320 的不放大）。**未解**：是否按短边/长边/retina 因子，精确算法未从源码确认。

`GET /api/item/thumbnail?id=…` **不返回二进制**，而是 JSON 路径：
`{"status":"success","data":"D:/eagle-probe/probe.library/images/MVF578WUM0FRJ.info/MVF578WQE4J4P_thumbnail.png"}`。
`noThumbnail:true` 时该 API 返回原文件路径（`getThumbnailPath` 源码 L2363）。

---

## 6. 文件夹（folder）实测

创建 9 个 + 嵌套（`POST /api/folder/create {folderName, parent?}`，**存在性**：path 不存在则 500）：

| 名称 | 结果 |
|---|---|
| `普通文件夹` | 成功 `MVF56HILBDALR` |
| `特殊字符 !@#$%^&()[]{};'`,+=` | 成功（原样保存） |
| `斜杠/反斜杠\冒号:星号*问号?引号"尖括号<>竖线\|` | **成功**，全部特殊字符原样保存（folder 是 metadata 虚拟节点，不落盘目录） |
| 200 字符长名 | 成功，未截断 |
| `表情😀图标🌈` | 成功（folder 名保留 emoji，未走 sanitize） |
| `  前后空格与点. ..  ` | 成功，原样保留空格/点 |
| `..` | 成功 |
| 空字符串 | **500** `{"status":"error","data":"Missing required parameters."}` |
| 重复名（再建 `普通文件夹`） | 成功，独立 id，追加到列表末尾 |

全局 `metadata.json` 结构（[观察]，`evidence/03-library-metadata-after-folders.json`）：
```json
{"folders":[
  {"id":"MVF56HILBDALR","name":"普通文件夹","description":"","children":[
      {"id":"MVF56J3XEWKZM","name":"子文件夹A","description":"","children":[],"modificationTime":1792407557950,"tags":[],"password":"","passwordTips":""},
      {"id":"MVF56J9XJ9XHB","name":"子文件夹B/孙子","description":"","children":[],"modificationTime":1792407558165,"tags":[],"password":"","passwordTips":""}],
   "modificationTime":1792407555885,"tags":[],"password":"","passwordTips":""}, …],
 "smartFolders":[],"quickAccess":[],"tagsGroups":[],"modificationTime":1792407558474,"applicationVersion":"4.0.0"}
```
- folder 对象键固定为 `id,name,description,children,modificationTime,tags,password,passwordTips`；children 顺序 = 创建顺序（append）。
- 顶层键顺序在保存后变为 `folders,smartFolders,quickAccess,tagsGroups,modificationTime,applicationVersion`（与初始模板不同）。
- `GET /api/folder/list` 额外带 `coverId/isUnLock/orderBy/sortIncrease`（仅当存在时输出，[源码] api-server.js L30-45）。
- **手动排序 / order / pinned [未解·仅源码]**：`background.js` L5035-5036 使用 `_.get(a, `order[${oldFolderId}]`, a.modificationTime)` 排序；渲染层 `eagle.filter.pinned[...]` 是筛选面板固定项（`app.bundle.js` L20706+），**未实测** `order[folderId]`、`pinned[folderId]` 在 metadata.json 的实际落盘，也未见 folder.orderBy/sortIncrease 被写入（本次从未排序，故不存在）。

### 多 folder 归属 [观察]
`addFromURL {folderIds:["MVF56HILBDALR","MVF56HOZOJ3T3"], website, annotation, tags, star:4}` → item metadata：
```json
{"tags":["tagA","tagB"],"folders":["MVF56HILBDALR","MVF56HOZOJ3T3"],
 "url":"https://source.example/page","annotation":"annotation text here","star":4, …}
```
- **`url` 字段存的是 API 的 `website` 参数，不是下载 URL**（纯 addFromURL 无 website 时 `url:""`，源 URL 丢失）。
- 星级字段落盘名为 `star`（不是 isStarred）。

---

## 7. 回收站（trash）[观察]

`POST /api/item/moveToTrash {itemIds:[id]}` → `{"status":"success"}`：
- item metadata 变为 `isDeleted:true` + `deletedTime:<ms>`（`evidence/07-phase3.json` trash 段）；
- **`images/<ID>.info/` 目录与文件原样保留**（实测 `big-png-2400.png` + `_thumbnail.png` 仍在）；
- `GET /api/item/info?id=` 仍返回该 item（isDeleted:true）；
- `GET /api/item/list` **过滤掉** `isDeleted` 项（`api-server.js` L953-955）。

---

## 8. `/api/item/list` 排序与实时同步

- **[观察] `orderBy` 参数全部无效**：`CREATEDATE/-CREATEDATE/MODIFIEDATE/NAME/IMPORT/FILESIZE` 及其 `-` 变体，返回顺序完全一致（`evidence/07-phase3.json` `ordering`）。原因 [源码] `listImages`（api-server.js L866-975）先 `sortData(items, orderBy)`，末尾又 `items = sortData(items,"IMPORT")` 覆盖。
- 实际顺序 = **最新导入在前**（IMPORT 降序）；`limit/offset` 在最终排序前切片，故与预期语义有偏差。
- 默认最多 200 条（`else if (200 < items.length) items.length = 200`）。
- **[观察] 实时同步竞态**：连续快速导入时，`item/list`（取 `$bodyScope.raw`）会缺少部分新 item；`item/info?id=` 仍可取到。本次未重载前 `disk=47 / list=31`（缺 16），执行 `POST /api/library/switch`（同库重载，日志 `Load library(cache): %APPDATA%\Eagle\library-caches\4054cf5b.txt`）后 `countAfterBack=46`，仅剩已删除的 1 条。
- 库缓存文件：`%APPDATA%\Eagle\library-caches\4054cf5b.txt`（日志 `Update library cache` / `Load library(cache)`）。

---

## 9. 41593 表单 POST（复现扩展保存）[观察]

服务行为：`GET http://localhost:41593/`（任意路径）→ 200 `application/json`，内容为 `{appVersion:"4.0.0", preferences:{…}, showCollectModal:false}`；无 HTML 表单页。
`POST /` 使用 `Content-Type: application/x-www-form-urlencoded`（官方客户端字段见 [源码] `app/collect-window/js/lib/api/item.js`：`type:image|save-url|import-images`, `version`, `title`（65 字符清洗）, `src`, `url`, `tags`, `folderID/folderIDs`, `base64`）。

实测结果（`evidence/08-phase4.json` → `ext41593.cases`）：

| case | 表单字段 | 响应 | 落盘 |
|---|---|---|---|
| ext-image-basic | `type=image&version=eagle-collect-window&src=<medium-800x600.jpg>&title=扩展图片标题&url=<page>&tags=ext,probe&folderID=<simple>` | 200，返回 preferences JSON | ✅ `images/MVF5F37AF7RM3.info/扩展图片标题.jpg`（76526 B） |
| ext-image-no-title | 无 title | 200 | ❌ 未创建 item（标题为空直接丢弃） |
| ext-image-special-title | title=`特殊/\:*?"<>|标题zzz…(80)` | 200 | ✅ 名称为 `特殊标题zzzz…`（非法字符被 sanitize） + GIF 缩略图 |
| ext-image-404 | src 404 | 200 | ❌ 未创建（日志 `Can not download file [HTTP_ERROR: HTTP 404 Not Found]`） |
| ext-save-url | `type=save-url&version=eagle4.0&url=<page>&title=书签扩展标题&src=<og图>` | 200 | ✅ 书签 `Probe Article Title.url` + `_thumbnail.png`（日志 `[extension] version: eagle4.0 - Save bookmark, source: …`） |
| ext-import-images | `type=import-images&…&images=[{src,title}×2]` | 200 | ❌ 未创建（日志 `Batch save: http://…, count: 2`，需要 UI 批量保存面板确认） |
| ext-unknown-type | `type=no-such-type` | 200 | ❌ 无效果 |

**结论**：41593 对已知/未知 type 一律 HTTP 200 返回 preferences JSON，**没有 per-request 的成功/失败语义**；失败只能从日志与磁盘判断。41593 表单保存与 41595 `addFromURL` 的差异：41593 使用 `title` 作为 item.name（不截 128，官方客户端先 65 字符清洗），无 `annotation/star`；书签走页面抓取（title 覆盖）。

---

## 10. 下载 / 防盗链 / Referer [观察 + 日志]

- UA（源码 `config.js` 与实测一致）：
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 Safari/537.36 Electron/21.0.0 Eagle/4.0.0`
- 每次 `addFromURL` 的请求序列（服务器 `evidence/server-requests.jsonl`）：
  1) **带 `Referer: <下载 URL 自身>`**（electron `net.request`）；
  2) 失败后**再试一次**（仍带同一 Referer）；
  3) 仍失败 → 日志 `Can not download with electron net, retry with fetch` → `>> download with fetch`，**该次不带 Referer**；
  4) 成功即入库；404/403 最终失败，不创建 item。
- 实测对照：
  - 规则「Referer 必须为 `https://allowed.example/`」→ 失败（`403` ×3，且 API 的 `headers:{Referer:"https://allowed.example/"}` **未生效**，请求里仍是 URL 自身 Referer）。
  - 规则「**不允许** Referer」→ 前两次 403，第 3 次 fetch 无 Referer **200 成功入库**。
  - `302` 跳转 → 跟随并保存成功（落盘名/内容为跳转后的 PNG）。
- 日志（`%APPDATA%\Eagle\log.log`）样例：
```
[bg] >> download with electron request [http://127.0.0.1:8765/img/missing.png]
[error] [main] cannot download url with http request: …, status code: 404
[error] [bg] Can not download with electron net, retry with fetch
[bg] >> download with fetch [http://127.0.0.1:8765/img/missing.png]
[error] [bg] Can not download file [HTTP_ERROR: HTTP 404 Not Found], url: …
```
完整日志副本：`D:\eagle-probe\evidence\20-log-copy.log`（53 KB，660 行）。

---

## 11. 库切换与「切回原库」结果（重要）

- `GET /api/library/history`：切换前 `["D:\\eagle-probe\\probe.library"]`；多次切换后返回 `[]`（history 被开关过程改写，[未解]）。
- `POST /api/library/switch {"libraryPath":"D:/eagle-probe/probe.library"}`（同库）→ 200 `{"status":"success"}`，实际触发重载（日志 `Switch library` → `Prepare to load library` → `Library loaded`）。
- `POST /api/library/switch {"libraryPath":"D:/Eagle/文章.library"}` → **切换失败**：
  - 一次返回 200（异步失败，库仍是 probe），一次返回 **HTTP 500**（Node fetch 复核也得到 500/成功交替，说明是竞态）；
  - bg 日志决定性证据：
    `[error] [bg] Library path error: D:\Eagle\文章.library, It is forbidden to put metadata.json in the installation directory: D:\Eagle`
  - `D:\Eagle\文章.library` 未被改动（仍只有 127 B 的 metadata.json）。
- **最终状态**：Eagle 仍加载 `D:\eagle-probe\probe.library`（API 返回 `library.path = D:\eagle-probe\probe.library`）。**未能按要求切回 `D:\Eagle\文章.library`——原因是该库位于安装目录内被 Eagle 硬性拒绝（非权限/网络问题）**。Eagle 进程保持运行，41593/41595 正常。

---

## 12. metadata 样例（截断）

单 item `images/MVF577K8G9ODQ.info/metadata.json`（[观察] 全字段）：
```json
{"id":"MVF577K8G9ODQ","name":"红色图片","size":3322,"btime":1792407589642,"mtime":1792407589649,"ext":"png",
 "tags":["probe","url"],"folders":["MVF56HILBDALR"],"isDeleted":false,"url":"","annotation":"",
 "modificationTime":1792407589635,"height":300,"width":400,"noThumbnail":true,"lastModified":1792407589760,
 "palettes":[{"color":[219,44,43],"ratio":96},{"color":[103,208,156],"ratio":1.51}, …]}
```
47 个 item 的 metadata 键频次：`id/name/size/btime/mtime/ext/tags/folders/isDeleted/url/annotation/modificationTime/lastModified=47`，`height/width=46`，`noThumbnail=34`，`palettes=46`，`text=1`（txt），`star=2`，`deletedTime=1`。
- `btime/mtime` = 文件系统时间（本地导入=源文件时间；URL=下载时间）；`modificationTime` = API 传入或当前时间；`lastModified` = 入库完成时间；`deletedTime` = 进回收站时间。
- 无 `mtime.json`（单 item 级不存在）；库根 `mtime.json` 为 `{itemID: lastModified, …, "all": N}`。
- `tags.json`：`historyTags` 会累积 API 用过的标签（本次 `["tagA","tagB","probe","url"]`），`starredTags` 空。
- `saved-filters.json`：`[]`。
- `backup/`：`backup-2026-10-19 19.01.04.724.json`，内容为当时 `metadata.json` 的完整快照。

---

## 13. 未解 / 未测项

1. itemID 的 13 位编码规则（时间戳基数/随机段）未验证。
2. 缩略图精确缩放算法（为何是 480×320 / 540×320；是否 retina 因子 1.5）未确认。
3. `order[folderId]`、`pinned[folderId]`、folder 的 `orderBy/sortIncrease` 真实落盘未实测（只有 `background.js` L5035 源码线索；本次未做 UI 手动排序）。
4. 手动重命名（UI rename）后的磁盘改名/缩略图改名流程未实测。
5. 同名文件夹/同名 item 在 UI 的展示去重、`/api/item/list` 的 `keyword/ext/tags/folders` 过滤未逐个验证。
6. `import-images` 批量保存需要 UI 面板确认，未验证确认后的落盘细节。
7. `/api/library/history` 变成 `[]` 的原因未确认（疑似 switch 失败/空库历史被覆盖）。
8. `headers` 参数在 41595 addFromURL 中被忽略（多次实测 Referer 仍为自身），是否为已知降级未确认。

---

## 14. 证据文件索引

| 文件 | 内容 |
|---|---|
| `D:\eagle-probe\evidence\01-baseline.json` | application/library/folder/item 初始响应 |
| `02-folders.json` / `03-library-metadata-after-folders.json` / `folders.json` | folder 创建响应与 metadata |
| `04-url-items.json` | addFromURL 17 例 + 每例磁盘快照 |
| `05-path-items.json` | addFromPaths 15 例 + 磁盘快照 |
| `06-item-list.json` / `07-phase3.json` | item/list、缩略图边界、书签、update、trash、排序 |
| `08-phase4.json` | 41593 表单、长名、库切换 |
| `10-disk-items.json` / `10-disk-rows.json` | 全部 item 磁盘清单与 metadata |
| `server-requests.jsonl` | 本地 HTTP 服务器记录的每次请求（含 Referer/UA/状态） |
| `20-log-copy.log` | Eagle log.log 全量副本（660 行） |
| `thumbnail-gif.bin` | `/api/item/thumbnail` 响应（JSON 路径） |
| `D:\eagle-probe\server.js` / `phase1-4.mjs` / `gen-assets.ps1` / `analyze.mjs` | 可复现脚本 |
