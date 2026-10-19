# Eagle 4.0.0 静态分析：保存管线、library 数据模型与排列规则

> 分析对象：`Eagle 4.0.0`（`package.json`: version `4.0.0`, buildVersion `20260401`, buildNumber `23`，`main: run.js` → `run.jsc` + `main.jsc`，bytenode/V8 字节码）。
> 源码根：`D:\eagle-app\extracted`（只读）。关键文件：
> - `app/js/background.js`（6422 行，库窗口 background renderer 主逻辑：保存/缩略图/metadata/mtime/监听/导出导入）
> - `app/js/api-server.js`（1103 行，41595 JSON API）、`app/js/api-server-v2.js`（146 行，/api/v2 → plugin handler 映射）
> - `app/js/downloader/downloader.js`、`app/js/thumbs/thumb.js`、`app/js/thumbs/*.js`、`app/js/utils/*`
> - `app/app.bundle.js`（106712 行，渲染器大包：library UI、排序、拖拽、tags、saved filters、跨库复制）
> - `app/js/plugin/index.js`（插件 API handler，`item.add` 等）
> - `app/js/plugin/model/*.js`（Folder/SmartFolder/Item/Tag 数据模型）
> - `run.jsc` / `main.jsc`（主进程 V8 字节码，不可反编译；本文只依据其 ASCII 字符串与 IPC 通道名，标注为“推断/边界”）
> - `config.js`（端口、缩略图尺寸、支持格式）
>
> 结论标记：**【观察】** = 代码/磁盘直接可见；**【推断】** = 由 IPC 名称/字符串/调用关系推出；**【未知】** = 需要动态验证或落在 `.jsc` 内部。
> 另用本机真实空库 `D:\Eagle\文章.library\metadata.json` 做了只读对照（**观察**）。

---

## 0. 一页速查（最关键的 14 条事实）

| # | 事实 | 证据 |
|---|---|---|
| 1 | 扩展端口 `41593`、静态端口 `41592`、JSON API `41595`；41593 的 HTTP server 在主进程（`run.jsc` 字符串 `initServer` / `EXTENSION_PORT` / `createServer` / `[main] Local server success to start and port is`） | `config.js:5-7`；`run.jsc` 字符串；`app.bundle.js:23481-23494` |
| 2 | 41595 API 在**渲染器**进程内由 `JsonRestServer` 启动；同一套 handler 通过 `/api/v2` 暴露给插件 | `api-server.js:1-5`；`app.bundle.js:17875-17879`；`api-server-v2.js:44-143` |
| 3 | 所有入库最终落到同一个渲染器队列：`$scope.uploadFiles()`（本地路径）/ `$scope.uploadUrls()`（URL/base64/bookmark）→ IPC → `background.js` | `app.bundle.js:30726-30847`；`background.js:853-861, 911-929, 772-845` |
| 4 | 每个 item 一个目录：`<library>/images/<ID>.info/`，内含 `metadata.json`、`<name>.<ext>`、`<name>_thumbnail.png`（小文件/自定义缩略图时可能没有/仍有） | `background.js:6105-6313` |
| 5 | 缩略图 `.png` 文件的实际编码通常是 **WebP**（`compress()` 以 `format:"image/webp", quality:0.75` 原地覆写，扩展名仍 `.png`）；最大边默认 **320px**（少数格式 480/512，见 `ThumbSize`） | `thumbs/thumb.js:5-52, 223-303`；`utils/compress.js:86-103`；`config.js:8` |
| 6 | `guid()` = `Date.now().toString(36) + random(5位 base36)` 转大写 → 当前为 **13 位**大写字母数字（历史库也接受 36 位 UUID 形式目录名） | `background.js:6340-6342, 2811`；`app.bundle.js:2396-2398`；`app.bundle.js:106241` 实例 `KD9ZV3ZXM75X0` |
| 7 | item 文件名净化链：渲染器先去掉扩展名/`%`/emoji → background `sanitize()`（移除 `\/?<>\\:*|"`、控制码、Windows 保留名、尾部空格，UTF-8 截断 255 字节）→ 按库路径剩余长度再截断 → `unorm.nfc()` 归一化 → 空名变 `_` | `app.bundle.js:30800-30815`；`background.js:6183-6190`；`my_modules/sanitize-filename/index.js:33-49`；`utils/remainingFilenameLength.js:4-36` |
| 8 | 库根 `metadata.json` 只有 6 个顶层字段：`applicationVersion, folders, smartFolders, quickAccess, tagsGroups, modificationTime`（无 pinned、无 tags） | 实测 `D:\Eagle\文章.library\metadata.json`；`background.js:4045-4052, 5379-5386` |
| 9 | item 的“文件夹归属”是 `folders: string[]`（多归属），移动/加/删文件夹**只改 metadata，不移动文件** | `app.bundle.js:30128-30225, 30196-30223`；`api-server.js:761-765` |
| 10 | 手动排序是 item 字段 `order[folderId] = <BigNumber 小数>`；拖拽时在相邻两项之间取中点，并把 `folder.orderBy` 自动改为 `"MANUAL"` | `app.bundle.js:54047-54223, 21747-21827`；导入还原顺序 `background.js:5034-5040` |
| 11 | 置顶是 item 字段 `pinned[folderId] = Date.now()-index`，列表渲染前先按 pinned 降序排最前（`folder.orderBy !== "RANDOM"` 时） | `app.bundle.js:27443-27463, 43936-43963` |
| 12 | 删除=软删：`isDeleted:true` + `deletedTime`，文件仍在 `images/<id>.info/`；清空垃圾桶才 `fse.remove(dir)` 物理删除 | `api-server.js:543-571`；`background.js:583-634` |
| 13 | 导出/打包：`.eaglepack` = **zip(store, 不压缩)**，内含 `pack.json`（`{folder, images}`）与各 `<oldId>.info/` 目录；导入时全部换新 `guid`、重写 metadata、重排 folder id | `background.js:4436-4736, 4862-5120` |
| 14 | 没有独立“搜索索引文件”。核心检索 = 启动时把每个 `images/*.info/metadata.json` 汇总为 userData 下 `library-caches/<fnv32a(rootDir)>.txt`（每行一个 item JSON），渲染器逐行读入 `$scope.raw` 后内存过滤；AI/语义检索走外部插件 `localhost:38766` | `background.js:2308-2319, 240-323, 3028-3199`；`app.bundle.js:23106-23167`；`lib/api/ai-search.js:8-32` |

---

## A. 保存管线条（从请求到 `images/<ID>.info/`）

### A.1 入口矩阵

| 入口 | 端口/通道 | 代码位置 | 后续 |
|---|---|---|---|
| 浏览器扩展 / collect window 表单 POST | `http://localhost:41593`，`application/x-www-form-urlencoded`，`type = image / save-url / import-images` | `config.js:5`；`app/collect-window/js/lib/api/item.js:1-98`；41593 服务端在 `run.jsc`（边界） | 主进程解析后通过 IPC `upload-from-extension` / `url-from-extension` / `screencapture-from-extension` / `upload-images` 交给 background renderer（**推断**，通道名见 `run.jsc` 字符串与 `background.js:554,731,772,812`） |
| 本地 JSON API | `http://localhost:41595` | `api-server.js:981-1018`；`api-server.js:1-5` | 渲染器内直接调用 `$bodyScope.uploadFiles/uploadUrls` 或 `ipcRenderer.sendTo(backgroundWindowID, 'url-from-extension', data)` |
| JSON API v2 / 插件 API | `http://localhost:41595/api/v2/...` | `api-server-v2.js:44-143`；`plugin/index.js:1434-1561` | 同 41595（`uploadFiles` / `uploadUrls` / `url-from-extension`） |
| 拖拽/选择文件、粘贴路径 | 渲染器 IPC `upload-local-files` / `paste-paths` / `add-files` | `app.bundle.js:30784-30847`；`background.js:847-861, 939-941` | `uploadFileQueue()` → `addToProcessQueue()` |
| 剪贴板图片 | `paste-image` | `background.js:931-933, 3756-3785` | 写入 `eagle-temp/<id>` → `addToProcessQueue` |
| 截图 | `screencapture` / `screencapture-from-extension` | `background.js:429-460, 731-745` | `eagle.screenCapture.capture()`（主进程）→ `addToProcessQueue` 或打开 collect window |
| 收藏网址（bookmark） | `url-from-extension` | `background.js:812-845` | 在 `eagle-temp/<name||guid>.url` 写 `.url` 快捷方式文件 → `addToProcessQueue` |

**扩展请求体字段（观察，来自 collect-window）**：
```js
// app/collect-window/js/lib/api/item.js:2-22
async addFile(data) {
  if (data.title) data.title = eagle.utils.clearWeirdCharacters(data.title).substr(0, 65);
  const options = { method:"POST", "Content-Type":"application/x-www-form-urlencoded",
    body: { type:"image", version:"eagle-collect-window", ...data } };
  return await eagle.fetch("http://localhost:41593", options);
}
// addURL: type:"save-url", version:"eagle4.0", title, url, base64(截图/视频缩图)
// batchSave: type:"import-images", url, images:JSON.stringify(items)
```
`run.jsc` 中可检索到字符串 `save-url`、`import-images`、`folderID`、`folderIDs`、`base64`、`srcURL`、`extrack-eaglepack`，支持“41593 的 server 在主进程”的判断（**推断**，字节码不可反编译）。

