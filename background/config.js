export const APP_NAME = '拾图';
export const SCHEMA = 'shitu/v2';

export const DEFAULT_SETTINGS = {
  // 'auto' = 若已选择文件夹则写文件夹，否则写下载目录；'folder' = 仅文件夹；'downloads' = 仅下载目录
  targetMode: 'auto',
  downloadsSubfolder: '拾图素材',
  autoTags: true,
  includeBackgroundImages: true,
  saveSidecar: true,
  dedupe: true,
  minImageSize: 200,
  screenshotFormat: 'png',
  screenshotQuality: 92,
  useReferrer: true,
  toast: true,
  filenameTemplate: '{date}_{time}_{site}_{name}',
  // 项目 / 主题。默认项目不额外建子目录，其他项目会作为素材库下的同名子文件夹。
  collections: ['灵感收集', '日常审美', '帮催作品'],
  defaultCollection: '灵感收集',
  theme: 'system',
  firstRunDone: false
};

export const KIND_FOLDER = {
  image: '图片',
  video: '视频',
  screenshot: '截图',
  link: '链接',
  file: '文件'
};

export const KIND_LABEL = {
  image: '图片',
  video: '视频',
  screenshot: '截图',
  link: '链接',
  file: '文件'
};

export const MAX_BATCH = 80;
export const FETCH_TIMEOUT_MS = 45000;
export const DOWNLOAD_TIMEOUT_MS = 120000;
