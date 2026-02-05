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

export interface ILogrcConfig {
  general: { debug: boolean; excludeConfigFiles: boolean; anchorViewMode?: 'menu' | 'mindmap'; mindMapPosition?: 'left' | 'right' };
  logger: { template: string; dateFormat: string };
  utils: { uuidLength: number };
  git: { ignoreList: string[] };
  project: { alias: Record<string, string>; marks: Record<string, any> };
  [key: string]: any;
}