### A.2 41595 API 的保存函数

`api-server.js` 中直接入库的端点：
- `POST /api/item/addFromPath` → `addItemFromPath()`（`api-server.js:449-488`）→ `addPath()`（`:396-424`）
- `POST /api/item/addFromPaths` → `addItemFromPaths()`（`:490-541`），`items[]` 模式支持逐项 name/tags/star/annotation/modificationTime
- `POST /api/item/addFromURL` / `addFromURLs` → `addURLs()`（`:426-447`）
- `POST /api/item/addBookmark` → `addBookmarkItem()`（`:573-633`），`ipcRenderer.sendTo(backgroundWindowID,'url-from-extension', data)`（`:629`）
- `POST /api/item/batchSave` → 打开批量保存面板（`:723-734`，**不会**直接落盘）
- 另有 `update / moveToTrash / setCustomThumbnail / refreshThumbnail / item/list / folder/* / tag/* / library/*`（`:981-1018`）

`addPath()` 关键：
```js
// api-server.js:396-424
function addPath(filePath, id, name, ...) {
  if (fs.statSync(filePath).isDirectory()) { var dirFiles = walk(filePath); ... }  // 目录会展开
  else fds = [{ id, name: name ?? path.basename(filePath), url, folders: folderIds ?? [],
                tags, annotation, modificationTime: modificationTime ?? Date.now(), star, path, cutMode }];
  $bodyScope.uploadFiles(fds);
}
```
`addURLs()`：`$bodyScope.uploadUrls(imageUrls, folderIds, {names,urls,tags,headers,modificationTimes,annotations,stars})`（`:426-447`）。

### A.3 渲染器侧：`uploadFiles()` / `uploadUrls()`

```js
// app.bundle.js:30784-30843  $scope.uploadFiles
for (...) {
  var fileName = file.name || path.basename(file.path);
  fileName = fileName.replace(path.extname(file.path), "").replace(/%/g, "").replace(emojiRegex, '');
  var image = { id: file.id || guid(), name: fileName, path: file.path, type: file.type, size: file.size,
                tags: file.tags || [], url: file.url || "", annotation: file.annotation || "",
                lastModified: file.lastModified,
                modificationTime: file.modificationTime || (now + index),
                folders: file.folders || [], star: file.star || undefined };
  if (file.cutMode) image.cutMode = true;
  ...
  $scope.uploadQueue.push(image);
}
IPCHelper.send('upload-local-files', { files: images.reverse() });   // :30840
```
```js
// app.bundle.js:30726-30782  $scope.uploadUrls
fileName = fileName.substr(0, remainingFilenameLength($scope.libraryPath));   // :30760
fileName = sanitize(fileName).replace(/%/g,"").replace(/&lt;/g,"").replace(/&gt;/g,"").trim(); // :30763
ipcRenderer.send('upload-urls', files);   // :30781
```

background 侧接收：
```js
// background.js:853-861
ipcRenderer.on('upload-local-files', function(event, params) { ... uploadFileQueue(params.files, 0, token); });
// background.js:911-925
ipcRenderer.on('upload-url', function(event, params) { var id = guid(); ... uploadUrl(params, ...); });
// background.js:927-929
ipcRenderer.on('upload-urls', function(event, files) { Downloader.download(files); });
```

`uploadFileQueue()` 生成标准 image 对象并补 `modificationTime` 去重：
```js
// background.js:864-909
var image = { id: file.id || guid(), name: file.name || crypto.randomUUID(),
  tags: Array.from(file.tags||[]), folders: file.folders||[], size: file.size||undefined,
  star: file.star||undefined, path: file.path, type: file.type, url: file.url||"",
  annotation: file.annotation||"", modificationTime: file.modificationTime || Date.now()+index };
// 避免批次内时间相同：modificationTimeMap 递增
addToProcessQueue(image);
```

### A.4 下载（URL/base64 → `eagle-temp/<id>`）

`Downloader.download()`（`downloader.js:390-422`）→ `downloadQueueCallback`（`:15-83`）→ 先尝试“转大图” `downloadLargeImage`（`:85-102`，`eagle.urlEnlarger`）→ 失败则 `startDownload`（`:104-201`）。

`downloadWithNet()`（`downloader.js:203-286`）关键观察：
```js
const userAgent = "Mozilla/5.0 (Macintosh; ...) Chrome/142.0.0.0 ...";   // :209，注意是固定 Mac UA
if (params.website || params.headers || /pixiv|pximg|doubanio\.com|bigurl|sinaimg\.cn/.test(params.url)) {
  referer = params.website || params.url;                                // :213-223
}
let outputPath = await ipcRenderer.invoke('downloadWithNet', { url, referer, userAgent, directory: EAGLE_THUMBNAIL_TEMP_PATH, filename: params.id });
if (!outputPath) outputPath = await ipcRenderer.invoke('downloadWithRequest', {...}); // 回退主进程 http
```
- 临时文件路径：`EAGLE_THUMBNAIL_TEMP_PATH = <userData>/eagle-temp`（`background.js:64`），文件名为 **item id，无扩展名**。
- 主进程 `run.jsc` 实现这两个 invoke handler：字符串含 `downloadWithNet`、`downloadWithRequest`、`Referer`、`User-Agent`、`[main] unexpected content-type for download:`、`[main] electron net download timeout:`（**推断**：主进程负责 electron `net` / http 下载、Referer/UA、超时与 content-type 校验）。
- 回退链：`net` → `request` → 渲染器 `fetch`（`downloader.js:288-341`，30s 超时、拒绝 `text/html`）→ base64 buffer（`:343-388`，HTML 头检测）。
- 下载完成后 `getExt({path: outputPath})` 嗅探扩展名（`downloader.js:258-263`），然后 `addToProcessQueue(downloadedItem)`（`:414-416`）。

### A.5 `processImage()`：落盘核心（**最重要**）

`background.js:6105-6313`，逐步：

```js
// 1) 预处理
var thumbnailSize = 480;                                    // :6107（传入缩略图生成器；最终压缩尺寸另算）
var id = file.id; var dir = library.imagesDir + id + ".info/";  // :6109-6110
cutMode = (file.path.indexOf(USER_DATA_PATH) !== -1);       // :6146-6148（临时目录来的=移动；否则复制）
if (file.cutMode) cutMode = true;
var stat = await fs.promises.stat(file.path);
file.size = stat.size; file.btime = parseInt(stat.birthtimeMs); file.mtime = parseInt(stat.mtimeMs);  // :6154-6159

// 2) 扩展名决定
if (!ext) { ext = getExt(file); file.ext = ext; }           // :6171-6174
if (!ext) return error("File format is not recognized");
if (file.size === 0 && file.ext !== 'txt') return error("... 0kb ...");

// 3) 文件名净化（三层）
file.name = sanitize(file.name.replace("." + ext, "")).trim();   // :6183
file.name = file.name.substr(0, remainingFilenameLength(library.rootDir)); // :6184
file.name = unrom.nfc(file.name);                            // :6185（NFC/日文浊音合成）
if (file.name === "") file.name = "_";                       // :6188-6190

// 4) 路径
rawPath       = path.resolve(dir + file.name + "." + ext);            // :6193
thumbnailPath = path.resolve(dir + file.name + "_thumbnail.png");     // :6194
await fs.promises.mkdir(dir, 0755);                                    // :6196

// 5) item 元数据组装
item = { id, name: file.name, size: file.size, btime: file.btime, mtime: file.mtime, ext,
         tags: Array.from(file.tags||[]), folders: file.folders, isDeleted: file.isDeleted||false,
         url: file.url||"", annotation: file.annotation||"",
         modificationTime: file.modificationTime || Date.now(), star: file.star || undefined };  // :6198-6212
if ((file.src || file.merged) && file.modificationTime) item.modificationTime = file.modificationTime; // :6215-6217
// IPTC 关键词导入为 tags（preferences.general.IPTC === "true" 且 ext==="jpg"）:6224-6245

// 6) 原始文件复制/移动
importItemDateMap[item.id] = Date.now();                     // :6249（watcher 自触发抑制用）
await copyProcessFile({ cutMode, file, filePath, rawPath }); // :6252-6257

// 7) 缩略图
item = await ThumbGenerator.generate({ src: rawPath, dest: thumbnailPath, item, file,
                                       thumbnailSize, startAt: item.startAt ?? item.thumbnailAt }); // :6264-6271
ColorAnalyzer.addTask(item, thumbnailSize, item.noThumbnail ? rawPath : thumbnailPath);  // :6273-6279

// 8) 入 metadata 写盘队列（不是直接写！）
onImagesChange([item], true);                                 // :6281
returnCallback(undefined, item);
```
异常策略：缩略图失败 → `item.noPreview = true` 仍入库（icon 模式，`:6285-6294`）；复制/权限失败 → 整个 add 失败并删除 `.info` 目录（`processQueueCallback`，`:5906-6011`；取消时 `fse.remove(dir)`）。

### A.6 `copyProcessFile()`：复制 vs 移动

```js
// background.js:6045-6100
if (cutMode) { safeCopy.async(filePath, rawPath, ...); setTimeout(()=>fs.unlink(filePath),50); file.path = rawPath; }
else { fs.copyFile(file.path, rawPath, ...); // 失败再 safeCopy.sync；成功后 utimes(rawPath, stat.atime, stat.mtime) }
```
- `cutMode` 判定：源文件在 `userData`（eagle-temp）内 = 移动；用户「剪切」路径（`cutMode:true`）= 移动；否则复制并保留 mtime。

