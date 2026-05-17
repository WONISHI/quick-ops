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
  template?: object;
  data?: object;
  enabled: boolean;
  description?: string;
}

export interface IMockConfig {
  port: number;
  target: string;
  rules: IMockRule[];
}

export interface IProxyConfig {
  id: string;
  port: number;
  target: string;
  enabled: boolean;
}

export interface IMockRuleConfig {
  id: string;
  proxyId: string;
  method: string;
  url: string;
  contentType?: string;
  enabled: boolean;
  dataPath?: string;
  reqHeaders?: any;
  delay?: number;
  mode: 'mock' | 'custom' | 'file';
  data?: any;
  template?: any;
  filePath?: string;
  fileDisposition?: 'inline' | 'attachment';
  isTemplate?: boolean;
  target?: string;
}

export interface ILogrcConfig {
  general: {
    debug: boolean;
    anchorViewMode?: 'menu' | 'mindmap';
    mindMapPosition?: 'left' | 'right';
    mockDir?: string;
    inlineConstantHints?: boolean;
  };
  logger: { template: string; dateFormat: string };
  utils: { uuidLength: number };
  proxy?: IProxyConfig[];
  mock?: IMockRuleConfig[];
  git: { ignoreList: string[] };
  project: { alias: Record<string, string>; marks: Record<string, any> };
  [key: string]: any;
}
