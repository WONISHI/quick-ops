import * as vscode from 'vscode';
import * as path from 'path';
import * as YAML from 'yaml';

import { ConfigurationService } from '../services/ConfigurationService';

export type MockRuleMode = 'mock' | 'custom' | 'file';

export interface IProxyConfig {
  id: string;
  port: number;
  domain?: string;
  enabled: boolean;
  dataPath?: string;
  yamlPath?: string;
}

export interface IMockRuleConfig {
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

interface IYamlDoc {
  uri: vscode.Uri;
  raw: any;
}

export class MockYamlStore {
  constructor(private configService: ConfigurationService = ConfigurationService.getInstance()) {}

  public getMockDir(): string {
    const general = vscode.workspace.getConfiguration('quick-ops').get<{ mockDir?: string }>('general');

    return general?.mockDir || this.configService.config.general?.mockDir || '';
  }

  public getWorkspaceRootUri(): vscode.Uri | undefined {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri : undefined;
  }

  public buildServiceId(domain?: string, port?: number): string {
    return `${this.normalizeDomain(domain)}:${Number(port || 0)}`;
  }

  public resolvePathToUri(input?: string): vscode.Uri | undefined {
    const value = (input || '').trim();
    if (!value) return this.getWorkspaceRootUri();

    if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value)) {
      return vscode.Uri.parse(value);
    }

    if (path.isAbsolute(value)) {
      return vscode.Uri.file(value);
    }

    const rootUri = this.getWorkspaceRootUri();
    if (rootUri) {
      const parts = value.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.');
      return parts.length > 0 ? vscode.Uri.joinPath(rootUri, ...parts) : rootUri;
    }