### A.7 缩略图生成细节

`ThumbGenerator.generate`（`thumbs/thumb.js:223-303`）：
```js
let maxSize = ThumbSize[ext] || EagleConfig.THUMBNAIL_SIZE;    // :228  → 320（多数图像），480/512（PDF/Office/3D/RAW 等）
if (Thumb.plugins[ext]) item = await plugin(...)               // :238-260 插件优先（失败回退内置）
else if (Thumb.default[ext] && SUPPORT_FORMATS[ext]) item = await Thumb.default[ext](options);  // :261-263
if (!item.noThumbnail) await compress({ start: dest, dest: dest, format:"image/webp", quality:0.75, maxSize });  // :274-282
```
- `ThumbSize` 表：`thumbs/thumb.js:5-52`（`icns/ico=512`，其余 3D/Office/PDF/设计/RAW 等 `480`）。
- `compress()`（`utils/compress.js:7-120`）：canvas 多步缩放（最长边 > maxSize 才缩小，`:21-79`），`canvas.toDataURL("image/webp", 0.75)`（`:86-94`），`fs.writeFile(dest, decode.data)`（`:102-103`）。**所以 `_thumbnail.png` 内容通常是 WebP 字节**；>16383px 时退化为 JPEG（`:88-92`）。
- “不生成缩略图”规则（小图直接用原图当缩略图）：`item.noThumbnail = true`
  - `thumbs/jpg.js:19-26`：`width<=NO_THUMBNAIL_SIZE(960) && height<=960 && size<=NO_THUMBNAIL_FILE_SIZE(15,000,000)` → noThumbnail
  - `thumbs/png.js:15-25`：同上，但“小尺寸但文件 >1MB”强制生成缩略图
  - 其它格式各自实现（`thumbs/*.js`）；`svg` 无 `forceThumbnail` 时永远用原文件（渲染器 `app.bundle.js:2363-2389` / `app/js/global.js:314-345` 的 `getThumbnailPath`）
- 自定义缩略图：IPC `set-custom-thumbnail`（`background.js:1031+`）→ 覆盖 `<name>_thumbnail.png`，置 `customThumbnail:true`、删除 `noThumbnail/noPreview`、重算 palettes。
- 高清缩略图缓存：`gerateHightResolutionThumbnailQueue`（`background.js:996-1141`），写入 userData 而非库内。

### A.8 metadata / mtime / 缓存三层的写盘顺序与时序（**观察**）

1. `processImage` 完成：`.info/` 目录已建、原文件已就位、缩略图已生成。
2. `onImagesChange([item], true)` → `imageMatadataQueue.push({type:"modified", image})`（`background.js:3570-3637, 6281`）。
3. `metadataQueueCallback`（`background.js:5458-5783`，并发 8）：
   - 文件名改名分支（`image.oldName/newName`，`:5515-5654`）：先移动 `<oldName>.<ext>`→`<newName>.<ext>`、`_thumbnail.png` 同步改名，再写 `metadata.json`；失败回滚 UI。
   - 普通分支（`:5655-5764`）：`image.lastModified = Date.now()`，`JSON.stringify(image)` 写入 `images/<id>.info/metadata.json`（`createWriteStream`，出错回退 `writeFileSync`）。
   - 每条 metadata.json 是**单行 JSON**（读取端会先 `replace(/[\r\n]/g,"")`，如 `:2834`）。
4. `imageMatadataQueue.drain`（`:5791-5807`）：
   - 2s 后 `updateMTimeLogsWithTimeoutByMeta()`（内部再 1s debounce → `updateMTimeLogs()`）
   - 12s 后 `saveCacheFile()`（写 userData 缓存 txt）
5. `updateMTimeLogs()`（`:3092-3199`）：读取/合并 `lastModifiedTimeMappings`，写入 `mtime.json`（先写 `eagle-temp/mtime-<guid>.json` 再 `fse.moveSync` 覆盖；写前 `unwatchMtimeFile` 防自触发）；若需要更新则调用 `backupMetadata()`。
6. `saveCacheFile`（debounced 250ms，`:197-323`）：先 `updateMTimeLogs()`（除非 ignoreMtime），再 `updateCacheFile()` 把 `library.imagesMapping` 每个 item 的单行 JSON 写入 `<userData>/library-caches/<fnv32a(rootDir)>.txt`（`fs.createWriteStream` → 临时文件 `.Date.now()` → `fse.moveSync` 覆盖）。
7. 退出：`before-quit` → `cancelAll()` → `saveCacheFile(cb, true)`（`:325-336`）；另有 IPC `save-cache-file`（`:342-348`）。

### A.9 命名/净化规则汇总

| 环节 | 实现 | 行为 |
|---|---|---|
| 渲染器初洗 | `app.bundle.js:30800-30801`（本地文件）/ `:30748-30763`（URL） | 去扩展名、去 `%`、去 emoji；URL 名先按剩余路径长度截断再 `sanitize` |
| 扩展/collect 侧 | `collect-window/js/lib/api/utils.js:53-62` `clearWeirdCharacters` | 去开头连续 `.`、emoji（正则）、`[#$%^&*()<>:'"/\\|?*]`、零宽字符 |
| background 主洗 | `background.js:6183`；`my_modules/sanitize-filename/index.js:33-49` | 移除 `\/?<>\\:*\|"`、控制码 `\x00-\x1f\x80-\x9f`、Windows 保留名（CON/PRN/...，删除后可能变空 → `_`）、尾部空格；`truncate-utf8-bytes` 到 255 字节 |
| 长度约束 | `utils/remainingFilenameLength.js:4-36` | Windows：`260-1-12-10 - len(rootDir) - 28`，且不超过 `255-10`；macOS：`1023 - len(rootDir) - 28`，上限 245。`EAGLE_THUMBNAIL_LENGTH=10` 为 `_thumbnail` 后缀预留 |
| Unicode | `background.js:6185` `unrom.nfc`；`app.bundle.js:42456-42472`（folder 名保存时同样 nfc） | NFC 归一化（日文浊音、组合字符） |
| 空名 | `background.js:6188-6190` | `"_"` |
| 文件夹名（仅导出时） | `background.js:4122-4153` `sanitizeFolderName` | macOS 仅替换 `:\/`；Windows 删除 `<>:"/\|?*` 与控制码、去尾空格/尾点、保留名加 `_`；再套 `sanitize()`；去尾 `.`（`4165-4167`） |
| 扩展名 | `utils/getExt.js` | 1) path.extname 且在 `SUPPORT_FORMATS` → 用 `file-type` 读前 262 字节复核（jpg/jfif/png/gif/webp/heic/bmp/avif）；2) `.dmg`→dmg；下载临时后缀 `.crdownload/.aria/.aria2/.part/.download`→undefined；3) `.gifv`→`mp4`；4) 有 `file.type` 时按 MIME 映射；5) 否则 file-type 嗅探 / SVG 文本检测 `"<svg"` |
| 尺寸探测 | `utils/imageSize.js`；`thumbs/jpg.js:10-17`；`thumbs/png.js:9` | `asyncImageTag`（浏览器解码，方向正确）优先，失败 `asyncSizeOf`；写回 `item.width/height` |
| 重名冲突 | —— | **item 之间不存在冲突**：每个 item 独占 `images/<id>.info/`。冲突只出现在导出：文件夹导出 `<name>-<NN>.<ext>`（`background.js:4230-4239`），图片导出追加 ` copy`（`:4364-4380`），大小写不敏感计数 |

### A.10 `guid()` 规则与碰撞

```js
// background.js:6340-6342（渲染器同实现 app.bundle.js:2396-2398）
function guid() {
  return (Date.now().toString(36) + Math.random().toString(36).substr(2, 5)).toUpperCase();
}
```
- 当前 `Date.now().toString(36)` 为 8 位；`substr(2,5)` 为 5 位 base36 → **13 位**大写 `[0-9A-Z]`。实测样例 `KD9ZV3ZXM75X0`（`app.bundle.js:106241`）。
- 库加载只接受目录名长度 `13` 或 `36`（`background.js:2811, 2965, 1970, 2076`）——36 位是旧版 UUID 兼容。
- **无显式碰撞检测/重试**：`guid()` 直接用作目录名，`fs.promises.mkdir(dir)` 若已存在会抛 EEXIST → 该次入库失败（外层 catch 报错并清目录）；重复项复制 `duplicateFile()` 同样只 `mkdirSync` 不递归（`background.js:3824-3862`）。碰撞概率极低，未见处理代码。

---

## B. library 磁盘模型与排列

### B.1 库目录布局（**观察**，源码 + 空库对照 + 诊断清单）

