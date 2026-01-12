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
