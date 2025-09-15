import type { FileType } from './utils';
import type { EnvConf } from './EnvConf';
export interface Properties {
  fullPath: string;
  filePath: string;
  fileName: string;
  fileType: FileType | undefined;
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
}