```
<name>.library/
├─ metadata.json              # 库结构（folders/smartFolders/quickAccess/tagsGroups/modificationTime/applicationVersion）
├─ mtime.json                 # { "<itemId>": <lastModified>, ..., "all": <itemCount> }
├─ tags.json                  # { historyTags: [], starredTags: [] }
├─ saved-filters.json         # [ {saved filter...} ]
├─ backup/                    # backup-YYYY-MM-DD HH.mm.ss.SSS.json（最多 100 份）+ metadata.json.damaged-<ts>
├─ extract/                   # eaglepack 导入临时解压目录，启动时清空
└─ images/
   ├─ <ID>.info/
   │  ├─ metadata.json
   │  ├─ <name>.<ext>
   │  └─ <name>_thumbnail.png     # 可能不存在（noThumbnail）或为 WebP 内容
   └─ Icon/                      # 目录枚举时被显式跳过（background.js:1885）
```
证据：
- `library.rootDir = normalize(rootDir)`；`library.imagesDir = rootDir + "/images/"`（`background.js:2290-2291`）
- 启动清 `extract`（`:2273-2275`）；启动删除根目录其他含 `mtime` 的文件（`:2445-2453`）
- 诊断面板枚举库 4 个 JSON：`metadata.json / mtime.json / tags.json / saved-filters.json`（`app.bundle.js:106183-106208`）
- 空库实测：`{"applicationVersion":"4.0.0","folders":[],"smartFolders":[],"quickAccess":[],"tagsGroups":[],"modificationTime":1792406982938}`

### B.2 `metadata.json`（库级）

创建（`background.js:4045-4052`）：
```js
var metadata = { "applicationVersion": appVersion, "folders": [], "smartFolders": [],
                 "quickAccess": [], "tagsGroups": [], "modificationTime": Date.now() };
```
写盘（`writeLibraryQueueCallback`，`background.js:5302-5454`）：
```js
var newLibrary = { folders, smartFolders, quickAccess, tagsGroups,
                   modificationTime: Date.now(), applicationVersion: appVersion };  // :5379-5386
// 先写 ~$metadata.json.tmp（同步工具占位），再 createWriteStream 覆盖 metadata.json；失败回退 writeFileSync
// :5401-5434
```
保护逻辑：
- 版本：库的应用版本高于当前 app → 报错并阻止（`:5339-5346`，`initLibrary` 同样 `:2294-2304`）
- 云同步冲突：磁盘上 `modificationTime > 内存` → 弹冲突框并 `initLibrary()`（`:5349-5356`）
- 保存前剔除临时字段：folder 删 `covers/images/folders/newFolderName/editable/pinyin/__root/extendTags/$$hashKey`（`:5359-5371`）；smartFolder 删 `newFolderName/editable/$$hashKey`（`:5373-5377`）

触发：渲染器 `$scope.saveFolder()`（`app.bundle.js:42453-42532`）→ IPC `folders-change`（`:42522`）→ `saveLibraryMetadata`（debounce 300ms，`background.js:3679-3705`）→ `writeLibraryQueue`（串行 1）。
渲染器一侧的字段裁剪（决定磁盘 schema）：
```js
// app.bundle.js:42467-42529
folders:     cloneTree(folders, $scope.folders)   // tree.helper.js:111-147:
   // {id,name,description,children,modificationTime,tags,extendTags,icon,iconColor,pinyin,
   //  password,passwordTips,coverId} + 仅当 orderBy 存在时 {orderBy,sortIncrease}
smartFolders: { id, icon, iconColor, name, description, modificationTime, conditions,
                children?（原样）, orderBy?, sortIncrease? }        // :42474-42492
tagsGroups:   { id, name, tags, color?, description? }               // :42498-42511（来自 TagManager.groups）
quickAccess:  { type: "folder"|"smartFolder", id }                   // :42513-42518
```

`folders[]` 节点字段（`tree.helper.js:111-147`，`loadLibrary` 补 `parent`）：`id, name, description, children[], modificationTime, tags[], extendTags[], icon, iconColor, pinyin, password, passwordTips, coverId, orderBy?, sortIncrease?`（`isExpand` 仅内存，不落盘；展开状态存 localStorage `eagle.sidebar.folder.expand.<id>`，`app.bundle.js:23059`）。
`smartFolders[]`：`id, name, description, icon, iconColor, modificationTime, conditions[], children?, orderBy?, sortIncrease?`；`conditions = [{ match:"AND"|"OR", rules:[{property,method,value,...}], boolean?:"TRUE"|"FALSE" }]`（`plugin/model/smart-folder.js:3-29`；`existInSmartFilter`，`app.bundle.js:32145-32168`；`boolean:"FALSE"` 取反 `:32150-32154`；嵌套 smartFolder 递归父级 `:32157-32160`）。
`quickAccess[]`：仅 `{type,id}` 数组，**数组顺序即显示顺序**（`app.bundle.js:46720-46795`）。
`tagsGroups[]`：`{id, name, tags:[字符串数组], color?, description?}`（`TagManager.createGroup`，`app.bundle.js:48224-48239`；`createGroupWithTags`，`:48241-48265`）。

### B.3 item 的 `metadata.json` 字段

创建时基础字段（`background.js:6198-6221`）+ 后续异步补充。完整可见集合（含代码中的真实样例）：
```json
{"id":"KD9ZV3ZXM75X0","name":"illust_002_testC_v07","size":97191,
 "btime":1596099298000,"mtime":1596187276884,"ext":"png","tags":[],"folders":[],
 "isDeleted":false,"url":"","annotation":"","modificationTime":1596185885977,
 "width":1200,"height":1200,"noThumbnail":true,
 "palettes":[{"color":[59,131,250],"ratio":81},{"color":[217,219,234],"ratio":7},
             {"color":[73,49,32],"ratio":6},{"color":[227,95,23],"ratio":3.25},
             {"color":[36,179,251],"ratio":0.74},{"color":[249,159,142],"ratio":0.46}],
 "lastModified":1596187279643,"star":3}
```
（来源：`app.bundle.js:106241` 内置的“磁盘测速”样例，字段与 `processImage` 生成一致）

字段清单与来源：

| 字段 | 写入者/位置 | 说明 |
|---|---|---|
| `id` | `processImage:6199` | 13 位 guid（历史可为 36 位 UUID） |
| `name` | `:6200` | 不含扩展名、已净化/NFC |
| `ext` | `:6204` | `getExt()` 结果 |
| `size` | `:6201` | 原文件字节数 |
| `btime`,`mtime` | `:6202-6203` | 文件系统 birthtime/mtime（ms） |
| `width`,`height` | 各 thumb 模块（如 `jpg.js:16-17`） | 图片像素；视频/字体/RAW 另有 meta |
| `tags` | `:6205`（+IPTC `:6224-6245`） | 字符串数组 |
| `folders` | `:6206` | 字符串数组（多归属） |
| `isDeleted` | `:6207`；删除 API `api-server.js:557` | 软删标志 |
| `deletedTime` | `api-server.js:558`；renderer 同名 | 删除时间（trash 排序用） |
| `url` | `:6208` | 来源网页；`length>2000` 时截断（`normalizeProperities:3512-3521`） |
| `annotation` | `:6209` | 备注 |
| `modificationTime` | `:6210-6217` | **“添加时间”**：导入批次用 `Date.now()+index` 保序；网络下载可被外部指定 |
| `star` | `:6211,6219-6221` | 0–5 |
| `lastModified` | `metadataQueueCallback:5562/5663` | 每次写 metadata 前更新，mtime.json 用它做增量 |
| `palettes` | `color-analyzer.js:85` | 颜色分析结果（数组，含 color/ratio）；分析中 `processingPalette:true` |
| `noThumbnail` | `thumbs/jpg.js:19-26`、`png.js:15-25` 等 | 无缩略图文件，用原图 |
| `noPreview` | `processImage:6288` | 缩略图失败时的 icon 模式 |
| `customThumbnail` | `background.js` set-custom-thumbnail（~1031+） | 用户自定义缩略图 |
| `pinned` | `app.bundle.js:43946-43957` | `{ [folderId]: timestamp }` 置顶 |
| `order` | `app.bundle.js:54196-54205` | `{ [folderId]: "小数/字符串" }` 手动排序 |
| `comments` | plugin `item.addComment`（`plugin/index.js:1757+`） | 批注数组（可选） |
| 其它可选 | `duration,bpm,fontMetas,rawMetas,videoID,videoEmbed,medium,orientation(会删),startAt/thumbnailAt` | 由各格式 thumb / 扩展导入写入 |

写盘前会清掉一批历史/临时字段：`encodeName, disable, buffer, startAt, oldName, newName, playing, thumbnailPath, rawPath, $$hashKey, activating, deactivating`（`removeUnusedProperities`，`background.js:3548-3568`）。

### B.4 `mtime.json`

- 生成：`createMTimeLogs()`（`background.js:3028-3074`）——遍历 `library.images`，取 `lastModified` 组成 `{id: ts}` 写盘。
- 更新：`updateMTimeLogs()`（`:3092-3199`）：
  - 以 `mtime.json` 中旧值补齐内存映射；删除不在 `library.imagesMapping` 的 id；
  - `lastModifiedTimeMappings["all"] = Object.keys(library.imagesMapping).length`（`:3159`）→ **`all` 是 item 数量**（不是时间）；
  - 判断是否需要写：新增 id、或 `max(lastModified) > mtime.json 文件 mtime`（`:3141-3157`）；
  - 写临时文件（`eagle-temp/mtime-<guid>.json`）→ `fse.moveSync` 覆盖（`:3166-3170`），写时 `unwatchMtimeFile/mtimeWatcherPath` 防自触发，写完 `backupMetadata()`。
- 用途：① 启动时与缓存比对增量（`:3382-3411`）；② 外部（云同步/另一台机器）修改检测，`watchMtimeFile` 每 4s 轮询（`:1814-1833`）；③ 快速判断删除（`all` 与目录数对比，`:1871-1936`）。

### B.5 `tags.json` / `saved-filters.json` / `backup/` / userData

