import type { BrowserEngineKey, BrowserEngineOption } from '@pages/live-preview-app/src/type';
export const ROOT_FAVORITE_FOLDER_ID = 'root';

export const BROWSER_ENGINE_OPTIONS: BrowserEngineOption[] = [
  {
    key: 'baidu',
    label: '百度',
    shortName: '百',
    homeUrl: 'https://www.baidu.com/',
    searchUrl: (keyword) => `https://www.baidu.com/s?wd=${encodeURIComponent(keyword)}`,
  },
  {
    key: 'bing',
    label: 'Bing',
    shortName: 'B',
    homeUrl: 'https://www.bing.com/',
    searchUrl: (keyword) => `https://www.bing.com/search?q=${encodeURIComponent(keyword)}`,
  },
  {
    key: 'quark',
    label: '夸克',
    shortName: '夸',
    homeUrl: 'https://quark.sm.cn/',
    searchUrl: (keyword) => `https://quark.sm.cn/s?q=${encodeURIComponent(keyword)}`,
  },
];

export const DEFAULT_BROWSER_ENGINE_KEY: BrowserEngineKey = 'baidu';
export const BROWSER_ENGINE_STORAGE_KEY = 'quickOps.livePreview.browserEngine';
