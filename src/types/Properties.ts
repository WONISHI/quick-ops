import type { FileType } from './utils';
import type { EnvConf } from './EnvConf';
import * as vscode from 'vscode';
export interface Properties {
  // 打开文件路径不带（盘符）
  fullPath: string;
  // 打开文件路径带（盘符）
  filePath: string;
  // 打开文件名称
  fileName: string;
  // 打开文件后缀
  fileType: FileType | undefined;
  // 打开文件内容
  content: any;
  // 是否支持less语法
  supportsLessSyntax: boolean;
  // 是否支持scss语法
  supportsScssSyntax: boolean;
  // 项目是否携带配置文件
  configResult: boolean;
  // gitignore是否忽略插件的配置文件或者说是否需要设置忽略文件
  ignorePluginConfig?: boolean;
  // 自身忽略文件
  ignore: string[];
  // 插件自带的配置项
  pluginConfig: Partial<EnvConf> | null;
  // 项目配置的配置项
  workspaceConfig?: Partial<EnvConf> | null;
  // 合并后的配置项
  settings?: Partial<EnvConf> | null;
  // 文件是否被git跟踪
  isGitTracked: boolean;
  // 启动的服务
  server: any[];
  // 项目名称
  projectName?: string;
  // 项目使用的语言
  languagesCss?: string;
  // 是否是vue项目
  isVueProject?: boolean;
  // 是否是react项目
  isReactProject?: boolean;
  // vue是什么版本
  vueVersion?: number;
  // react是什么版本
  reactVersion?: number;
  // 项目启动目录
  scripts?: Record<string, string> | null;
  // 默认的代码片段
  snippets?: Record<string, any>[] | null;
  // 代码提示的文件格式
  completionDocumentSelector:vscode.DocumentSelector;
  // 读取配置文件格式
  configFileSchema:string[]
}