    return vscode.Uri.file(value);
  }

  public pathForConfig(uri: vscode.Uri): string {
    const rootUri = this.getWorkspaceRootUri();

    if (rootUri && uri.scheme === rootUri.scheme && uri.authority === rootUri.authority) {
      const rootPath = rootUri.path.replace(/\/+$/, '');
      const targetPath = uri.path;

      if (targetPath === rootPath) return '.';
      if (targetPath.startsWith(rootPath + '/')) {
        return targetPath.slice(rootPath.length + 1).replace(/\\/g, '/');
      }
    }

    if (uri.scheme === 'file') {
      return uri.fsPath.replace(/\\/g, '/');
    }

    return uri.toString();
  }

  public ensureYamlFilePath(input: string, id: string): string {
    const value = (input || '').trim().replace(/\\/g, '/');

    if (!value) {
      const mockDir = this.getMockDir();
      if (!mockDir) throw new Error('请先设置全局 Mock YAML 存放目录');
      return path.posix.join(mockDir.replace(/\\/g, '/'), `${id}.yaml`);
    }

    if (/\.ya?ml$/i.test(value)) return value;

    if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value)) {
      return vscode.Uri.joinPath(vscode.Uri.parse(value), `${id}.yaml`).toString();
    }

    return path.posix.join(value, `${id}.yaml`);
  }

  public async readAllServices(): Promise<IProxyConfig[]> {
    const endpoints = await this.readAllEndpoints();
    const serviceMap = new Map<string, IProxyConfig>();

    for (const item of endpoints) {
      const port = Number(item.port || 0);
      const domain = this.normalizeDomain(item.domain);

      if (!port) continue;

      const serviceId = this.buildServiceId(domain, port);
      const existed = serviceMap.get(serviceId);

      if (existed) {
        existed.enabled = existed.enabled || item.enabled;
      } else {
        serviceMap.set(serviceId, {
          id: serviceId,
          port,
          domain,
          enabled: !!item.enabled,
        });
      }
    }

    return Array.from(serviceMap.values());
  }

  public async readAllEndpoints(): Promise<IMockRuleConfig[]> {
    const docs = await this.readAllYamlDocuments();
    const endpoints = docs
      .map((doc) => this.readEndpointFromRaw(doc.raw, doc.uri))
      .filter(Boolean) as IMockRuleConfig[];

    return endpoints;
  }

  public async saveEndpoint(endpoint: IMockRuleConfig, yamlPath?: string): Promise<IMockRuleConfig> {
    const id = endpoint.id;
    const finalYamlPath = this.ensureYamlFilePath(yamlPath || endpoint.dataPath || endpoint.yamlPath || this.getMockDir(), id);
    const yamlUri = this.resolvePathToUri(finalYamlPath);

    if (!yamlUri) {
      throw new Error('无法解析接口 YAML 文件路径');
    }

    const doc = this.toEndpointYamlDocument(endpoint);
    const yamlText = YAML.stringify(doc);

    await this.ensureParentDirectory(yamlUri);
    await vscode.workspace.fs.writeFile(yamlUri, Buffer.from(yamlText, 'utf8'));

    return {
      ...endpoint,
      dataPath: this.pathForConfig(yamlUri),
      yamlPath: this.pathForConfig(yamlUri),
      _yamlUri: yamlUri,
    };
  }

  public async patchEndpoint(ruleId: string, patch: Partial<IMockRuleConfig>): Promise<void> {
    const endpoints = await this.readAllEndpoints();
    const target = endpoints.find((item) => item.id === ruleId);

    if (!target) return;

    await this.saveEndpoint(
      {
        ...target,
        ...patch,
      },
      target.yamlPath || target.dataPath,
    );
  }

  public async patchService(serviceId: string, patch: Partial<IProxyConfig>): Promise<void> {
    const endpoints = await this.readAllEndpoints();
    const targets = endpoints.filter((item) => item.proxyId === serviceId);

    for (const item of targets) {
      const nextDomain = patch.domain === undefined ? item.domain : patch.domain;
      const nextPort = patch.port === undefined ? item.port : Number(patch.port);

      await this.saveEndpoint(
        {
          ...item,
          domain: nextDomain,
          port: nextPort,
          proxyId: this.buildServiceId(nextDomain, nextPort),
          enabled: patch.enabled === undefined ? item.enabled : !!patch.enabled,
        },
        item.yamlPath || item.dataPath,
      );
    }
  }

  public async setAllEnabled(enabled: boolean): Promise<void> {
    const endpoints = await this.readAllEndpoints();

    for (const item of endpoints) {
      await this.saveEndpoint(
        {
          ...item,
          enabled,
        },
        item.yamlPath || item.dataPath,
      );
    }
  }

  public async deleteEndpoint(ruleId: string): Promise<void> {
    const endpoints = await this.readAllEndpoints();
    const target = endpoints.find((item) => item.id === ruleId);

    if (!target?._yamlUri) return;

    try {
      await vscode.workspace.fs.delete(target._yamlUri, { useTrash: false });
    } catch (e) {}
  }

  public async deleteService(serviceId: string): Promise<void> {
    const endpoints = await this.readAllEndpoints();
    const targets = endpoints.filter((item) => item.proxyId === serviceId);

    for (const item of targets) {
      if (!item._yamlUri) continue;

      try {
        await vscode.workspace.fs.delete(item._yamlUri, { useTrash: false });
      } catch (e) {}
    }
  }

  private async readAllYamlDocuments(): Promise<IYamlDoc[]> {
    const mockDir = this.getMockDir();
    if (!mockDir) return [];

    const dirUri = this.resolvePathToUri(mockDir);
    if (!dirUri) return [];

    try {
      const stat = await vscode.workspace.fs.stat(dirUri);

      if (stat.type === vscode.FileType.File) {
        if (!/\.ya?ml$/i.test(dirUri.path)) return [];
        const raw = await this.readYamlRaw(dirUri);
        return raw ? [{ uri: dirUri, raw }] : [];
      }

      const yamlUris = await this.readYamlFilesRecursive(dirUri);
      const docs = await Promise.all(
        yamlUris.map(async (uri) => {
          const raw = await this.readYamlRaw(uri);
          return raw ? { uri, raw } : undefined;
        }),
      );

      return docs.filter(Boolean) as IYamlDoc[];
    } catch (e) {
      return [];
    }
  }

  private async readYamlRaw(uri: vscode.Uri): Promise<any | undefined> {
    try {
      const fileData = await vscode.workspace.fs.readFile(uri);
      return YAML.parse(Buffer.from(fileData).toString('utf8')) || {};
    } catch (e) {
      console.error('[MockYamlStore] 读取 YAML 失败:', uri.toString(), e);
      return undefined;
    }
  }

  private async readYamlFilesRecursive(dirUri: vscode.Uri): Promise<vscode.Uri[]> {
    const result: vscode.Uri[] = [];

    let entries: [string, vscode.FileType][] = [];
    try {
      entries = await vscode.workspace.fs.readDirectory(dirUri);
    } catch (e) {
      return result;
    }

    for (const [name, type] of entries) {
      const childUri = vscode.Uri.joinPath(dirUri, name);

      if (type === vscode.FileType.Directory) {
        result.push(...await this.readYamlFilesRecursive(childUri));
      } else if (type === vscode.FileType.File && /\.ya?ml$/i.test(name)) {
        result.push(childUri);
      }
    }

    return result;
  }

  private readEndpointFromRaw(raw: any, uri: vscode.Uri): IMockRuleConfig | undefined {
    const request = raw.request || {};
    const response = raw.response || {};
    const service = raw.service || {};

    const hasEndpointShape = raw.type === 'quickops-mock-endpoint' || request.path || raw.url || raw.path || response.mode || raw.mode;
    if (!hasEndpointShape) return undefined;

    const port = Number(service.port ?? raw.port);
    if (!port) return undefined;

    const domain = this.normalizeDomain(service.domain || raw.domain || '127.0.0.1');
    const proxyId = this.buildServiceId(domain, port);

    const id = String(raw.id || this.getFileNameWithoutExt(uri));

    const method = String(
      request.method ||
      raw.method ||
      (Array.isArray(request.methods) ? request.methods[0] : undefined) ||
      (Array.isArray(raw.methods) ? raw.methods[0] : undefined) ||
      'GET',
    ).toUpperCase();

    const url = this.normalizeUrl(String(request.path || raw.url || raw.path || '/'));

    const responseFile = response.file || {};
    let mode = String(response.mode || raw.mode || '') as MockRuleMode;

    if (!mode) {
      if (responseFile.path || raw.filePath) mode = 'file';
      else if (response.template || raw.template) mode = 'mock';
      else mode = 'custom';
    }

    const data = response.data ?? response.content ?? raw.data ?? raw.content;
    const template = response.template ?? raw.template ?? (mode === 'mock' ? response.content : undefined);
    const yamlPath = this.pathForConfig(uri);

    return {
      id,
      proxyId,
      method,
      url,
      contentType: String(response.contentType || raw.contentType || 'application/json'),
      enabled: raw.enabled !== false,
      dataPath: yamlPath,
      yamlPath,
      mode,
      delay: Number(response.delay ?? raw.delay ?? 0),
      reqHeaders: request.headers || raw.reqHeaders || null,
      statusCode: Number(response.statusCode ?? raw.statusCode ?? 200),
      data,
      template,
      filePath: String(responseFile.path || raw.filePath || ''),
      fileDisposition: String(responseFile.disposition || raw.fileDisposition || 'inline'),
      port,
      domain,
      _yamlUri: uri,
    };
  }

  private toEndpointYamlDocument(endpoint: IMockRuleConfig) {
    const method = String(endpoint.method || 'GET').toUpperCase();
    const mode = endpoint.mode || 'mock';
    const statusCode = Number(endpoint.statusCode || 200);
    const delay = Number(endpoint.delay || 0);
    const domain = this.normalizeDomain(endpoint.domain || '127.0.0.1');
    const port = Number(endpoint.port || 0);

    const request: any = {
      method,
      methods: [method],
      path: this.normalizeUrl(endpoint.url || '/'),
    };

    if (endpoint.reqHeaders && typeof endpoint.reqHeaders === 'object') {
      request.headers = endpoint.reqHeaders;
    }

    const response: any = {
      statusCode,
      contentType: endpoint.contentType || 'application/json',
      delay,
      mode,
    };

    if (mode === 'file') {
      response.file = {
        path: endpoint.filePath || '',
        disposition: endpoint.fileDisposition || 'inline',
      };
      response.content = {
        type: 'file',
        path: endpoint.filePath || '',
      };
    } else if (mode === 'custom') {
      response.data = endpoint.data ?? {};
      response.content = endpoint.data ?? {};
    } else {
      response.template = endpoint.template ?? {};
      response.content = endpoint.template ?? {};
    }

    return {
      version: 1,
      type: 'quickops-mock-endpoint',
      id: endpoint.id,
      enabled: endpoint.enabled !== false,
      service: {
        domain,
        port,
      },
      request,
      response,
    };
  }

  private async ensureParentDirectory(fileUri: vscode.Uri): Promise<void> {
    const parentPath = fileUri.path.replace(/\/[^/]*$/, '') || '/';
    const parentUri = fileUri.with({ path: parentPath });

    try {
      await vscode.workspace.fs.createDirectory(parentUri);
    } catch (e) {}
  }

  private getFileNameWithoutExt(uri: vscode.Uri): string {
    const baseName = uri.path.split('/').pop() || 'mock';
    return baseName.replace(/\.ya?ml$/i, '');
  }

  private normalizeUrl(url: string): string {
    const value = (url || '/').trim();
    return value.startsWith('/') ? value : `/${value}`;
  }

  private normalizeDomain(domain?: string): string {
    const value = String(domain || '127.0.0.1').trim();
    return value.replace(/^https?:\/\//, '').split('/')[0].split(':')[0] || '127.0.0.1';
  }
}