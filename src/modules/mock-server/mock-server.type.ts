import type * as vscode from 'vscode';

export type MockRuleMode = 'mock' | 'custom' | 'file';

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
  on(event: 'error', listener: (error: any) => void): this;
  _port?: number;
  _domain?: string;
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
  data?: any;
  filePath?: string;
  fileDisposition?: string;
}