- `tags.json`（`app.bundle.js:47123-47177`）：结构 `{ "historyTags": [], "starredTags": [] }`；不存在则原子创建；保存 5s 节流 + `writeFileAtomic`；仅保存“最近使用标签/星标标签”，**标签本身挂在 item.tags 与 tagsGroups 上**。
- `saved-filters.json`（`app.bundle.js:46882-46947`）：库根，JSON 数组；不存在则写 `[]`；`fs.watchFile` 4s 轮询外部修改；保存用 `writeFileAtomic`。
- `backup/`（`background.js:3207-3299`）：
  - 路径 `<library>/backup/`，文件名 `backup-YYYY-MM-DD HH.mm.ss.SSS.json`（moment 格式，`:3244-3245`）
  - 触发：`setInterval(backupMetadata, TEN_MIN)`（`TEN_MIN = 3*1000*60*10` ≈ **30 分钟**，`:3201-3205`）+ 每次 `updateMTimeLogs` 真正写盘后（`:3177`）
  - 去重：与最新备份文件比较 size，相同则跳过（`:3260-3265`）
  - 上限 `MAX_BACKUP_COUNT = 100`（注释写 200，`:3211-3224`），超出删最旧
  - 额外备份到 userData：`<userData>/eagle-backup/<fnv32a(rootDir)>.json`（`:3268-3273`）
  - 复原：`restoreMetadataFile()`（`:3301-3375`）按文件名倒序找第一个能 parse 且含 `modificationTime` 的备份，覆盖前把损坏文件另存 `metadata.json.damaged-<ts>`。
- userData：`<userData>/library-caches/<fnv32a(rootDir)>.txt`（item 缓存，单行 JSON）、`<userData>/eagle-temp`（下载/临时）、`<userData>/eagle-backup`（库 metadata 备份）、`<userData>/Settings`（electron-settings：`rootDir`、`libraryHistory` 等，`background.js:4091-4102, 2209`）。
- 库切换/历史：`addToHisotryAndOpen()`（`:4065-4113`）写 `settings.setSync('rootDir', openPath)` 与 `libraryHistory`。

### B.6 启动时如何重建、缓存与增量

`initLibrary()`（`background.js:2149-2629`）：
1. 读 `settings.get('rootDir')`（可被 `forcePath` 覆盖）→ 校验 `metadata.json` 存在、不能位于安装目录（`:2641-2657`）。
2. `loadLibrary()`（`:2635-2769`）：JSON.parse；校验 `applicationVersion`；给每个 folder 建 `images=[]` 与 `foldersMappings`；`tree.walk` 绑定 `parent` 并统计 `folderCount/encryptedFolderCount`；兼容 1.9.2 前 smartFolder `set/rules` → `conditions`（`:2724-2743`）；损坏则 `restoreMetadataFile()`。
3. `library.rootDir/imagesDir` 赋值（`:2290-2291`）；版本检查（`:2294-2304`）。
4. 缓存路径：`cacheID = hashFnv32a(rootDir,true)`；`newCacheDir = <userData>/library-caches/<cacheID>.txt`（`:2306-2319`）。
5. 有缓存（`:2322-2500`）：
   - 并行：`loadLibraryImageIds()`（`fs.readdir(imagesDir)` 只取名字，`:2931-2945`）+ `initFromCacheFile()`（逐行 parse 缓存，构建 `library.imagesMapping`，`:2164-2206`）
   - `loadRecentImages()`（`:2950-3026`）：目录里存在、缓存中没有、且 `metadata.json` 存在的 id → 读入 image 并 `library.images.push`
   - `checkLibraryDiff()`（`:3378-3510`）：对比 `mtime.json` 的 `lastModified` 与缓存中 `img.lastModified`，落后的重新读 metadata.json
   - 过滤掉本地目录已不存在的 item（`:2377-2384`）
   - 无变化则直接用缓存；有变化重写缓存 txt（`:2456-2484`）
   - 发送 IPC `app-status-library-loaded-end`（含 `rootDir/imagesDir/folders/smartFolders/quickAccess/tagsGroups/modificationTime/imagesStringPath/usingPreloadCache`，`:2402-2414`）；然后 `initWatcher(rootDir)`（`:2443`）
6. 无缓存（`:2501-2588`）：`loadImages()`（`:2774-2849`）→ `fs.readdir(imagesDir)`，只接受目录名长度 **13 或 36**（`:2809-2818`）→ `readMetadataFiles()`（32 并发读 metadata，`:2852-2908`）→ 构建 `imagesMapping`（只接受以 `}` 结尾的字符串，`:2833`）→ 写缓存 txt → IPC 同 5。
7. 渲染器把缓存 txt 逐行 `JSON.parse` 成 `$scope.raw`（`app.bundle.js:23106-23167`，带“破损 JSON 按错误 position 截断修复”的兜底 `:23133-23155`），再 `calculateImageBinding()` 计算 folder/tag/trash/封面等全部派生关系（`:28745-28960+`）。

### B.7 增量与文件监听（File Watcher）

`initWatcher(rootDir)`（`background.js:1540-1736`）：
- `watchMetadataFile`：`fs.watchFile(metadata.json, interval 4000)` → `refreshMetadata`（throttle 500ms，`:1747-1803`）→ 若外部 `modificationTime` 更新 → IPC `library.changed` 让渲染器刷新。
- `watchMtimeFile`：`fs.watchFile(mtime.json, interval 4000)` → `refreshLibrary`（throttle 500ms，`:1836-1956`）：
  - 读取 `mtime.json`，与内存 `lastModifiedTimeMappings` 比对 → `newFiles`/`editFiles`
  - `mtimeMappings["all"] !== imagesMapping 数量` 或强制 → 重新扫描 `images/` 目录，找新增/删除（`:1871-1936`）
  - 对新增/修改/删除 id 调用 `watchCallback({type:"create"|"edit"|"delete"})`
- `nsfw` 监听 `images/` 目录（仅非网络驱动器，`:1561-1731`）：
  - `action 0` 新增：忽略 `_thumbnail.png`、`.info`、`.url`；文件被外部替换时走 `editHandler`
  - `action 1` 删除：目录名含 `.info` → 取 id → `watchCallback delete`
  - `action 2/3`：`.json` → edit；其它非缩略图 → `editHandler`（等 2.5s 后比较 mtime，若变化则重生成缩略图 `regerateThumbnailQueue`）
  - 自身写入自触发抑制：`importItemDateMap[id]` 10s 内忽略（`:1585-1595`）；注释说明这是为避免刚导入即被 watcher 处理
- `watchCallback`（`:1958-2123`）：create/edit 时读取 metadata.json，与 `library.imagesMapping` 比较字符串；不同则 `imageWatchUpdateQueue` → IPC `image.added/image.changed/image.removed` 给渲染器；edit 额外用 `lastModifiedTimeMappings[itemId]` 500ms 防自触发（`:2080-2083`）。
- `imageWatchUpdateQueue.drain` 12s 后 `saveCacheFile(..., true)`（`:5880-5891`）。

### B.8 排列/排序总览

#### B.8.1 图片在库中的默认顺序
- 全局默认 `$scope.orderBy = localStorage['eagle.list.orderBy.<rootDir>'] || localStorage['eagle.list.orderBy'] || "IMPORT"`（`app.bundle.js:21324, 23027`）。
- `IMPORT` / default 分支：按 **`modificationTime` 降序**（新加入的在前）：
  ```js
  // app.bundle.js:21735-21741（sortRawData default）
  $scope.raw.sort(function(a,b){ var mtimeA=a.modificationTime||a.mtime, mtimeB=b.modificationTime||b.mtime;
                                 if(mtimeA>mtimeB) return -1; if(mtimeA<mtimeB) return 1; });
  ```
- 升/降：`sortIncrease`（全局存在 localStorage `eagle.list.sortIncrease[.<rootDir>]`，`app.bundle.js:21335, 21553-21554, 23030-23032`）；`false` 时对已排序数据 `reverse()`（`:28481-28483`）。
- 每个 folder / smartFolder 可覆盖 `orderBy` + `sortIncrease`（`cloneTree` 持久化，`tree.helper.js:136-139`；`setFolderOrder`，`app.bundle.js:41414-41431`）。

#### B.8.2 排序键与实现（`sortRawData` `:21658-21745`；`sortData` `:21747-21865`）

| 键 | 含义/UI 标签（`i18n/en.js:349-362`） | 实现 |
|---|---|---|
| `IMPORT`（默认） | Date Added（添加时间） | `modificationTime` 降序 |
| `MTIME` | Date Modified | `mtime || modificationTime` 降序 |
| `BTIME` | Date Created | `btime || modificationTime` 降序 |
| `NAME` | Title | `Intl.Collator(languageBCP,{numeric:true,sensitivity:'base'})` 升序 |
| `EXT` | Extension | collator 比较 ext |
| `FILESIZE` | File Size | `parseInt(size)` 升序 |
| `RESOLUTION` | Dimensions | `width*height` 升序 |
| `RATING` | Rating | `parseInt(star)||0` 升序 |
| `DURATION` | Duration | `parseInt(duration)||0` 升序 |
| `TAGS` | ——（列表模式支持点击排序） | 首个 tag collator 比较 |
| `MANUAL` | Manual（仅 folder 可选） | 见 B.8.4 |
| `RANDOM` | Random（仅 folder/smartFolder） | `clone.shuffle()`（`:21844-21846`）；随机视图缓存 `$scope.shuffle`（`:28216-28228`） |

