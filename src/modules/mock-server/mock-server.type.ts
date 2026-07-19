import type * as vscode from 'vscode';

export type MockRuleMode = 'mock' | 'custom' | 'file';

export type MockFieldType = 'Basic' | 'Image' | 'Color' | 'Text' | 'Name' | 'Web' | 'Address' | 'Helper' | 'Miscellaneous' | 'Object' | 'Array';

export type MockGeneratorType =
  | 'fixed'
  | 'boolean'
  | 'natural'
  | 'integer'
  | 'float'
  | 'character'
  | 'string'
  | 'range'
  | 'date'
  | 'time'
  | 'datetime'
  | 'now'
  | 'image'
  | 'dataImage'
  | 'color'
  | 'paragraph'
  | 'sentence'
  | 'word'
  | 'title'
  | 'cparagraph'
  | 'csentence'
  | 'cword'
  | 'ctitle'
  | 'first'
  | 'last'
  | 'name'
  | 'cfirst'
  | 'clast'
  | 'cname'
  | 'url'
  | 'domain'
  | 'email'
  | 'ip'
  | 'tld'
  | 'area'
  | 'region'
  | 'capitalize'
  | 'upper'
  | 'lower'
  | 'pick'
  | 'shuffle'
  | 'guid'
  | 'id';

export interface MockFieldConfig {
  id: string;
  fieldName: string;
  /**
   * 新版可视化字段类型。
   * 可选是为了兼容旧版只有 generatorType 的配置。
   */
  fieldType?: MockFieldType;
  generatorType?: MockGeneratorType;
  arguments?: string;
  /** Array 类型生成的数据长度 */
  length?: number;
  /** Object / Array 类型的嵌套字段 */
  children?: MockFieldConfig[];
}

export interface MockProxyConfig {
  id: string;
  port: number;
  domain?: string;
  enabled: boolean;
  dataPath?: string;
  yamlPath?: string;
}

export interface MockRuleConfig {
  id: string;
  proxyId: string;
  method: string;
  url: string;
  contentType: string;
  enabled: boolean;
  dataPath: string;
  yamlPath: string;
  mode: MockRuleMode;
  delay?: number;
  reqHeaders?: any;
  statusCode?: number;
  data?: any;
  template?: any;
  mockFields?: MockFieldConfig[];
  filePath?: string;
  fileDisposition?: string;
  port?: number;
  domain?: string;
  _yamlUri?: vscode.Uri;
}

export interface MockYamlDocument {
  uri: vscode.Uri;
  raw: any;
}

export interface MockFullConfig {
  proxyList: MockProxyConfig[];
  mockList: Array<Omit<MockRuleConfig, '_yamlUri'>>;
  mockDir: string;
}

export interface MockHttpServer {
  close(callback?: (error?: Error) => void): void;
  closeAllConnections?(): void;
  closeIdleConnections?(): void;
  on(event: 'error', listener: (error: any) => void): this;
  _port?: number;
  _domain?: string;
}

export interface MockStopAllOptions {
  silent?: boolean;
}

export interface MockWebviewMessage {
  type: string;
  id?: string;
  ruleId?: string;
  proxyId?: string;
  value?: boolean;
  enabled?: boolean;
  payload?: any;
  message?: string;
  currentPath?: string;
  multiple?: boolean;
  template?: any;
  mode?: MockRuleMode;
}

export interface MockSaveProxyPayload {
  id?: string;
  port: number | string;
  domain?: string;
}

export interface MockSaveRulePayload {
  id?: string;
  proxyId: string;
  method: string;
  url: string;
  contentType: string;
  enabled: boolean;
  mode: MockRuleMode;
  delay?: number;
  reqHeaders?: any;
  statusCode?: number;
  template?: any;
  mockFields?: MockFieldConfig[];
  data?: any;
  filePath?: string;
  fileDisposition?: string;
}
