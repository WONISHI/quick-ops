import * as vscode from 'vscode';
import * as Mock from 'mockjs';
import { nanoid } from 'nanoid';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigurationService } from '../services/ConfigurationService';
import { MockServerFeature } from '../features/MockServerFeature';

export class MockWebviewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  private proxyPanel: vscode.WebviewPanel | undefined;
  private rulePanel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _mockFeature: MockServerFeature,
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(async (data) => {
      await this.handleMessage(data, webviewView.webview);
    });
  }

  private getWorkspaceRoot(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
  }

  private getMockDataPath(dataPath: string): string | undefined {
    if (path.isAbsolute(dataPath)) {
      return dataPath;
    }
    const root = this.getWorkspaceRoot();
    if (!root) return undefined;
    return path.join(root, dataPath);
  }

  private async getFullConfig() {
    const configService = ConfigurationService.getInstance();
    await configService.loadConfig();

    let proxyList = Array.isArray(configService.config.proxy) ? configService.config.proxy : [];
    let mockList = Array.isArray(configService.config.mock) ? configService.config.mock : [];
    const mockDir = configService.config.general?.mockDir || '';

    const fullMockList = mockList.map((rule) => {
      const fullRule = { ...rule };
      if (rule.dataPath) {
        const absPath = this.getMockDataPath(rule.dataPath);
        if (absPath && fs.existsSync(absPath)) {
          try {
            const fileContent = fs.readFileSync(absPath, 'utf8');
            const parsedContent = JSON.parse(fileContent);
            if (rule.isTemplate) {
              fullRule.template = parsedContent;
            } else {
              fullRule.data = parsedContent;
            }
          } catch (e) {}
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
      case 'error':
        vscode.window.showErrorMessage(data.message);
        break;

      case 'refresh':
        this.refreshSidebar();
        break;

      case 'toggleServer':
        if (data.value) await this._mockFeature.startAll();
        else await this._mockFeature.stopAll();
        break;

      case 'copyText':
        vscode.env.clipboard.writeText(data.payload).then(() => {
          vscode.window.showInformationMessage('复制成功：' + data.payload);
        });
        break;

      case 'selectGlobalMockDir': {
        const rootPath = this.getWorkspaceRoot();
        const defaultUri = rootPath ? vscode.Uri.file(rootPath) : undefined;
        const uri = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          defaultUri: defaultUri,
          openLabel: '选择全局 Mock 数据存放目录',
        });
        if (uri && uri[0]) {
          const selectedAbsPath = uri[0].fsPath;
          let savePath = selectedAbsPath;
          if (rootPath && selectedAbsPath.startsWith(rootPath)) {
            savePath = path.relative(rootPath, selectedAbsPath);
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

      case 'openProxyPanel':
        this.showProxyPanel(data.id);
        break;

      case 'openRulePanel':
        this.showRulePanel(data.proxyId, data.ruleId);
        break;

      case 'toggleProxy': {
        const pGroup = proxyList.find((p) => p.id === data.id);
        if (pGroup) {
          pGroup.enabled = data.enabled;
          await configService.updateConfig('proxy', proxyList);
          await this._mockFeature.syncServers();
          this.refreshSidebar();
        }
        break;
      }

      case 'deleteProxy': {
        const ansProxy = await vscode.window.showWarningMessage(`确定要删除此代理吗？相关的规则也会被移除。`, { modal: true }, '删除');
        if (ansProxy === '删除') {
          const newProxyList = proxyList.filter((p) => p.id !== data.id);
          const rulesToDelete = fullMockList.filter((m) => m.proxyId === data.id);
          rulesToDelete.forEach((r) => {
            if (r.dataPath) {
              const absPath = this.getMockDataPath(r.dataPath);
              if (absPath && fs.existsSync(absPath)) fs.unlinkSync(absPath);
            }
          });
          const newMockList = fullMockList
            .filter((m) => m.proxyId !== data.id)
            .map((r) => {
              const { data, template, ...rest } = r;
              return rest;
            });
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
          pureMockList = pureMockList.filter((r: any) => r.id !== data.ruleId);
          await configService.updateConfig('mock', pureMockList);
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
      this.proxyPanel = vscode.window.createWebviewPanel('proxyPanel', proxyId ? '编辑代理服务' : '新增代理服务', vscode.ViewColumn.One, { enableScripts: true });
      this.proxyPanel.onDidDispose(() => {
        this.proxyPanel = undefined;
      });
      this.proxyPanel.webview.html = this.getProxyPanelHtml();

      this.proxyPanel.webview.onDidReceiveMessage(async (data) => {
        if (data.type === 'error') {
          vscode.window.showErrorMessage(data.message);
        } else if (data.type === 'cancel') {
          this.proxyPanel?.dispose();
        } else if (data.type === 'saveProxy') {
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
            if (idx > -1) {
              proxyList[idx] = { ...proxyList[idx], ...newProxy };
            }
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
    const proxy = proxies.find((p: any) => p.id === proxyId);

    this.proxyPanel.webview.postMessage({ type: 'init', proxy });
  }

  public async showRulePanel(proxyId: string, ruleId?: string) {
    if (this.rulePanel) {
      this.rulePanel.reveal(vscode.ViewColumn.One);
    } else {
      this.rulePanel = vscode.window.createWebviewPanel('rulePanel', ruleId ? '编辑拦截规则' : '新增拦截规则', vscode.ViewColumn.One, { enableScripts: true });
      this.rulePanel.onDidDispose(() => {
        this.rulePanel = undefined;
      });
      this.rulePanel.webview.html = this.getRulePanelHtml();

      this.rulePanel.webview.onDidReceiveMessage(async (data) => {
        if (data.type === 'error') {
          vscode.window.showErrorMessage(data.message);
        } else if (data.type === 'cancel') {
          this.rulePanel?.dispose();
        } else if (data.type === 'simulate') {
          try {
            const template = typeof data.template === 'string' ? JSON.parse(data.template) : data.template;
            const result = Mock.mock(template);
            this.rulePanel?.webview.postMessage({ type: 'simulateResult', result });
          } catch (e: any) {
            this.rulePanel?.webview.postMessage({ type: 'simulateResult', error: e.message });
          }
        } else if (data.type === 'selectRuleMockDir') {
          const rootPath = this.getWorkspaceRoot();
          const defaultUri = rootPath ? vscode.Uri.file(rootPath) : undefined;
          const uri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri,
            openLabel: '选择此规则的数据存放目录',
          });
          if (uri && uri[0]) {
            const selectedAbsPath = uri[0].fsPath;
            let savePath = selectedAbsPath;
            if (rootPath && selectedAbsPath.startsWith(rootPath)) {
              savePath = path.relative(rootPath, selectedAbsPath);
              if (savePath === '') savePath = '.';
            }
            savePath = savePath.replace(/\\/g, '/');
            this.rulePanel?.webview.postMessage({ type: 'ruleDirSelected', path: savePath });
          }
        } else if (data.type === 'saveRule') {
          const newRuleData = data.payload;
          if (!newRuleData.id) newRuleData.id = nanoid();

          const rootPath = this.getWorkspaceRoot();
          let ruleDataPath = newRuleData.dataPath;

          if (!ruleDataPath || ruleDataPath.trim() === '') return vscode.window.showErrorMessage('保存失败：Mock 数据存放路径不能为空！');
          if (!ruleDataPath.endsWith('.json')) ruleDataPath = path.posix.join(ruleDataPath.replace(/\\/g, '/'), `${newRuleData.id}.json`);

          let absPath = ruleDataPath;
          if (!path.isAbsolute(ruleDataPath)) {
            if (!rootPath) return vscode.window.showErrorMessage('未打开工作区，无法保存相对路径规则！');
            absPath = path.join(rootPath, ruleDataPath);
          }

          const dir = path.dirname(absPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

          const contentToSave = newRuleData.template !== undefined ? newRuleData.template : newRuleData.data || {};
          const isTemplate = newRuleData.template !== undefined;
          fs.writeFileSync(absPath, JSON.stringify(contentToSave, null, 2), 'utf8');

          const ruleToSaveConfig = {
            id: newRuleData.id,
            proxyId: newRuleData.proxyId,
            method: newRuleData.method,
            url: newRuleData.url,
            contentType: newRuleData.contentType,
            target: newRuleData.target,
            enabled: newRuleData.enabled,
            dataPath: ruleDataPath,
            isTemplate: isTemplate,
          };

          const configService = ConfigurationService.getInstance();
          await configService.loadConfig();
          let pureMockList = Array.isArray(configService.config.mock) ? configService.config.mock : [];
          const rIdx = pureMockList.findIndex((r: any) => r.id === newRuleData.id);

          if (rIdx > -1) pureMockList[rIdx] = ruleToSaveConfig;
          else pureMockList.push(ruleToSaveConfig);

          await configService.updateConfig('mock', pureMockList);
          this.rulePanel?.dispose();
          this.refreshSidebar();
        }
      });
    }

    const configService = ConfigurationService.getInstance();
    await configService.loadConfig();
    const proxies = Array.isArray(configService.config.proxy) ? configService.config.proxy : [];
    const mocks = Array.isArray(configService.config.mock) ? configService.config.mock : [];
    const rule = mocks.find((r: any) => r.id === ruleId);

    let fullRule = rule ? { ...rule } : null;
    if (fullRule && fullRule.dataPath) {
      const absPath = this.getMockDataPath(fullRule.dataPath);
      if (absPath && fs.existsSync(absPath)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(absPath, 'utf8'));
          if (fullRule.isTemplate) fullRule.template = parsed;
          else fullRule.data = parsed;
        } catch (e) {}
      }
    }

    const globalMockDir = configService.config.general?.mockDir || '';

    this.rulePanel.webview.postMessage({
      type: 'init',
      proxyId,
      rule: fullRule,
      globalMockDir,
      proxies,
      mocks,
    });
  }

  public getHtmlForWebview(webview: vscode.Webview) {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Proxy & Mock Manager</title>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
        :root {
          --primary: var(--vscode-textLink-activeForeground);
          --border: var(--vscode-panel-border);
          --bg: var(--vscode-editor-background);
          --bg-hover: var(--vscode-list-hoverBackground);
          --text: var(--vscode-editor-foreground);
          --text-sub: var(--vscode-descriptionForeground);
          --error: var(--vscode-errorForeground);
          --success: #4caf50;
        }
        body { font-family: var(--vscode-font-family); padding: 0; margin: 0; color: var(--text); background: var(--bg); display: flex; flex-direction: column; height: 100vh; font-size: 13px; }
        .header { padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--vscode-sideBar-background); display: flex; flex-direction: column; gap: 10px; }
        .header-top { display: flex; justify-content: space-between; align-items: center; }
        .header-title { font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 8px; }
        .server-status { font-size: 12px; padding: 4px 10px; border-radius: 20px; background: #444; color: #ccc; cursor: pointer; user-select: none; display: flex; align-items: center; gap: 6px; transition: all 0.2s; border: 1px solid transparent; }
        .server-status:hover { filter: brightness(1.1); }
        .server-status.on { background: rgba(76, 175, 80, 0.15); color: var(--success); border-color: var(--success); }
        .server-status i { font-size: 8px; }
        .mock-dir-setting { font-size: 11px; padding: 4px 8px; border-radius: 4px; background: transparent; color: var(--text-sub); border: 1px solid var(--border); cursor: pointer; display: flex; align-items: center; gap: 6px; transition: 0.2s; }
        .mock-dir-setting:hover { border-color: var(--primary); color: var(--text); }
        .mock-dir-setting.empty { color: var(--error); border-color: var(--error); }
        .content { flex: 1; overflow-y: auto; padding: 16px 12px; }
        .empty-tip { text-align: center; padding: 40px; opacity: 0.5; color: var(--text-sub); }
        .proxy-container { border: 1px solid var(--border); border-radius: 8px; margin-bottom: 20px; background: var(--bg); overflow: hidden; }
        .proxy-header { background: var(--vscode-sideBar-background); padding: 12px 14px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;}
        .proxy-info { display: flex; align-items: center; gap: 8px; font-weight: bold; flex-wrap: wrap; flex: 1; min-width: 0; }
        .target-wrapper { display: flex; align-items: center; gap: 6px; position: relative; flex: 1; min-width: 150px; overflow: hidden;}
        .port-badge { background: var(--primary); color: white; padding: 2px 6px; border-radius: 4px; font-size: 11px; }
        .proxy-target { font-family: monospace; font-size: 12px; opacity: 0.8; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .proxy-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .copy-icon { opacity: 0; pointer-events: none; transition: opacity 0.2s; cursor: pointer; color: var(--primary); font-size: 13px; flex-shrink: 0; }
        .copy-icon:hover { opacity: 1 !important; filter: brightness(1.2); }
        .rule-list { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
        .rule-card { border: 1px solid var(--border); border-radius: 6px; padding: 10px; display: flex; align-items: center; gap: 12px; background: var(--vscode-editor-background); position: relative; overflow: hidden; }
        .rule-card.disabled { opacity: 0.6; filter: grayscale(0.8); }
        .rule-card::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: transparent; transition: 0.2s; }
        .rule-card.active::before { background: var(--success); }
        .rule-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
        .rule-row-1 { display: flex; align-items: center; gap: 8px; }
        .rule-row-2 { display: flex; align-items: center; gap: 10px; font-size: 11px; color: var(--text-sub); flex-wrap: wrap;}
        .tag { font-size: 10px; font-weight: bold; padding: 2px 6px; border-radius: 3px; }
        .tag.GET { background: rgba(52, 152, 219, 0.1); color: #3498db; }
        .tag.POST { background: rgba(46, 204, 113, 0.1); color: #2ecc71; }
        .tag.PUT { background: rgba(243, 156, 18, 0.1); color: #f39c12; }
        .tag.DELETE { background: rgba(231, 76, 60, 0.1); color: #e74c3c; }
        .url-text { font-family: 'Consolas', monospace; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .icon-btn { background: transparent; border: none; color: var(--text-sub); cursor: pointer; padding: 4px 6px; border-radius: 4px; transition: 0.2s; }
        .icon-btn:hover { background: var(--bg-hover); color: var(--text); }
        .icon-btn.del:hover { color: var(--error); background: rgba(255,0,0,0.1); }
        .switch { position: relative; display: inline-block; width: 32px; height: 18px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #555; transition: .3s; border-radius: 18px; }
        .slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 2px; bottom: 2px; background-color: white; transition: .3s; border-radius: 50%; }
        input:checked + .slider { background-color: var(--success); }
        input:checked + .slider:before { transform: translateX(14px); }
        .add-rule-btn { display: block; width: 100%; padding: 8px; border: 1px dashed var(--border); background: transparent; color: var(--text-sub); border-radius: 4px; cursor: pointer; transition: 0.2s; text-align: center; }
        .add-rule-btn:hover { border-color: var(--primary); color: var(--primary); }
        .footer { padding: 12px; border-top: 1px solid var(--border); background: var(--vscode-sideBar-background); }
        .btn-pri { background: var(--primary); color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; display: flex; justify-content: center; align-items: center; gap: 8px; width: 100%; font-size: 13px; }
        .btn-pri:hover { opacity: 0.9; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="header-top">
            <div class="header-title"><i class="fa-solid fa-network-wired"></i> 代理与 Mock 管理</div>
            <div id="globalServerBtn" class="server-status" title="点击一键启停所有启用的服务">
               <i class="fa-solid fa-circle"></i> <span id="globalStatusText">已停止</span>
            </div>
        </div>
        <div id="mockDirBtn" class="mock-dir-setting" title="设置全局默认 Mock 数据存放目录" onclick="selectGlobalMockDir()" style="align-self: flex-start; max-width: 100%; box-sizing: border-box;">
           <i class="fa-regular fa-folder-open" style="flex-shrink: 0;"></i> 
           <span id="mockDirDisplay" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">加载中...</span>
        </div>
      </div>
      <div class="content" id="proxyList"></div>
      <div class="footer">
        <button onclick="openProxyModal()" class="btn-pri"><i class="fa-solid fa-plus"></i> 添加代理服务 (Proxy)</button>
      </div>
      <script>
        const vscode = acquireVsCodeApi();
        let proxies = []; 
        let mocks = [];
        let runningProxies = []; 
        let isGlobalRunning = false;
        let globalMockDir = ''; 

        window.addEventListener('message', e => {
           const msg = e.data;
           if(msg.type === 'config') {
             proxies = msg.proxy || [];
             mocks = msg.mock || [];
             globalMockDir = msg.mockDir || '';
             const dirDisplay = document.getElementById('mockDirDisplay');
             const dirBtn = document.getElementById('mockDirBtn');
             if(globalMockDir) {
                 dirDisplay.innerText = globalMockDir;
                 dirBtn.classList.remove('empty');
             } else {
                 dirDisplay.innerText = '未设置全局路径';
                 dirBtn.classList.add('empty');
             }
             render();
           }
           if(msg.type === 'status') {
             runningProxies = msg.runningProxies || [];
             isGlobalRunning = runningProxies.length > 0;
             const btn = document.getElementById('globalServerBtn');
             const txt = document.getElementById('globalStatusText');
             if(isGlobalRunning) {
               btn.className = 'server-status on';
               txt.innerText = \`运行中 (\${runningProxies.length})\`;
             } else {
               btn.className = 'server-status';
               txt.innerText = '已停止';
             }
             render();
           }
        });
        
        vscode.postMessage({ type: 'refresh' });

        document.getElementById('globalServerBtn').onclick = () => {
            vscode.postMessage({ type: 'toggleServer', value: !isGlobalRunning });
        };
        window.selectGlobalMockDir = () => vscode.postMessage({ type: 'selectGlobalMockDir' });
        window.showCopyIcon = (el) => {
            const icon = el.querySelector('.copy-icon');
            if(!icon) return;
            icon.style.opacity = '1';
            icon.style.pointerEvents = 'auto';
            if (el.copyTimer) clearTimeout(el.copyTimer);
            el.copyTimer = setTimeout(() => {
                icon.style.opacity = '0';
                icon.style.pointerEvents = 'none';
            }, 3000);
        };
        window.copyTargetUrl = (url) => vscode.postMessage({ type: 'copyText', payload: url });
        window.openProxyModal = (id) => vscode.postMessage({ type: 'openProxyPanel', id });
        window.openRuleModal = (proxyId, ruleId) => vscode.postMessage({ type: 'openRulePanel', proxyId, ruleId });
        window.toggleProxy = (id, enabled) => vscode.postMessage({ type: 'toggleProxy', id, enabled });
        window.delProxy = (id) => vscode.postMessage({ type: 'deleteProxy', id });
        window.toggleRule = (ruleId, val) => vscode.postMessage({ type: 'toggleRule', ruleId, enabled: val });
        window.delRule = (ruleId) => vscode.postMessage({ type: 'deleteRule', ruleId });

        function render() {
          const list = document.getElementById('proxyList');
          list.innerHTML = '';
          if(proxies.length === 0) {
            list.innerHTML = \`<div class="empty-tip">
              <i class="fa-solid fa-server fa-2x"></i>
              <div style="margin-top:10px">暂无代理服务</div>
              <div style="font-size:11px; margin-top:5px;">请先添加后配置规则</div>
            </div>\`;
            return;
          }
          proxies.forEach(p => {
            const isProxyRunning = runningProxies.includes(p.id);
            const proxyStatusColor = isProxyRunning ? 'var(--success)' : '#555';
            const groupDiv = document.createElement('div');
            groupDiv.className = 'proxy-container';
            const displayTarget = p.name ? \`[\${p.name}] \${p.target}\` : p.target;

            groupDiv.innerHTML = \`
                <div class="proxy-header">
                    <div class="proxy-info" title="状态: \${isProxyRunning ? '运行中' : '已停止'}">
                        <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                            <i class="fa-solid fa-circle" style="color: \${proxyStatusColor}; font-size: 10px;"></i>
                            <span class="port-badge">:\${p.port}</span> 
                            <i class="fa-solid fa-arrow-right-long" style="opacity:0.5;"></i> 
                        </div>
                        <div class="target-wrapper" onmouseenter="showCopyIcon(this)">
                            <span class="proxy-target" title="点击目标地址复制: \${p.target}">\${displayTarget}</span>
                            <i class="fa-regular fa-copy copy-icon" title="点击复制" onclick="copyTargetUrl('\${p.target}')"></i>
                        </div>
                    </div>
                    <div class="proxy-actions">
                        <label class="switch" title="启停此代理服务">
                          <input type="checkbox" \${p.enabled ? 'checked' : ''} onchange="toggleProxy('\${p.id}', this.checked)">
                          <span class="slider"></span>
                        </label>
                        <button class="icon-btn" onclick="openProxyModal('\${p.id}')" title="编辑代理"><i class="fa-solid fa-gear"></i></button>
                        <button class="icon-btn del" onclick="delProxy('\${p.id}')" title="删除代理"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
                <div class="rule-list" id="rules-\${p.id}"></div>
            \`;
            list.appendChild(groupDiv);
            const rulesContainer = groupDiv.querySelector(\`#rules-\${p.id}\`);
            const pRules = mocks.filter(m => m.proxyId === p.id);
            if (pRules.length > 0) {
                pRules.forEach(item => {
                    const typeLabel = item.isTemplate ? 'Mock' : 'JSON';
                    const targetOverride = item.target ? \` <span style="opacity:0.5;margin:0 4px">|</span> <i class="fa-solid fa-share" title="独立代理: \${item.target}"></i>\` : '';
                    const card = document.createElement('div');
                    card.className = 'rule-card ' + (item.enabled ? 'active' : 'disabled');
                    card.innerHTML = \`
                      <div class="rule-main">
                        <div class="rule-row-1">
                           <span class="tag \${item.method}">\${item.method}</span>
                           <span class="url-text" title="\${item.url}">\${item.url}</span>
                        </div>
                        <div class="rule-row-2">
                           <span style="font-weight:bold; font-size:10px; border: 1px solid var(--border); padding: 1px 4px; border-radius:3px;">\${typeLabel}</span>
                           <span style="font-family:monospace; margin-left:6px;" title="数据文件: \${item.dataPath}">\${item.dataPath ? '<i class="fa-solid fa-file-code"></i>' : ''}</span>
                           \${targetOverride}
                        </div>
                      </div>
                      <div class="actions">
                         <label class="switch" title="\${item.enabled ? '关闭规则' : '开启规则'}">
                           <input type="checkbox" \${item.enabled ? 'checked' : ''} onchange="toggleRule('\${item.id}', this.checked)">
                           <span class="slider"></span>
                         </label>
                         <button class="icon-btn" onclick="openRuleModal('\${p.id}', '\${item.id}')"><i class="fa-solid fa-pen"></i></button>
                         <button class="icon-btn del" onclick="delRule('\${item.id}')"><i class="fa-solid fa-trash"></i></button>
                      </div>
                    \`;
                    rulesContainer.appendChild(card);
                });
            }
            const addBtn = document.createElement('button');
            addBtn.className = 'add-rule-btn';
            addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> 添加拦截规则';
            addBtn.onclick = () => openRuleModal(p.id);
            rulesContainer.appendChild(addBtn);
          });
        }
      </script>
    </body>
    </html>`;
  }

  // ==========================================
  // 🌟 终极网关模式：代理设置面板 HTML
  // ==========================================
  private getProxyPanelHtml() {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            :root {
                --primary: var(--vscode-button-background);
                --primary-hover: var(--vscode-button-hoverBackground);
                --bg: var(--vscode-editor-background);
                --text: var(--vscode-editor-foreground);
                --border: var(--vscode-panel-border);
                --input-bg: var(--vscode-input-background);
                --input-fg: var(--vscode-input-foreground);
                --input-border: var(--vscode-input-border);
                --error: var(--vscode-errorForeground);
                --desc: var(--vscode-descriptionForeground);
            }
            body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--text); padding: 40px; display: flex; justify-content: center;}
            .panel-container { width: 100%; max-width: 700px; background: var(--vscode-sideBar-background); padding: 30px 40px; border-radius: 8px; border: 1px solid var(--border); box-shadow: 0 4px 15px rgba(0,0,0,0.15); }
            h2 { margin-top: 0; border-bottom: 1px solid var(--border); padding-bottom: 15px; margin-bottom: 25px; display: flex; align-items: center; gap: 10px; }
            h3 { font-size: 14px; margin-top: 30px; margin-bottom: 15px; color: var(--primary); border-bottom: 1px dashed var(--border); padding-bottom: 5px; }
            
            .form-row { display: flex; gap: 20px; margin-bottom: 18px; }
            .form-group { display: flex; flex-direction: column; gap: 6px; flex: 1; margin-bottom: 18px; }
            .form-group.checkbox-group { flex-direction: row; align-items: center; cursor: pointer; user-select: none; }
            
            label { font-weight: 600; font-size: 13px; }
            .desc { font-size: 11px; color: var(--desc); line-height: 1.4; }
            
            input[type="text"], input[type="number"], textarea { padding: 10px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 4px; outline: none; font-size: 13px; font-family: inherit; width: 100%; box-sizing: border-box; }
            input:focus, textarea:focus { border-color: var(--vscode-focusBorder); }
            
            .footer { display: flex; justify-content: flex-end; gap: 12px; margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--border); }
            button { padding: 8px 20px; border-radius: 4px; cursor: pointer; font-size: 13px; border: none; font-weight: bold; }
            .btn-sec { background: transparent; border: 1px solid var(--border); color: var(--text); }
            .btn-sec:hover { background: var(--vscode-list-hoverBackground); }
            .btn-pri { background: var(--primary); color: var(--vscode-button-foreground); }
            .btn-pri:hover { background: var(--primary-hover); }
        </style>
    </head>
    <body>
        <div class="panel-container">
            <h2 id="panelTitle"><i class="fa-solid fa-server"></i> 新增代理服务</h2>
            <input type="hidden" id="proxy_id">
            
            <h3>基本设置 (Basic)</h3>
            <div class="form-row">
                <div class="form-group" style="flex: 1.5;">
                    <label>服务别名 (Name)</label>
                    <input type="text" id="proxy_name" placeholder="e.g. 生产环境 / Test Env">
                    <div class="desc">给代理起个名字，方便在列表中识别</div>
                </div>
                <div class="form-group" style="flex: 1;">
                    <label>本地代理端口 (Port) <span style="color:var(--error)">*</span></label>
                    <input type="number" id="proxy_port" placeholder="e.g. 8080">
                </div>
            </div>
            
            <div class="form-group">
                <label>后端接口目标 (Backend Target) <span style="color:var(--error)">*</span></label>
                <input type="text" id="proxy_target" placeholder="e.g. https://devcms.nfnews.com">
                <div class="desc">API 接口将被转发至此真实服务器，完美复刻 Webpack devServer 的 target。</div>
            </div>

            <h3>无侵入网关模式 (Zero-Config Gateway)</h3>
            <div class="form-row" style="background: rgba(0,0,0,0.1); padding: 15px; border-radius: 6px; border: 1px solid var(--border);">
                <div class="form-group">
                    <label>拦截接口前缀 (API Prefix)</label>
                    <input type="text" id="proxy_apiPrefix" placeholder="e.g. /xy, /api">
                    <div class="desc">以此前缀开头的请求走后端 API，多前缀用逗号分隔。</div>
                </div>
                <div class="form-group">
                    <label>本地前端服务 (Local Frontend)</label>
                    <input type="text" id="proxy_frontendTarget" placeholder="e.g. http://localhost:5173">
                    <div class="desc">非接口的网页请求将被转发到你本地的 Vite/Webpack 开发服务器。</div>
                </div>
            </div>

            <h3>高级路由设置 (Advanced)</h3>
            <div class="form-group">
                <label>路径重写 (Path Rewrite JSON)</label>
                <textarea id="proxy_pathRewrite" placeholder='例如把 /api 开头抹除:&#10;{&#10;  "^/api": "/"&#10;}' style="height: 70px; font-family: monospace;"></textarea>
                <div class="desc">支持正则表达式，标准的 JSON 键值对格式。留空则不重写。</div>
            </div>

            <h3>网络与代理特性 (Features)</h3>
            <div class="form-row" style="background: rgba(0,0,0,0.1); padding: 15px; border-radius: 6px; border: 1px solid var(--border);">
                <div class="form-group checkbox-group" title="修改发往目标的 Host 标头，用于突破防盗链和跨域">
                    <input type="checkbox" id="proxy_changeOrigin" checked>
                    <label for="proxy_changeOrigin">伪装跨域来源 (changeOrigin)</label>
                </div>
                <div class="form-group checkbox-group" title="支持 ws:// 协议转发，用于热更新或长链接">
                    <input type="checkbox" id="proxy_ws" checked>
                    <label for="proxy_ws">支持 WebSocket (ws)</label>
                </div>
                <div class="form-group checkbox-group" title="是否校验目标服务器的 HTTPS 证书 (开发环境通常关闭)">
                    <input type="checkbox" id="proxy_secure">
                    <label for="proxy_secure">校验 SSL 证书 (secure)</label>
                </div>
            </div>

            <div class="form-row">
                <div class="form-group" style="max-width: 250px;">
                    <label>代理超时时间 (Timeout ms)</label>
                    <input type="number" id="proxy_timeout" placeholder="默认 30000">
                </div>
            </div>

            <div class="footer">
                <button class="btn-sec" onclick="cancel()">取消</button>
                <button class="btn-pri" onclick="save()"><i class="fa-solid fa-check"></i> 保存代理配置</button>
            </div>
        </div>
        <script>
            const vscode = acquireVsCodeApi();
            
            window.addEventListener('message', e => {
                if (e.data.type === 'init' && e.data.proxy) {
                    const p = e.data.proxy;
                    document.getElementById('proxy_id').value = p.id || '';
                    document.getElementById('proxy_name').value = p.name || '';
                    document.getElementById('proxy_port').value = p.port || '';
                    document.getElementById('proxy_target').value = p.target || '';
                    document.getElementById('proxy_apiPrefix').value = p.apiPrefix || '';
                    document.getElementById('proxy_frontendTarget').value = p.frontendTarget || '';
                    
                    if (p.pathRewrite) {
                        document.getElementById('proxy_pathRewrite').value = JSON.stringify(p.pathRewrite, null, 2);
                    }
                    
                    document.getElementById('proxy_changeOrigin').checked = p.changeOrigin !== false; 
                    document.getElementById('proxy_ws').checked = p.ws !== false; 
                    document.getElementById('proxy_secure').checked = !!p.secure; 
                    document.getElementById('proxy_timeout').value = p.timeout || '';
                    
                    document.getElementById('panelTitle').innerHTML = '<i class="fa-solid fa-server"></i> 编辑代理服务';
                }
            });

            function save() {
                const id = document.getElementById('proxy_id').value;
                const port = parseInt(document.getElementById('proxy_port').value);
                const target = document.getElementById('proxy_target').value;
                
                if(!port || !target) return vscode.postMessage({ type: 'error', message: '端口和后端目标地址为必填项！' });

                let pathRewrite = undefined;
                const prStr = document.getElementById('proxy_pathRewrite').value.trim();
                if (prStr) {
                    try {
                        pathRewrite = JSON.parse(prStr);
                    } catch(e) {
                        return vscode.postMessage({ type: 'error', message: '路径重写必须是合法的 JSON 格式！' });
                    }
                }

                const payload = {
                    id, port, target, pathRewrite,
                    name: document.getElementById('proxy_name').value.trim() || undefined,
                    apiPrefix: document.getElementById('proxy_apiPrefix').value.trim() || undefined,
                    frontendTarget: document.getElementById('proxy_frontendTarget').value.trim() || undefined,
                    changeOrigin: document.getElementById('proxy_changeOrigin').checked,
                    ws: document.getElementById('proxy_ws').checked,
                    secure: document.getElementById('proxy_secure').checked,
                    timeout: parseInt(document.getElementById('proxy_timeout').value) || undefined
                };

                vscode.postMessage({ type: 'saveProxy', payload });
            }
            
            function cancel() { vscode.postMessage({ type: 'cancel' }); }
        </script>
    </body>
    </html>`;
  }

  // ==========================================
  // 🌟 独立规则面板 HTML (不变)
  // ==========================================
  private getRulePanelHtml() {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
        :root {
          --primary: var(--vscode-button-background);
          --primary-hover: var(--vscode-button-hoverBackground);
          --bg: var(--vscode-editor-background);
          --text: var(--vscode-editor-foreground);
          --border: var(--vscode-panel-border);
          --input-bg: var(--vscode-input-background);
          --input-fg: var(--vscode-input-foreground);
          --input-border: var(--vscode-input-border);
          --error: var(--vscode-errorForeground);
          --success: #4caf50;
        }
        body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--text); padding: 40px; display: flex; justify-content: center; }
        .panel-container { width: 100%; max-width: 900px; background: var(--vscode-sideBar-background); padding: 30px; border-radius: 8px; border: 1px solid var(--border); box-shadow: 0 4px 15px rgba(0,0,0,0.3); }
        h2 { margin-top: 0; border-bottom: 1px solid var(--border); padding-bottom: 15px; margin-bottom: 20px; }
        .form-group { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
        .form-row { display: flex; gap: 20px; }
        .form-row .form-group { flex: 1; }
        label { font-weight: 600; font-size: 13px; }
        input, select, textarea { padding: 10px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 4px; outline: none; font-size: 13px; width: 100%; box-sizing: border-box; }
        input:focus, select:focus, textarea:focus { border-color: var(--vscode-focusBorder); }
        .tabs { display: flex; border-bottom: 1px solid var(--border); margin-top: 10px; }
        .tab { padding: 10px 20px; cursor: pointer; font-size: 13px; border-bottom: 2px solid transparent; opacity: 0.6; display: flex; align-items: center; gap: 8px; }
        .tab.active { opacity: 1; border-bottom-color: var(--vscode-textLink-activeForeground); color: var(--vscode-textLink-activeForeground); font-weight: bold; }
        .tab-content { border: 1px solid var(--border); border-top: none; padding: 20px; background: rgba(0,0,0,0.1); border-radius: 0 0 6px 6px; }
        .tab-pane { display: none; }
        .tab-pane.active { display: block; }
        .mock-builder-container { background: rgba(0,0,0,0.2); padding: 15px; border-radius: 6px; border: 1px solid var(--border); margin-bottom: 15px; }
        .mock-builder-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .mock-row-container { border-left: 2px solid var(--border); padding-left: 12px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px dashed rgba(150,150,150,0.2); }
        #previewArea { margin-top: 20px; }
        #previewBox { background: rgba(0,0,0,0.3); padding: 15px; border-radius: 6px; font-family: monospace; font-size: 13px; white-space: pre-wrap; max-height: 250px; overflow: auto; border: 1px solid var(--border); }
        .footer { display: flex; justify-content: flex-end; gap: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid var(--border); }
        button { padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 13px; border: none; font-weight: bold;}
        .btn-sec { background: transparent; border: 1px solid var(--border); color: var(--text); }
        .btn-sec:hover { background: var(--vscode-list-hoverBackground); }
        .btn-pri { background: var(--primary); color: var(--vscode-button-foreground); }
        .btn-pri:hover { background: var(--primary-hover); }
      </style>
    </head>
    <body>
      <div class="panel-container">
        <h2 id="panelTitle"><i class="fa-solid fa-filter"></i> 配置拦截规则</h2>
        <input type="hidden" id="rule_id">
        <input type="hidden" id="rule_proxyId">
        <div class="form-row">
            <div class="form-group" style="flex: 0 0 120px;">
                <label>Method <span style="color:var(--error)">*</span></label>
                <select id="rule_method">
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="DELETE">DELETE</option>
                    <option value="PATCH">PATCH</option>
                </select>
            </div>
            <div class="form-group">
                <label>API Path <span style="color:var(--error)">*</span></label>
                <input type="text" id="rule_url" placeholder="e.g. /xy/app/theme/list">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group" style="flex: 2">
                <label>Content-Type</label>
                <select id="rule_contentType">
                    <option value="application/json">application/json</option>
                    <option value="text/plain">text/plain</option>
                    <option value="text/html">text/html</option>
                </select>
            </div>
            <div class="form-group" style="flex: 3">
                <label>独立 Target <span style="color:var(--error)">*</span></label>
                <input type="text" id="rule_target" list="targetOptions" placeholder="输入需转发的目标地址">
                <datalist id="targetOptions"></datalist>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Mock 数据存放路径 (基于根目录) <span style="color:var(--error)">*</span></label>
                <div style="display:flex; gap:10px;">
                    <input type="text" id="rule_dataPath" placeholder="请选择或输入存放路径">
                    <button onclick="selectRuleMockDir()" class="btn-sec" style="white-space:nowrap;"><i class="fa-regular fa-folder-open"></i> 浏览</button>
                </div>
            </div>
        </div>
        <label style="margin-top:10px; display:block; font-weight:600;">Response Body (响应数据)</label>
        <div class="tabs">
            <div id="tab-mock" class="tab active" onclick="switchTab('mock')"><i class="fa-solid fa-wand-magic-sparkles"></i> Mock 模板构建</div>
            <div id="tab-custom" class="tab" onclick="switchTab('custom')"><i class="fa-solid fa-code"></i> 静态 JSON</div>
        </div>
        <div class="tab-content">
            <div id="pane-mock" class="tab-pane active">
                <div class="mock-builder-container">
                    <div class="mock-builder-header">
                        <span style="font-weight:bold;"><i class="fa-solid fa-list-ul"></i> 快捷字段生成器</span>
                        <div style="display:flex; gap: 8px;">
                            <button onclick="applyMockFields()" class="btn-pri" style="padding: 4px 10px;"><i class="fa-solid fa-bolt"></i> 生成全量 JSON</button>
                            <button onclick="addMockRow()" class="btn-sec" style="padding: 4px 10px;"><i class="fa-solid fa-plus"></i> 新增空行</button>
                        </div>
                    </div>
                    <div id="mock-builder-rows" style="max-height: 300px; overflow-y: auto; padding-right: 5px;"></div>
                </div>
                <textarea id="mockTemplate" style="height: 150px;" placeholder='{ "code": 200, "data": {} }'></textarea>
            </div>
            <div id="pane-custom" class="tab-pane">
                <textarea id="customJson" style="height: 250px;" placeholder='[ { "id": 1, "name": "Item 1" } ]'></textarea>
            </div>
        </div>
        <div id="previewArea">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <label>Mock 预览结果</label>
                <button onclick="simulate()" class="btn-sec" style="padding: 4px 10px;"><i class="fa-solid fa-play"></i> 刷新</button>
            </div>
            <div id="previewBox"></div>
        </div>
        <div class="footer">
            <button class="btn-sec" onclick="cancel()">取消</button>
            <button class="btn-pri" onclick="save()"><i class="fa-solid fa-check"></i> 保存拦截规则</button>
        </div>
      </div>
      <script>
        const vscode = acquireVsCodeApi();
        let currentProxyId = '';
        window.addEventListener('message', e => {
            const msg = e.data;
            if (msg.type === 'init') {
                currentProxyId = msg.proxyId;
                const rule = msg.rule;
                document.getElementById('rule_id').value = rule ? rule.id : '';
                document.getElementById('rule_method').value = rule ? rule.method : 'GET';
                document.getElementById('rule_url').value = rule ? rule.url : '';
                document.getElementById('rule_contentType').value = rule?.contentType || 'application/json';
                document.getElementById('rule_target').value = rule?.target || '';
                
                let pPath = rule?.dataPath || '';
                if(!pPath && msg.globalMockDir) {
                   pPath = msg.globalMockDir.endsWith('/') ? msg.globalMockDir : msg.globalMockDir + '/';
                }
                document.getElementById('rule_dataPath').value = pPath;
                document.getElementById('panelTitle').innerHTML = rule ? '<i class="fa-solid fa-filter"></i> 编辑拦截规则' : '<i class="fa-solid fa-filter"></i> 新增拦截规则';

                const datalist = document.getElementById('targetOptions');
                datalist.innerHTML = '';
                const targetSet = new Set();
                (msg.proxies || []).forEach(p => { if (p.target) targetSet.add(p.target) });
                (msg.mocks || []).forEach(m => { if (m.target) targetSet.add(m.target) });
                targetSet.forEach(t => { const opt = document.createElement('option'); opt.value = t; datalist.appendChild(opt); });

                if (rule && !rule.isTemplate && rule.data) {
                    const valStr = typeof rule.data === 'string' ? rule.data : JSON.stringify(rule.data, null, 2);
                    document.getElementById('customJson').value = valStr;
                    document.getElementById('mockTemplate').value = '{ "code": 200, "data": {} }'; 
                    switchTab('custom');
                    document.getElementById('mock-builder-rows').innerHTML = '';
                    addMockRow();
                } else {
                    const tpl = rule?.template || { "code": 200, "data": {} };
                    const valStr = typeof tpl === 'string' ? tpl : JSON.stringify(tpl, null, 2);
                    document.getElementById('mockTemplate').value = valStr;
                    document.getElementById('customJson').value = '[]';
                    switchTab('mock');
                    parseJsonToRows(valStr);
                    simulate(); 
                }
            } else if (msg.type === 'ruleDirSelected') {
                let p = msg.path;
                if (!p.endsWith('/')) p += '/';
                document.getElementById('rule_dataPath').value = p;
            } else if (msg.type === 'simulateResult') {
                const box = document.getElementById('previewBox');
                box.innerText = msg.error ? 'Error: ' + msg.error : JSON.stringify(msg.result, null, 2);
                box.style.color = msg.error ? 'var(--error)' : 'var(--text)';
            }
        });
        window.selectRuleMockDir = () => vscode.postMessage({ type: 'selectRuleMockDir' });
        window.cancel = () => vscode.postMessage({ type: 'cancel' });
        window.save = () => {
           const id = document.getElementById('rule_id').value;
           const method = document.getElementById('rule_method').value;
           const url = document.getElementById('rule_url').value;
           const contentType = document.getElementById('rule_contentType').value;
           const target = document.getElementById('rule_target').value;
           const dataPath = document.getElementById('rule_dataPath').value;
           
           if(!url || url.trim() === '') return vscode.postMessage({ type: 'error', message: '保存失败：API Path 不能为空！' });
           if (!target || target.trim() === '') return vscode.postMessage({ type: 'error', message: '保存失败：独立 Target 不能为空！' });
           if (!dataPath || dataPath.trim() === '') return vscode.postMessage({ type: 'error', message: '保存失败：Mock数据存放路径 不能为空！' });

           const isMockMode = document.getElementById('tab-mock').classList.contains('active');
           let template = undefined;
           let staticData = undefined;

           try {
               if (isMockMode) {
                   const raw = document.getElementById('mockTemplate').value;
                   template = raw ? JSON.parse(raw) : {};
               } else {
                   const raw = document.getElementById('customJson').value;
                   staticData = raw ? JSON.parse(raw) : {};
               }
               const payload = { id: id || null, proxyId: currentProxyId, method, url, contentType, target, enabled: true, template: template, data: staticData, dataPath: dataPath };
               vscode.postMessage({ type: 'saveRule', payload });
           } catch(e) {
               vscode.postMessage({ type: 'error', message: 'JSON 格式错误: ' + e.message });
           }
        };
        window.simulate = () => {
           const raw = document.getElementById('mockTemplate').value;
           vscode.postMessage({ type: 'simulate', template: raw });
        };
        window.switchTab = (mode) => {
            document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
            document.getElementById('tab-' + mode).classList.add('active');
            document.getElementById('pane-' + mode).classList.add('active');
            document.getElementById('previewArea').style.display = mode === 'mock' ? 'block' : 'none';
        };
        window.handleTypeChange = (select) => {
            const container = select.closest('.mock-row-container');
            const val = select.value;
            const hasChildren = val === 'ARRAY' || val === 'OBJECT';
            container.querySelector('.mb-count').style.display = val === 'ARRAY' ? 'inline-block' : 'none';
            container.querySelector('.mb-add-child').style.display = hasChildren ? 'inline-block' : 'none';
            const childrenDiv = container.querySelector('.mock-builder-children');
            childrenDiv.style.display = hasChildren ? 'block' : 'none';
            if (hasChildren && childrenDiv.children.length === 0) addChildRowToContainer(childrenDiv);
        };
        window.addMockRow = (initField = '', initType = '@cname', initCount = 5, children = null) => {
            const container = document.getElementById('mock-builder-rows');
            const rowWrapper = document.createElement('div');
            rowWrapper.className = 'mock-row-container';
            const isArray = initType === 'ARRAY';
            const isObject = initType === 'OBJECT';
            const hasChildren = isArray || isObject;
            const extraOpt = !['@cname', '@title', '@integer(1, 100)', '@boolean', '@date', "@image('200x100')", 'ARRAY', 'OBJECT'].includes(initType);
            rowWrapper.innerHTML = \`
                <div style="display: flex; gap: 8px; align-items: center;">
                    <input type="text" class="mb-field" placeholder="字段名(如 data)" value="\${initField}" style="width:120px;">
                    <select class="mb-type" style="width:150px;" onchange="handleTypeChange(this)">
                        <option value="@cname" \${initType === '@cname' ? 'selected' : ''}>中文名 (@cname)</option>
                        <option value="@title" \${initType === '@title' ? 'selected' : ''}>标题 (@title)</option>
                        <option value="@integer(1, 100)" \${initType === '@integer(1, 100)' ? 'selected' : ''}>数字 (@integer)</option>
                        <option value="@boolean" \${initType === '@boolean' ? 'selected' : ''}>布尔值 (@boolean)</option>
                        <option value="@date" \${initType === '@date' ? 'selected' : ''}>日期 (@date)</option>
                        <option value="@image('200x100')" \${initType === "@image('200x100')" ? 'selected' : ''}>图片 (@image)</option>
                        <option value="ARRAY" \${isArray ? 'selected' : ''}>【生成数组列表】</option>
                        <option value="OBJECT" \${isObject ? 'selected' : ''}>【生成嵌套对象】</option>
                        \${extraOpt ? \`<option value='\${initType}' selected hidden>\${initType}</option>\` : ''}
                    </select>
                    <input type="number" class="mb-count" placeholder="条数" style="width:70px; display:\${isArray ? 'inline-block' : 'none'};" min="1" value="\${initCount}">
                    <button class="mb-add-child btn-sec" style="display:\${hasChildren ? 'inline-block' : 'none'}; padding: 6px 10px;" onclick="addChildRow(this)">添加单项字段</button>
                    <button onclick="insertSingleField(this)" class="btn-sec" style="padding: 6px 10px; color:var(--vscode-textLink-activeForeground); border-color:var(--vscode-textLink-activeForeground);">写入 JSON</button>
                    <i class="fa-solid fa-trash" style="cursor:pointer; opacity:0.6; font-size:16px; margin-left: 8px; color: var(--error);" onclick="this.closest('.mock-row-container').remove()"></i>
                </div>
                <div class="mock-builder-children" style="margin-left: 20px; display: \${hasChildren ? 'block' : 'none'}; padding-top: 8px;"></div>
            \`;
            container.appendChild(rowWrapper);
            if (children && children.length > 0) {
                const childContainer = rowWrapper.querySelector('.mock-builder-children');
                children.forEach(c => addChildRowToContainer(childContainer, c.field, c.type));
            }
        };
        window.addChildRowToContainer = (container, field = '', type = '@cname') => {
            const row = document.createElement('div');
            row.className = 'child-row';
            row.style.cssText = 'display: flex; gap: 8px; margin-bottom: 8px; align-items: center;';
            const extraOpt = !['@id', '@cname', '@title', '@integer(1, 100)', '@boolean', '@date', "@image('200x100')"].includes(type);
            row.innerHTML = \`
                <i class="fa-solid fa-turn-up" style="transform: rotate(90deg); opacity:0.4; font-size:12px;"></i>
                <input type="text" class="mb-child-field" placeholder="子字段名" value="\${field}" style="width:110px;">
                <select class="mb-child-type" style="width:130px;">
                    <option value="@id" \${type === '@id' ? 'selected' : ''}>自增ID (@id)</option>
                    <option value="@cname" \${type === '@cname' ? 'selected' : ''}>中文名 (@cname)</option>
                    <option value="@title" \${type === '@title' ? 'selected' : ''}>标题 (@title)</option>
                    <option value="@integer(1, 100)" \${type === '@integer(1, 100)' ? 'selected' : ''}>数字 (@integer)</option>
                    <option value="@boolean" \${type === '@boolean' ? 'selected' : ''}>布尔值 (@boolean)</option>
                    <option value="@date" \${type === '@date' ? 'selected' : ''}>日期 (@date)</option>
                    <option value="@image('200x100')" \${type === "@image('200x100')" ? 'selected' : ''}>图片 (@image)</option>
                    \${extraOpt ? \`<option value='\${type}' selected hidden>\${type}</option>\` : ''}
                </select>
                <i class="fa-solid fa-xmark" style="cursor:pointer; opacity:0.6; font-size:16px; margin-left: 8px; color: var(--error);" onclick="this.parentElement.remove()"></i>
            \`;
            container.appendChild(row);
        };
        window.addChildRow = (btn) => { addChildRowToContainer(btn.closest('.mock-row-container').querySelector('.mock-builder-children')); };
        window.parseJsonToRows = (jsonStr) => {
            const container = document.getElementById('mock-builder-rows');
            container.innerHTML = ''; 
            try {
                const jsonObj = JSON.parse(jsonStr);
                const dataObj = jsonObj.data;
                if (dataObj && typeof dataObj === 'object') {
                    let hasFields = false;
                    Object.keys(dataObj).forEach(key => {
                        hasFields = true;
                        const value = dataObj[key];
                        const arrMatch = key.match(/^(.+)\\|(\\d+)$/); 
                        if (arrMatch && Array.isArray(value) && value.length > 0) {
                            let childrenList = [];
                            if (value[0] && typeof value[0] === 'object') {
                                Object.keys(value[0]).forEach(cKey => { childrenList.push({ field: cKey.replace('|+1', ''), type: cKey.endsWith('|+1') ? '@id' : value[0][cKey] }); });
                            }
                            addMockRow(arrMatch[1], 'ARRAY', parseInt(arrMatch[2]), childrenList);
                        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                            let childrenList = [];
                            Object.keys(value).forEach(cKey => { childrenList.push({ field: cKey.replace('|+1', ''), type: cKey.endsWith('|+1') ? '@id' : value[cKey] }); });
                            addMockRow(key, 'OBJECT', 5, childrenList);
                        } else { addMockRow(key, typeof value === 'string' ? value : JSON.stringify(value)); }
                    });
                    if (!hasFields) addMockRow();
                } else addMockRow();
            } catch(e) { addMockRow(); }
        };
        function getContainerValue(container) {
            const type = container.querySelector('.mb-type').value;
            if (type === 'ARRAY' || type === 'OBJECT') {
                let itemTemplate = {};
                const childRows = container.querySelectorAll('.child-row');
                if (childRows.length > 0) {
                    childRows.forEach(cr => {
                        const cField = cr.querySelector('.mb-child-field').value.trim();
                        if (cField) { const cType = cr.querySelector('.mb-child-type').value; itemTemplate[cType === '@id' ? cField + '|+1' : cField] = cType; }
                    });
                } else itemTemplate = { "id|+1": 1, "name": "@cname" }; 
                if (type === 'ARRAY') {
                    const count = container.querySelector('.mb-count').value || 5;
                    return { isComplex: true, isArray: true, count, value: [itemTemplate] };
                } else return { isComplex: true, isArray: false, value: itemTemplate };
            } else return { isComplex: false, value: type };
        }
        window.insertSingleField = (btn) => {
            const container = btn.closest('.mock-row-container');
            const field = container.querySelector('.mb-field').value.trim();
            if (!field) return vscode.postMessage({ type: 'error', message: '请填写主字段名！' });
            const tplArea = document.getElementById('mockTemplate');
            let currentJson;
            try { currentJson = JSON.parse(tplArea.value || '{}'); } catch(e) { return; }
            if (!currentJson.data) currentJson.data = {};
            const data = getContainerValue(container);
            if (data.isComplex && data.isArray) currentJson.data[\`\${field}|\${data.count}\`] = data.value;
            else currentJson.data[field] = data.value;
            tplArea.value = JSON.stringify(currentJson, null, 2);
            simulate();
            const originalText = btn.innerText;
            btn.innerText = '成功';
            setTimeout(() => { btn.innerText = originalText; }, 1000);
        };
        window.applyMockFields = () => {
            const tplArea = document.getElementById('mockTemplate');
            let currentJson;
            try { currentJson = JSON.parse(tplArea.value || '{}'); } catch(e) { return; }
            currentJson.data = {};
            let hasAdded = false;
            document.querySelectorAll('.mock-row-container').forEach(container => {
                const field = container.querySelector('.mb-field').value.trim();
                if (!field) return; 
                hasAdded = true;
                const data = getContainerValue(container);
                if (data.isComplex && data.isArray) currentJson.data[\`\${field}|\${data.count}\`] = data.value;
                else currentJson.data[field] = data.value;
            });
            if (!hasAdded) return vscode.postMessage({ type: 'error', message: '请至少填写一个字段名后再生成！' });
            tplArea.value = JSON.stringify(currentJson, null, 2);
            simulate();
        };
      </script>
    </body>
    </html>`;
  }
}
