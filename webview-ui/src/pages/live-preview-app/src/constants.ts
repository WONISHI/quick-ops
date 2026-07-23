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

export const PREVIEW_DEVICE_GROUPS = [
  {
    label: '响应式',
    items: [
      {
        value: 'device-responsive',
        label: '响应式铺满',
      },
    ],
  },
  {
    label: 'Apple',
    items: [
      {
        value: 'device-iphone-se',
        label: 'iPhone SE',
      },
      {
        value: 'device-iphone-xr',
        label: 'iPhone XR',
      },
      {
        value: 'device-iphone-12-pro',
        label: 'iPhone 12 Pro',
      },
      {
        value: 'device-iphone-14-pro-max',
        label: 'iPhone 14 Pro',
      },
    ],
  },
  {
    label: 'Android',
    items: [
      {
        value: 'device-pixel-7',
        label: 'Pixel 7',
      },
      {
        value: 'device-galaxy-s8-plus',
        label: 'Galaxy S8+',
      },
      {
        value: 'device-galaxy-s20-ultra',
        label: 'Galaxy S20',
      },
    ],
  },
  {
    label: '平板电脑',
    items: [
      {
        value: 'device-ipad-mini',
        label: 'iPad Mini',
      },
      {
        value: 'device-ipad-air',
        label: 'iPad Air',
      },
      {
        value: 'device-ipad-pro',
        label: 'iPad Pro',
      },
      {
        value: 'device-surface-pro-7',
        label: 'Surface Pro',
      },
    ],
  },
] as const;

export const PREVIEW_ZOOM_MIN = 0.5;
export const PREVIEW_ZOOM_MAX = 2;
export const PREVIEW_ZOOM_STEP = 0.1;