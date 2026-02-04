import * as vscode from 'vscode';

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