UI 排序入口：
- 布局面板 `app/js/directives/layout-panel.html`：folder 下拉 `:51-63`（`""(Global Settings), MANUAL, IMPORT, MTIME, BTIME, NAME, EXT, FILESIZE, RESOLUTION, RATING, DURATION, RANDOM`）；smartFolder 下拉 `:81-92`（无 MANUAL）；全局下拉 `:108-119`（无 MANUAL/RANDOM）。
- 工具栏/右键 `app.bundle.js:39123`（多选文件夹）与 `:39663` 附近（多选智能文件夹）使用同一组 `['import','mtime','btime','name','ext','filesize','resolution','rating','duration','random']`。
- 列表视图列头可点击排序：`app/index.html:953-978`（`NAME / TAGS / RESOLUTION / RATING / EXT / FILESIZE / IMPORT` → `changeListOrderBy(...)`，`app.bundle.js:45314-45345`）。
- 排序状态持久化：`localStorage["eagle.list.orderBy[.<rootDir>]"]`、`["eagle.list.sortIncrease..."]`（`:45337-45358`）。

#### B.8.3 视图/布局
- 布局 4 种（`app.bundle.js:33844+`，`switchLayout`）：`JustifiedLayout`（默认，日志 `Layout: Justified`）、`GridLayout`（日志 `Waterfall`，瀑布流）、`SquareLayout`（日志 `Grid`，方格）、`ListLayout`（日志 `List`，列表）。默认 `localStorage eagle.list.layout[.<rootDir>] || "JustifiedLayout"`（`:23028`）。
- **没有独立“时间线视图”**；时间维度体现为排序（IMPORT/MTIME/BTIME）+ 日期筛选（`directives/filter-item-mtime.js`、`filter-item-import.js`）。trash 视图按 `-deletedTime`（fallback `-modificationTime`）排序（`:28208-28215`）。
- 颜色筛选时按 `colorDistancesMap` 距离排序（`:28190-28198`）。

#### B.8.4 item 手动排序（`order[folderId]`）——**关键**
- 存储：item 上的 `order` 对象，键为 folderId，值为**字符串化的大数/小数**（BigNumber）。
- 拖拽插入算法（`app.bundle.js:54047-54223`）：
  ```js
  // 取前后两项的 order（不存在则用 modificationTime）→ middle = (prev+target)/2
  // diff = middle.minus(targetOrder).div(selected.length).toPrecision()
  // 选中项依次 order[folderId] = middle.plus(diff*index).toPrecision()   // :54196-54205
  // 重复 order 值检测 + 重置：checkOrderDuplicate() → 按 1/10^precision 递增/递减 // :54047-54088
  // 拖拽后自动切到手动排序：setFolderOrder(currentFolder,"MANUAL", true) // :54220-54222
  ```
- 渲染排序（`:21800-21827`）：`orderMappings[id] = item.order[folderId] || item.modificationTime + ''`，**降序**（大值在前）；
- 置顶优先：`rebindRefresh` 中先按 `pinned[folderId]` 降序排最前（`app.bundle.js:27443-27463`），再做 orderBy 排序。
- 导入 eaglepack 时若源库使用手动排序，按 `order[oldFolderId] ?? modificationTime` 升序恢复（`background.js:5034-5040`）。

#### B.8.5 folder 的排序（侧边栏位置）
- **folder 的显示顺序 = `metadata.json` 中 `folders[]`/`children[]` 的数组顺序**，没有 `order`/`sortIndex` 字段（`tree.helper.js:111-147` 的 cloneTree 不含位置字段）。
- 拖动文件夹时直接对数组 `splice`：
  ```js
  // app/js/directives/folder-sortable.js:112-121（sortTopDroppable）
  $scope.folders.splice(dragIdx, 1);
  if (dragIdx > idx) $scope.folders.splice(idx, 0, draggedFolder);
  else $scope.folders.splice(idx - 1, 0, draggedFolder);
  ...
  $scope.saveFolder();   // :166
  ```
  同级放置/嵌套（`folderDroppable` `:48-81`）同样改数组并设 `draggedFolder.parent = droppedFolder.id`。
- “按标题排序”是**一次性重排数组**（非持久排序字段）：`reorderFolderByTitle()`（`app.bundle.js:41819-41834`，`localeCompare(...,{numeric:true})`）→ `saveFolder()`；UI 入口 `:39419-39452`（当前层 A→Z/Z→A、所有层 A→Z/Z→A）。
- 每个 folder 还有自己的**条目排序**字段 `orderBy/sortIncrease`（见 B.8.1），这与 folder 自身位置无关。
- smartFolders 数组顺序同理（拖动/新增顺序）。

#### B.8.6 星标、颜色、置顶、多 folder
- `star`：0–5 数字（`plugin/model/item.js:322-331`；filter `app.bundle.js:28129-28142`）。评分列/筛选基于它。
- 颜色：`palettes`（最多数个主色 + ratio，`color-analyzer.js` 通过 `image-palette` 分析缩略图/原图，480 尺寸输入，`:27-136`；`processingPalette` 标记进行中）；筛选按颜色相似度（`rule-match.js:723+` `isMatchColorRule`）和 `colorDistancesMap` 排序（`app.bundle.js:28190-28198`）；灰度图检测 `color.gray`（`:28184`）。
- `pinned`：`{folderId: ts}`；置顶/取消（`:43936-44016`）；渲染最前（`:27443-27463`）；仅文件夹视图，`RANDOM` 时跳过置顶排序。
- 多 folder 归属：`folders: string[]`；一个 item 可同时在多个文件夹（`calculateImageBinding` 对每个 folderId 计数/covers，`:28842-28946`）。
- folder 继承标签：`folder.tags` 沿父链合并为 `folder.extendTags`（`getExtendTags`，`app.bundle.js:28783-28826` 附近），添加 item 到该 folder 时把 `extendTags` 合并进 `item.tags`（`uploadFiles`，`:30822-30834`；collect window 同样处理 `collect.js:227-234`）。

#### B.8.7 quickAccess / tagsGroups / smartFolder 规则
- quickAccess：`{type,id}` 数组，仅 folder/smartFolder；添加/删除即 push/splice 后 `saveFolder()`（`app.bundle.js:46720-46795`）；没有额外排序字段。
- tagsGroups：TagManager 全局内存 + `saveFolder()` 落 `metadata.json.tagsGroups`；tag 本身是字符串，tag 的 “groups” 关系由 group.tags 反推（`TagManager.calculateTags`，`:48026-48120`）。
- smartFolder 规则：属性集合（`app.bundle.js:32170-32197`）：`name, folderName, url, annotation, comments, width, height, fileSize, createTime, mtime, btime, tags, rating, folders, type, shape, color, duration, bpm, camera, iso, aperture, focalLength, shutter, timestamp, fontActivated`；方法：`equal/startWith/endWith/contain/uncontain/empty/not-empty/regex/=/>=/<=/>/</between/on/before/after/within/union/intersection/identity/unequal/similar/accuracy/grayscale/activate/deactivate`（`plugin/model/smart-folder.js:199-213`；实现 `app/js/rule-match.js`）。smartFolder 的条目排序同样用 `orderBy`（`app.bundle.js:42473-42479, 28473-28479`）。

---

## C. 导出 / 打包 / 复制 / 移动 / trash

### C.1 导出文件夹（“导出为文件夹”）
`exportFolder()`（`background.js:4156-4292`）：
- 目标目录：`<savePath>/<sanitize(sanitizeFolderName(folder.name))>`，去尾 `.`（`:4163-4168`）
- 只导出 `image.folders.indexOf(folder.id) !== -1` 的项（父文件夹包含的子项不重复导出，`:4217-4221`）
- 源：`library.imagesDir + id + ".info/" + name + "." + ext`；`safeCopy.async(..., {preserveTimestamps:true, overwrite:true})`（`:4223-4240`）
- 同名去重：大小写不敏感计数，重复项命名 `<name>-<补零序号>.<ext>`（`:4194-4204, 4230-4239`）
- 递归子文件夹到 `folderDir`（`:4271-4281`）

### C.2 导出多个图片
`exportImages()`（`background.js:4295-4433`）：
- 目标目录；扫描已存在文件名（`fileName.replace(/-[0-9].*/,"")` 去后缀计数，`:4327-4339`）
- 同名：`<name>-<NN>.<ext>`；若仍存在则 `<name>-<NN> copy.<ext>`（`:4364-4380`）
- `safeCopy.async(..., {preserveTimestamps:true})`；完成后在 Finder/Explorer 中 reveal（≤500/≤1000 个）或打开目录（`:4400-4422`）

### C.3 `.eaglepack` 打包导出
`exportEaglePackage()`（`background.js:4436-4715`）：
- 结构：`{ folder?: <clone tree>, images: [<item metadata>...] }`（`:4462-4527`）；`json.images.sort((a,b)=>b.modificationTime-a.modificationTime)`（`:4529-4532`）
- 导出多选图片时清空 `folders`，垃圾桶项 `isDeleted` 会导出但删除 `isDeleted`（`:4513-4525`）
- 压缩：`archiver('zip', { store: true })`（**不压缩**，`:4540-4543`）
- 内容：
  - `pack.json` = `JSON.stringify(json)`（`:4549`）
  - 每个 item 的整个 `images/<id>.info` 目录作为 `<id>.info/` 加入（`:4570-4571`）
