import { SupportedFileType } from '../constants';
import type { Options } from 'http-proxy-middleware';

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
  proxy?: Options;
  mock?: IMockConfig[];
  git: { ignoreList: string[] };
  project: { alias: Record<string, string>; marks: Record<string, any> };
  [key: string]: any;
}
