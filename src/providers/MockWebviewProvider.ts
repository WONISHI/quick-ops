import * as vscode from 'vscode';
import * as Mock from 'mockjs';
import { nanoid } from 'nanoid';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigurationService } from '../services/ConfigurationService';
import { MockServerFeature } from '../features/MockServerFeature';
import { getSidebarHtml, getProxyPanelHtml, getRulePanelHtml } from '../views/MockWebviewHtml';

export class MockWebviewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  private proxyPanel: vscode.WebviewPanel | undefined;
  private rulePanel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _mockFeature: MockServerFeature,
  ) { }

  public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };
    webviewView.webview.html = getSidebarHtml();
    webviewView.webview.onDidReceiveMessage(async (data) => {
      await this.handleMessage(data, webviewView.webview);
    });
  }

  private getWorkspaceRoot(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
  }

  private getMockDataPath(dataPath: string): string | undefined {
    if (path.isAbsolute(dataPath)) return dataPath;
    const root = this.getWorkspaceRoot();
    if (!root) return undefined;
    return path.join(root, dataPath);
  }

  private getDefaultUri(currentPath?: string): vscode.Uri | undefined {
    const rootPath = this.getWorkspaceRoot();
    if (currentPath && currentPath.trim() !== '') {
      let absPath = currentPath;
      if (!path.isAbsolute(currentPath)) {
        if (!rootPath) return undefined;
        absPath = path.join(rootPath, currentPath);
      }
      
      let currentSearch = absPath;
      while (currentSearch && currentSearch !== path.dirname(currentSearch)) {
        if (fs.existsSync(currentSearch)) {
          return vscode.Uri.file(currentSearch);
        }
        currentSearch = path.dirname(currentSearch);
      }
    }
    return rootPath ? vscode.Uri.file(rootPath) : undefined;
  }

  private async getFullConfig() {
    const configService = ConfigurationService.getInstance();
    await configService.loadConfig();

    let proxyList = Array.isArray(configService.config.proxy) ? configService.config.proxy : [];
    let mockList = Array.isArray(configService.config.mock) ? configService.config.mock : [];
    const mockDir = configService.config.general?.mockDir || '';

    const fullMockList = mockList.map(rule => {
      const fullRule = { ...rule };
      if (rule.dataPath && rule.mode !== 'file') { 
        const absPath = this.getMockDataPath(rule.dataPath);
        if (absPath && fs.existsSync(absPath)) {
          try {
            const parsedContent = JSON.parse(fs.readFileSync(absPath, 'utf8'));
            if (rule.mode === 'custom') fullRule.data = parsedContent;
            else fullRule.template = parsedContent;
          } catch (e) { }
        }
      }
      return fullRule;
    });
    return { proxyList, mockList: fullMockList, mockDir };
  }

  public async handleMessage(data: any, webview: vscode.Webview) {
    const configService = ConfigurationService.getInstance();
    const { proxyList, mockList: fullMockList, mockDir } = await this.getFullConfig();

    switch (data.type) {
      case 'error': vscode.window.showErrorMessage(data.message); break;
      case 'refresh': this.refreshSidebar(); break;
      case 'toggleServer':
        if (data.value) await this._mockFeature.startAll();
        else await this._mockFeature.stopAll();
        break;
      case 'copyText':
        vscode.env.clipboard.writeText(data.payload).then(() => vscode.window.showInformationMessage('复制成功：' + data.payload));
        break;
      case 'selectGlobalMockDir': {
        const defaultUri = this.getDefaultUri(data.currentPath);
        const uri = await vscode.window.showOpenDialog({
          canSelectFiles: false, canSelectFolders: true, canSelectMany: false, defaultUri, openLabel: '选择全局 Mock 数据存放目录'
        });
        if (uri && uri[0]) {
          const rootPath = this.getWorkspaceRoot();
          let savePath = uri[0].fsPath;
          if (rootPath && savePath.startsWith(rootPath)) {
            savePath = path.relative(rootPath, savePath);
            if (savePath === '') savePath = '.';
          }
          savePath = savePath.replace(/\\/g, '/');
          let general = configService.config.general || {};
          general.mockDir = savePath;
          await configService.updateConfig('general', general);
          this.refreshSidebar();
        }
        break;
      }
      case 'selectFileReturnPath': {
        const defaultUri = this.getDefaultUri(data.currentPath);
        const uris = await vscode.window.showOpenDialog({
          canSelectFiles: true, canSelectFolders: false, canSelectMany: data.multiple === true, defaultUri, openLabel: data.multiple ? '选择文件 (支持多选)' : '选择文件'
        });
        
        if (uris && uris.length > 0) {
          const rootPath = this.getWorkspaceRoot();
          const paths = uris.map(uri => {
            let savePath = uri.fsPath;
            if (rootPath && savePath.startsWith(rootPath)) {
              savePath = path.relative(rootPath, savePath);
            }
            return savePath.replace(/\\/g, '/');
          });
          this.rulePanel?.webview.postMessage({ type: 'fileReturnPathSelected', path: paths.join('\n') });
        }
        break;
      }
      case 'openProxyPanel': this.showProxyPanel(data.id); break;
      case 'openRulePanel': this.showRulePanel(data.proxyId, data.ruleId); break;
      case 'toggleProxy': {
        const pGroup = proxyList.find(p => p.id === data.id);
        if (pGroup) {
          pGroup.enabled = data.enabled;
          await configService.updateConfig('proxy', proxyList);
          await this._mockFeature.syncServers();
          this.refreshSidebar();
        }
        break;
      }
      case 'deleteProxy': {
        const ansProxy = await vscode.window.showWarningMessage(`确定要删除此服务吗？相关的规则也会被移除。`, { modal: true }, '删除');
        if (ansProxy === '删除') {
          const newProxyList = proxyList.filter(p => p.id !== data.id);
          fullMockList.filter(m => m.proxyId === data.id).forEach(r => {
            if (r.dataPath) {
              const absPath = this.getMockDataPath(r.dataPath);
              if (absPath && fs.existsSync(absPath)) fs.unlinkSync(absPath);
            }
          });
          const newMockList = fullMockList.filter(m => m.proxyId !== data.id).map(r => { const { data, template, ...rest } = r; return rest; });
          await configService.updateConfig('proxy', newProxyList);
          await configService.updateConfig('mock', newMockList);
          await this._mockFeature.syncServers();
          this.refreshSidebar();
        }
        break;
      }
      case 'deleteRule': {
        const ansRule = await vscode.window.showWarningMessage(`确定要删除此规则吗？`, { modal: true }, '删除');
        if (ansRule === '删除') {
          const ruleToDelete = fullMockList.find((r: any) => r.id === data.ruleId);
          if (ruleToDelete && ruleToDelete.dataPath) {
            const absPath = this.getMockDataPath(ruleToDelete.dataPath);
            if (absPath && fs.existsSync(absPath)) fs.unlinkSync(absPath);
          }
          let pureMockList = Array.isArray(configService.config.mock) ? configService.config.mock : [];
          await configService.updateConfig('mock', pureMockList.filter((r: any) => r.id !== data.ruleId));
          this.refreshSidebar();
        }
        break;
      }
      case 'toggleRule': {
        let pureMockList = Array.isArray(configService.config.mock) ? configService.config.mock : [];
        const rule = pureMockList.find((r: any) => r.id === data.ruleId);
        if (rule) {
          rule.enabled = data.enabled;
          await configService.updateConfig('mock', pureMockList);
          this.refreshSidebar();
        }
        break;
      }
    }
  }

  public updateStatus(runningProxyIds: string[]) {
    this._view?.webview.postMessage({ type: 'status', runningProxies: runningProxyIds });
  }

  private async refreshSidebar() {
    if (this._view) {
      const { proxyList, mockList, mockDir } = await this.getFullConfig();
      this._view.webview.postMessage({ type: 'config', proxy: proxyList, mock: mockList, mockDir });
      this._mockFeature.notifyStatusToWebview();
    }
  }

  public async showProxyPanel(proxyId?: string) {
    if (this.proxyPanel) {
      this.proxyPanel.reveal(vscode.ViewColumn.One);
    } else {
      this.proxyPanel = vscode.window.createWebviewPanel('proxyPanel', proxyId ? '编辑 Mock 服务' : '新增 Mock 服务', vscode.ViewColumn.One, { enableScripts: true });
      this.proxyPanel.onDidDispose(() => { this.proxyPanel = undefined; });
      this.proxyPanel.webview.html = getProxyPanelHtml();

      this.proxyPanel.webview.onDidReceiveMessage(async (data) => {
        if (data.type === 'error') vscode.window.showErrorMessage(data.message);
        else if (data.type === 'cancel') this.proxyPanel?.dispose();
        else if (data.type === 'saveProxy') {
          const configService = ConfigurationService.getInstance();
          await configService.loadConfig();
          let proxyList = Array.isArray(configService.config.proxy) ? configService.config.proxy : [];
          const newProxy = data.payload;
          if (!newProxy.id) {
            newProxy.id = nanoid();
            newProxy.enabled = true;
            proxyList.push(newProxy);
          } else {
            const idx = proxyList.findIndex((p: any) => p.id === newProxy.id);
            if (idx > -1) proxyList[idx].port = newProxy.port;
          }
          await configService.updateConfig('proxy', proxyList);
          await this._mockFeature.syncServers();
          this.proxyPanel?.dispose();
          this.refreshSidebar();
        }
      });
    }

    const configService = ConfigurationService.getInstance();
    await configService.loadConfig();
    const proxies = Array.isArray(configService.config.proxy) ? configService.config.proxy : [];
    this.proxyPanel.webview.postMessage({ type: 'init', proxy: proxies.find((p: any) => p.id === proxyId) });
  }

  public async showRulePanel(proxyId: string, ruleId?: string) {
    if (this.rulePanel) {
      this.rulePanel.reveal(vscode.ViewColumn.One);
    } else {
      this.rulePanel = vscode.window.createWebviewPanel('rulePanel', ruleId ? '编辑规则' : '新增规则', vscode.ViewColumn.One, { enableScripts: true });
      this.rulePanel.onDidDispose(() => { this.rulePanel = undefined; });
      this.rulePanel.webview.html = getRulePanelHtml();

      this.rulePanel.webview.onDidReceiveMessage(async (data) => {
        if (data.type === 'error') vscode.window.showErrorMessage(data.message);
        else if (data.type === 'cancel') this.rulePanel?.dispose();
        else if (data.type === 'simulate') {
          try {
            let parsedTemplate = typeof data.template === 'string' ? JSON.parse(data.template) : data.template;
            let result;
            if (data.mode === 'mock') {
              result = Mock.mock(parsedTemplate);
            } else {
              result = parsedTemplate; 
            }
            this.rulePanel?.webview.postMessage({ type: 'simulateResult', result });
          } catch (e: any) {
            this.rulePanel?.webview.postMessage({ type: 'simulateResult', error: e.message });
          }
        } else if (data.type === 'selectRuleMockDir') {
           const defaultUri = this.getDefaultUri(data.currentPath);
           const uri = await vscode.window.showOpenDialog({
             canSelectFiles: false, canSelectFolders: true, canSelectMany: false, defaultUri, openLabel: '选择此规则的数据存放目录'
           });
           if (uri && uri[0]) {
             const rootPath = this.getWorkspaceRoot();
             let savePath = uri[0].fsPath;
             if (rootPath && savePath.startsWith(rootPath)) {
               savePath = path.relative(rootPath, savePath);
               if (savePath === '') savePath = '.';
             }
             this.rulePanel?.webview.postMessage({ type: 'ruleDirSelected', path: savePath.replace(/\\/g, '/') });
           }
        } else if (data.type === 'selectFileReturnPath') { 
           await this.handleMessage(data, this.rulePanel!.webview);
        } else if (data.type === 'saveRule') {
          const newRuleData = data.payload;
          if (!newRuleData.id) newRuleData.id = nanoid();

          const rootPath = this.getWorkspaceRoot();
          let ruleDataPath = newRuleData.dataPath;
          if (!ruleDataPath || ruleDataPath.trim() === '') return vscode.window.showErrorMessage('保存失败：存放路径不能为空！');
          if (!ruleDataPath.endsWith('.json')) ruleDataPath = path.posix.join(ruleDataPath.replace(/\\/g, '/'), `${newRuleData.id}.json`);

          let absPath = ruleDataPath;
          if (!path.isAbsolute(ruleDataPath)) {
            if (!rootPath) return vscode.window.showErrorMessage('未打开工作区，无法保存相对路径规则！');
            absPath = path.join(rootPath, ruleDataPath);
          }

          const dir = path.dirname(absPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

          if (newRuleData.mode === 'mock') {
            fs.writeFileSync(absPath, JSON.stringify(newRuleData.template || {}, null, 2), 'utf8');
          } else if (newRuleData.mode === 'custom') {
            fs.writeFileSync(absPath, JSON.stringify(newRuleData.data || {}, null, 2), 'utf8');
          } else if (newRuleData.mode === 'file') {
            fs.writeFileSync(absPath, JSON.stringify({ type: "file_mock", file: newRuleData.filePath, disposition: newRuleData.fileDisposition }, null, 2), 'utf8');
          }

          // 🌟 保存配置包含 delay 和 reqHeaders
          const ruleToSaveConfig: any = {
            id: newRuleData.id, 
            proxyId: newRuleData.proxyId, 
            method: newRuleData.method, 
            url: newRuleData.url,
            contentType: newRuleData.contentType, 
            enabled: newRuleData.enabled, 
            dataPath: ruleDataPath,
            mode: newRuleData.mode,
            delay: newRuleData.delay,           // 🌟 延时毫秒
            reqHeaders: newRuleData.reqHeaders  // 🌟 自定义请求头
          };
          
          if (newRuleData.mode === 'file') {
             ruleToSaveConfig.filePath = newRuleData.filePath;
             ruleToSaveConfig.fileDisposition = newRuleData.fileDisposition;
          }

          const configService = ConfigurationService.getInstance();
          await configService.loadConfig();
          let pureMockList = Array.isArray(configService.config.mock) ? configService.config.mock : [];
          const rIdx = pureMockList.findIndex((r: any) => r.id === newRuleData.id);
          if (rIdx > -1) pureMockList[rIdx] = ruleToSaveConfig; else pureMockList.push(ruleToSaveConfig);

          await configService.updateConfig('mock', pureMockList);
          this.rulePanel?.dispose();
          this.refreshSidebar();
        }
      });
    }

    const configService = ConfigurationService.getInstance();
    await configService.loadConfig();
    const mocks = Array.isArray(configService.config.mock) ? configService.config.mock : [];
    let fullRule = mocks.find((r: any) => r.id === ruleId) ? { ...mocks.find((r: any) => r.id === ruleId) } : null;
    
    if (fullRule && fullRule.dataPath && fullRule.mode !== 'file') {
      const absPath = this.getMockDataPath(fullRule.dataPath);
      if (absPath && fs.existsSync(absPath)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(absPath, 'utf8'));
          if (fullRule.mode === 'custom') fullRule.data = parsed; 
          else fullRule.template = parsed;
        } catch (e) { }
      }
    }
    this.rulePanel.webview.postMessage({ type: 'init', proxyId, rule: fullRule, globalMockDir: configService.config.general?.mockDir || '' });
  }
}