- 校验：`checkEaglePack()` 检查 zip 魔数 `PK\x03\x04/05/06/07/08`（`:4717-4736`）+ 实际大小 / 预期 `archive._pointer` < 0.8 视为失败（`:4671-4682`）
- 文件名：`<savePath 的 basename 去 .eaglepack>.eaglepack`（`:4536-4538`）

### C.4 `.eaglepack` 导入（路径迁移完整链）
`importEaglePackage()`（`background.js:4862-5120`）：
1. 解压到 `<library>/extract/<guid>/`（`:4912-4920`；启动会清空 `extract`）
2. 读 `pack.json`；`package.images.reverse()`（`:4969-4970`）
3. 通过渲染器 `get-duplicate-map` 去重（按 item id，重复则跳过，`:4976-4991`）
4. **每个 item 换新 `guid`**：`newIdMap[oldId]=newId`（`:5001-5005`）
5. 文件夹树换新 id（含 `coverId` 重映射）；`images` 先按 `order[oldFolderId] ?? modificationTime` 升序恢复手动顺序（`:5014-5040`）
6. item 的 `folders` 重映射到新 folder id；`modificationTime = Date.now() + index`（`:5042-5078`）
7. 物理迁移：`fse.moveSync(extract/<oldId>.info → extract/<newId>.info)` → 写新 `metadata.json` → `fse.moveSync(... → library/images/<newId>.info)`（`:5072-5086`）
8. 加入 `library.imagesMapping` 并 IPC `image.added`（`:5091-5099`）；清理解压目录

### C.5 库内复制 item
`duplicateFile()`（`background.js:3824-3862`）：新建 `guid`，`fse.copySync` 整个 `.info` → 删除新目录中 metadata → 读原 metadata、改 `id`、写回 → `watchCallback({type:"create"})` 让 UI 刷新。其余字段（name/folders/tags/star）原样复制。

### C.6 跨库“添加到资源库”（复制 item / folder / smartFolder / tagGroup）
`app.bundle.js:63847-64161`（`ADD_TO_LIBRARY` 监听）：
- tagGroup：读目标库 metadata，`tagGroup.id = guid()`，`unshift` 到 `tagsGroups`，写回（`:63918-63977`）
- folder：`cloneTree` 克隆（保留 id），目标库已存在同 id 子 folder 则剔除，`targetFolders.unshift(folder)`，写回（`:63980-64034`）
- item：`copyToLibrary()`（`:64115-64161`）：
  - 目标路径 `target/images/<item.id>.info/`（**item id 不变**）
  - `fse.copy` 整个 `.info`；读目标 metadata：无 folder 时 `folders=[]`；目标 folder 不是 `MANUAL` 时 `modificationTime = Date.now()+index`；写回
  - 完成后把 `items[].lastModified` 合并进目标库 `mtime.json`（`:64074-64084`）
- 没有“移动”跨库：跨库只有复制（源库不删）。

### C.7 trash 的物理位置与行为
- 删除（软删）：
  ```js
  // api-server.js:543-571（/api/item/moveToTrash）
  items.forEach(item => { item.isDeleted = true; item.deletedTime = now; ... });
  ayncsImagesChange(items);     // 写回各 item metadata.json
  ```
  渲染器右键删除 `/moveToTrash` 同样只置标志（`app.bundle.js:18416-18435`）。
- 物理文件位置：**仍在 `images/<id>.info/`**，不移动到任何 trash 目录；`$scope.trash` 只是内存数组（`calculateImageBinding` 按 `isDeleted` 分流，`:28836-28838`）；trash 视图按 `-deletedTime` 排序（`:28208-28215`）。
- 恢复：清 `isDeleted` 即可（数据从未移动）。
- 清空垃圾桶：IPC `empty-trash` → `trashQueue`（并发 20）→ `trashQueueCallback`（`background.js:583-614`）：
  ```js
  var dir = library.imagesDir + imageId + ".info/";
  delete library.imagesMapping[imageId];
  fse.remove(dir, ...);        // 物理删除；失败仅记日志
  ```
  完成后 `updateMTimeLogs` + `saveCacheFile`（`trashQueue.drain`，`:5893-5904`）。
- `remove-empty-folders` 修复工具同样 `fse.remove(dir)`（`:643-708`，失败回退 `rimraf.sync`）。

### C.8 库合并（importLibraryContent）
`background.js:4739-4857`：读另一库 metadata → 把 folder/smartFolder/tagsGroup 按 id 去重后**引用同一 id** 合并（渲染器 `moveNodeTo`，`app.bundle.js:26148-26200`）→ 对 `images/` 下每个 `<id>.info` 目录 `safeCopy.async` 到当前库同名目录（`:4811-4832`，已存在则跳过）→ 因为 item/folder id 不变，元数据引用天然有效。

---

## D. 搜索 / 索引

- **没有独立全文/倒排索引文件**（源码中无 sqlite/Lucene/索引目录；库根只有 4 个 JSON）。
- 启动“索引”= `images/*.info/metadata.json` 的全量汇总：
  - 无缓存时：`loadImages()` 扫描目录 + 32 并发读 metadata（`background.js:2774-2908`）
  - 有缓存时：`<userData>/library-caches/<hash>.txt` 每行一个 item JSON（`background.js:240-323`；渲染器 `app.bundle.js:23106-23167`）
- 增量基准：`mtime.json` 的 `lastModified`（`checkLibraryDiff`，`background.js:3378-3411`；`refreshLibrary`，`:1836-1956`）+ `images/` 目录 list 比对（新增/删除）+ 文件监听。
- 查询执行：内存对 `$scope.raw` 做 `filter`（关键字 `searchFilter`，`app.bundle.js:28201-28205`；标签/folder/评级/颜色/尺寸等 filter 串联），无外部索引；拼音模糊匹配用 `tiny-pinyin`/`pinyinlite` 在内存/懒计算（`app.bundle.js:22778-22779, 26360-26361, 28742, 28800-28802`）。
- 相似图/重复检测：不落盘，扫描时现场算感知哈希 `Phash.getFingerprint`（`lib/api/duplicate-checker.js:26`）与 `getHashID` 启发式键（`global.js:78-224`：size+width+height+ext 或 palette 颜色）。
- AI/语义搜索：外部插件服务 `http://localhost:38766`（`lib/api/ai-search.js:8-32`），Eagle 本体只做 HTTP 客户端与状态轮询；其向量索引位置 **【未知】**（不属于 `D:\eagle-app\extracted`）。

---

## E. 明确边界 / 未确认项

1. **主进程 `run.jsc`/`main.jsc` 不可反编译**：
   - 41593/41592 HTTP server 的解析与转发（`initServer`/`createServer`/`EXTENSION_PORT`/`[main] Local server ...`）
   - `downloadWithNet`/`downloadWithRequest` 的 electron `net` 细节（Referer/UA/timeout/content-type）
   - `show-item-in-folder`、`screenshot`、`downloads` 等系统集成
   以上只能依据 `run.jsc` 的 ASCII 字符串 + IPC 通道名判定（**推断**）。字符串证据：`initServer, createServer, EXTENSION_PORT, [main] Local server success to start and port is , [main] Local server failed to start and port is occupied., screencapture-from-extension, url-from-extension, upload-from-extension, downloadWithNet, downloadWithRequest, Referer, User-Agent, [main] unexpected content-type for download:`。
2. **41593 请求字段到 IPC payload 的精确映射**：`save-url`/`import-images`/`image` 三种 type 的字段名可从 collect-window 侧观察（`src/title/url/tags/folderIDs/star/annotation/base64/srcURL`），但主进程如何组装、是否做额外净化 **【未知】**。
3. **缩略图 `.png` 为 WebP 字节**这一点是“内容观察”（`compress()` 的 `format:"image/webp"` + 扩展名不变），本机没有非空库可字节级验证；**推断**所有 `_thumbnail.png`（非 `noThumbnail`、非自定义）均为 WebP。自定义缩略图是原样 `fse.copySync`，编码随源。
4. **`guid()` 碰撞处理**：代码中无重试；发生 EEXIST 时入库失败（推断，未实测）。
5. **`images/Icon` 目录**：`refreshLibrary` 显式跳过（`background.js:1885`），但未找到创建它的代码；可能是历史版本/模板图标的遗留目录，**未知**。
6. **`.eaglepack` 与旧版 Eagle 的兼容**：`pack.json` 的 `images` 使用当前版本字段集合，旧版本字段兼容逻辑仅见 `fix18VersionBug`/`removeUnusedProperities`，其余未知。
7. **阈值常量**：`MAX_FILENAME=240`（config.js:12）在 JS 中未被引用（实际用 `remainingFilenameLength`），可能是主进程/旧代码使用；`NO_THUMBNAIL_FILE_SIZE=15000000` 仅 jpg/png 使用。
8. **颜色“颜色标签”**：Eagle 没有手动的颜色标签字段，只有自动 `palettes` + 颜色筛选；若 Ant-Col 需要“手动颜色标签”需自建字段（观察 vs 设计差异）。

---

## F. 对 Ant-Col 的映射建议（基于以上事实，供 Lead 取舍）

