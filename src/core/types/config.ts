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

// 1. 定义独立的代理服务配置
export interface IProxyConfig {
  id: string;           // 代理的唯一标识
  port: number;         // 启动的本地端口
  target: string;       // 代理转发的目标真实地址
  enabled: boolean;     // 是否启用
}

// 2. 定义独立的 Mock 拦截规则配置
export interface IMockRuleConfig {
  id: string;           // 规则唯一标识
  proxyId: string;      // 所属的代理服务 ID
  method: string;       // 请求方法 (GET, POST 等)
  url: string;          // 拦截的接口路径
  contentType?: string; // 响应头 Content-Type
  target?: string;      // 独立覆盖的代理地址（为空则使用所属 proxy 的 target）
  enabled: boolean;     // 是否启用此规则
  dataPath?: string;    // 数据存放的相对路径 (如 .quickops/mocks/xxx.json)
  isTemplate?: boolean; // 标识存的是 Mock 模板(true) 还是 静态JSON(false)
  data?: any;           // 运行时承载的静态 JSON 数据（保存到文件后配置里可能不存）
  template?: any;       // 运行时承载的 Mock 模板数据（保存到文件后配置里可能不存）
}

// 3. 更新主配置接口
export interface ILogrcConfig {
  general: {
    debug: boolean;
    excludeConfigFiles: boolean;
    excludeTelemetryFile?: boolean;
    anchorViewMode?: 'menu' | 'mindmap';
    mindMapPosition?: 'left' | 'right';
    mockDir?: string;   // 【新增】Mock 数据文件的存放目录
  };
  logger: { template: string; dateFormat: string };
  utils: { uuidLength: number };

  proxy?: IProxyConfig[];      // 【修改】改为代理配置数组
  mock?: IMockRuleConfig[];    // 【修改】明确 Mock 规则数组的类型

  git: { ignoreList: string[] };
  project: { alias: Record<string, string>; marks: Record<string, any> };
  [key: string]: any;
}
