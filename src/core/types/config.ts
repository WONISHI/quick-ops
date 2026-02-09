import { SupportedFileType } from '../constants';

export interface IExtensionConfig {
  ignoreList: string[];
  customSnippets: ISnippetConfig[];
  devMode: boolean;
}

export interface ISnippetConfig {
  prefix: string;
  body: string | string[];
  description?: string;
  scope?: SupportedFileType[];
}

export interface IMockRule {
  id: string;
  url: string;
  method: string;
  contentType: string;
  template: object;
  enabled: boolean;
  description?: string;
}

export interface IMockConfig {
  port: number; // 本地代理服务器端口 (默认 3000)
  target: string; // 默认转发的真实后端地址 (e.g. https://api.real-server.com)
  rules: IMockRule[]; // 规则列表
}

export interface ILogrcConfig {
  general: {
    debug: boolean;
    excludeConfigFiles: boolean;
    excludeTelemetryFile?: boolean;
    anchorViewMode?: 'menu' | 'mindmap';
    mindMapPosition?: 'left' | 'right';
  };
  logger: { template: string; dateFormat: string };
  utils: { uuidLength: number };
  mock?: IMockConfig;
  git: { ignoreList: string[] };
  project: { alias: Record<string, string>; marks: Record<string, any> };
  [key: string]: any;
}