| Eagle 事实 | Ant-Col 可借鉴点 | 注意差异 |
|---|---|---|
| 一键目录：`images/<ID>.info/` 自包含（原文件+缩略图+metadata 同目录），ID 稳定且不随改名变化 | 把 sidecar 与二进制放同一 per-item 目录，移动/删除/同步天然原子 | Ant-Col 当前是目录分桶 + 集中 `_index.json`；改成 per-item 目录会失去“人类可读文件名”优点（Eagle 靠 name 字段+索引） |
| 双层缓存：item metadata 单行 JSON 缓存 txt + `mtime.json`（id→lastModified + all 计数） | 增量加载的关键是“每 item 的 lastModified + 总数哨兵”，比 mtime 扫目录便宜 | Ant-Col 的 `_index.json` 可加 `mtime` 映射与 `count` 哨兵 |
| 写盘顺序：文件→缩略图→item metadata（异步队列）→2s mtime→12s 缓存 | 崩溃恢复容忍度高：任何阶段崩溃最多丢缓存，下次可重建 | 需要写队列串行化与 drain 级联 |
| folder 位置=数组顺序；folder 内条目排序=`orderBy`+`order[folderId]` 小数 `pinned` | 不引入额外 sortIndex 字段，拖拽直接数组 splice；手动顺序用分数避免全量重排 | 分数精度/重复值需要 reset 策略（Eagle 有 `checkOrderDuplicate`） |
| 多 folder 归属=`folders[]`，移动=只改 metadata | 用数组建模多归属，避免物理目录复制 | Ant-Col 若按 collection/collectionPath 物理分目录，则多归属需软链或 sidecar 指针 |
| 排序键固定 10 种（IMPORT/MTIME/BTIME/NAME/EXT/FILESIZE/RESOLUTION/RATING/DURATION/RANDOM/MANUAL/TAGS） | 直接对齐这套 key 与中文/英文标签 | Eagle 的 IMPORT 就是 `modificationTime`（入库时间），不是文件 mtime |
| 软删+清空才物理删；trash 无独立目录 | 备份/恢复更简单，误删可撤销 | Ant-Col 若要“回收站目录”需要自己搬移 |
| 无全文索引，靠缓存+内存过滤；AI 检索外置插件 | 小库（<10 万）内存过滤够用；大库需自建索引 | Ant-Col 若面向大库，应把 `_index.json` 换成可增量索引 |

---

## 附录：关键行号索引

**background.js**
| 行 | 内容 |
|---|---|
| 53 | `MTIMENAME = "mtime.json"` |
| 62-68 | `USER_DATA_PATH` / `EAGLE_THUMBNAIL_BACKUP_PATH` / `EAGLE_THUMBNAIL_TEMP_PATH` |
| 197-238 | `saveCacheFile`（debounce 250ms，先 mtime 再 cache） |
| 240-323 | `updateCacheFile`（写 `library-caches/<hash>.txt`） |
| 325-348 | `before-quit` / `save-cache-file` |
| 429-460 | `screencapture` |
| 554-577 | `upload-images`（本地图片路径 → guid → uploadFileQueue） |
| 583-634 | `trashQueueCallback` / `empty-trash` |
| 643-708 | `remove-empty-folders`（物理删 `.info`） |
| 772-845 | `upload-from-extension` / `url-from-extension`（写 `.url` 文件） |
| 853-861 | `upload-local-files` |
| 864-909 | `uploadFileQueue` |
| 911-929 | `upload-url` / `upload-urls`（→ Downloader） |
| 950-968 | 复制原图/缩略图到剪贴板的路径规则 |
| 1031-... | `set-custom-thumbnail` |
| 1540-1736 | `initWatcher`（nsfw 文件监听） |
| 1738-1803 | `watchMetadataFile` + `refreshMetadata` |
| 1805-1833 | `watchMtimeFile` |
| 1836-1956 | `refreshLibrary`（mtime 增量/重扫目录） |
| 1958-2123 | `watchCallback`（create/edit/delete → IPC） |
| 2149-2629 | `initLibrary`（缓存加载/无缓存全量/收尾） |
| 2635-2769 | `loadLibrary`（metadata.json 解析/校验/备份恢复） |
| 2774-2849 | `loadImages`（扫描 images，13/36 长度过滤） |
| 2852-2908 | `readMetadataFiles`（32 并发） |
| 2931-2945 | `loadLibraryImageIds` |
| 2950-3026 | `loadRecentImages`（缓存增量） |
| 3028-3074 | `createMTimeLogs` |
| 3092-3199 | `updateMTimeLogs`（`all`=count，`backupMetadata`） |
| 3207-3299 | `backupMetadata`（backup/ 100 份 + userData 备份） |
| 3301-3375 | `restoreMetadataFile` |
| 3378-3510 | `checkLibraryDiff` |
| 3548-3568 | `removeUnusedProperities` |
| 3570-3637 | `onImageChange` / `onImagesChange` |
| 3679-3705 | `saveLibraryMetadata`（debounce 300ms） |
| 3824-3862 | `duplicateFile` |
| 4014-4063 | `createLibrary`（库初始 metadata） |
| 4065-4113 | `addToHisotryAndOpen`（rootDir/history） |
| 4122-4153 | `sanitizeFolderName` |
| 4156-4292 | `exportFolder` |
| 4295-4433 | `exportImages` |
| 4436-4736 | `exportEaglePackage` + `checkEaglePack` |
| 4739-4857 | `importLibraryContent`（库合并） |
| 4862-5120 | `importEaglePackage`（换 id、迁移目录） |
| 5302-5454 | `writeLibraryQueueCallback`（写库 metadata.json） |
| 5458-5783 | `metadataQueueCallback`（写 item metadata.json） |
| 5785-5904 | 各队列 drain（mtime/cache/trash） |
| 5906-6011 | `processQueueCallback`（processImage 包装/失败清理） |
| 6045-6100 | `copyProcessFile`（cut/copy） |
| 6105-6313 | `processImage`（核心落盘） |
| 6340-6342 | `guid()` |
| 6401-6415 | `hashFnv32a`（cache key） |

**app.bundle.js**
| 行 | 内容 |
|---|---|
| 2287-2346 | `FileUrlHelper`（metadata/raw/thumbnail 路径） |
| 2363-2389 | `getThumbnailPath`（noThumbnail/svg 特判） |
| 2396-2398 | `guid()` |
| 21324 / 23027 | 全局 `orderBy` 默认 `IMPORT` |
| 21658-21745 | `sortRawData` |
| 21747-21865 | `sortData`（含 MANUAL/RANDOM） |
| 27420-27509 | `rebindRefresh`（pinned 优先 + allData） |
| 28055-28320 | 筛选链（rating/color/tag/…） |
| 28208-28215 | trash 视图排序 |
| 28462-28483 | 每 folder/smartFolder 的 orderBy + sortIncrease reverse |
| 28690-28960 | `calculateImageBinding`（重建 folder/tag/trash/封面） |
| 30128-30225 | 文件夹移除/恢复（只改 folders 数组） |
| 30726-30847 | `uploadUrls` / `uploadFiles` |
| 32145-32197 | `existInSmartFilter` + `MATCH_FUNCTION` |
| 33844+ | `switchLayout`（Grid/Justified/Square/List） |
| 41405-41490 | `setFolderOrder` / `setSmartFolderOrder`（orderBy/sortIncrease） |
| 41819-41883 | `reorderFolderByTitle` / `reorderAllFolderByTitle` |
| 42453-42532 | `$scope.saveFolder()` → `folders-change` |
| 43936-44016 | pin / unpin |
| 46720-46806 | `QuickAccessManager` |
| 46882-46947 | `SavedFilter`（saved-filters.json） |
| 47123-47177 | `TagManager.init/save`（tags.json） |
| 48026-48120 | `TagManager.calculateTags`（group↔tag） |
| 48224-48337 | tag group 创建/增删 tag |
| 54047-54223 | 手动拖拽排序（order[folderId] / MANUAL） |
| 63847-64161 | `ADD_TO_LIBRARY`（跨库复制 folder/tagGroup/item） |
| 106241 | item metadata 真实样例 |
| 106183-106208 | 库诊断清单（4 个 JSON） |

**其它**
- `api-server.js:1-5`（41595 server）、`:304-337`（createFolder）、`:396-447`（addPath/addURLs）、`:449-541`（addItemFromPath[s]）、`:543-571`（moveToTrash）、`:573-633`（addBookmark）、`:981-1018`（路由表）
- `api-server-v2.js:44-143`（/api/v2 路由 → plugin handler）
- `downloader.js:15-83`（队列/大图）、`:203-286`（net + referer）、`:288-341`（fetch 回退）、`:343-388`（base64/buffer）、`:390-422`（download 入口）
- `thumbs/thumb.js:5-52`（ThumbSize）、`:223-303`（generate/compress）、`:274-282`（webp 压缩）
- `utils/compress.js:21-94`（缩放+webp）、`utils/getExt.js`、`utils/remainingFilenameLength.js`
- `my_modules/sanitize-filename/index.js:33-49`
- `plugin/index.js:1434-1561`（item.add）、`plugin/model/item.js`、`plugin/model/folder.js`、`plugin/model/smart-folder.js`
- `config.js:5-12`（端口/缩略图尺寸/NO_THUMBNAIL_FILE_SIZE/MAX_FILENAME）、`:3-4,13-15`（支持格式）
- `collect-window/js/lib/api/item.js`、`collect-window/js/lib/api/utils.js:53-62`
- `run.jsc` 字符串（41593 server / download handlers / IPC 名称）
