import * as vscode from 'vscode';
import { SupportedFileType } from '@common/types/common.type';
export interface IWorkspaceContext {
  fileName: string;
  fileNameBase: string;
  fileExt: string;
  dirName: string;
  filePath: string;
  relativePath: string;

  moduleName: string;
  baseName: string;
  ModuleName: string;
  moduleNameCamel: string;
  moduleNameKebab: string;
  moduleNameSnake: string;
  moduleNameUpper: string;

  projectName: string;
  projectVersion: string;
  dependencies: Record<string, string>;
  hasDependency: (dep: string) => boolean;

  cssLang: 'css' | 'less' | 'scss';
  isVue3: boolean;
  isReact: boolean;
  isTypeScript: boolean;

  gitBranch: string;
  gitRemote: string;
  gitLocalBranch: string[];
  gitRemoteBranch: string[];

  shadcnComponents: [
    'accordion',
    'alert',
    'alert-dialog',
    'aspect-ratio',
    'avatar',
    'badge',
    'breadcrumb',
    'button',
    'button-group',
    'calendar',
    'card',
    'carousel',
    'chart',
    'checkbox',
    'collapsible',
    'combobox',
    'command',
    'context-menu',
    'data-table',
    'date-picker',
    'dialog',
    'drawer',
    'dropdown-menu',
    'empty',
    'field',
    'hover-card',
    'input',
    'input-group',
    'input-otp',
    'item',
    'kbd',
    'label',
    'menubar',
    'native-select',
    'navigation-menu',
    'pagination',
    'popover',
    'progress',
    'radio-group',
    'resizable',
    'scroll-area',
    'select',
    'separator',
    'sheet',
    'sidebar',
    'skeleton',
    'slider',
    'sonner',
    'spinner',
    'switch',
    'table',
    'tabs',
    'textarea',
    'toast',
    'toggle',
    'toggle-group',
    'tooltip',
    'typography',
  ];

  userName: string;
  dateYear: string;
  dateDate: string;
  dateTime: string;
}

export interface ICurrentFileState {
  uri: vscode.Uri | null;
  fileName: string;
  fileType: string;
  content: string;
  isDirty: boolean;
}

export interface ExportItem {
  name: string;
  code?: string;
}

export interface ParseResult {
  namedExports: ExportItem[];
  defaultExport: string[];
}

export interface ExportState {
  namedExports: ExportItem[];
  defaultExport: string[];
  selectedExports: string[];
}

export interface ISnippetItem {
  prefix: string;
  body: string[];
  description?: string;
  origin?: string;
  params?: Record<string, any>;
  scope?: string[];
  style?: string;
}

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