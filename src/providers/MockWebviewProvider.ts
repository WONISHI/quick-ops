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
  ) { }

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
    if (path.isAbsolute(dataPath)) return dataPath;
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

    const fullMockList = mockList.map(rule => {
      const fullRule = { ...rule };
      // 🌟 根据 mode 字段判断是否需要读取 JSON 文件内容
      if (rule.dataPath && rule.mode !== 'file') { 
        const absPath = this.getMockDataPath(rule.dataPath);
        if (absPath && fs.existsSync(absPath)) {
          try {
            const parsedContent = JSON.parse(fs.readFileSync(absPath, 'utf8'));
            if (rule.mode === 'custom') fullRule.data = parsedContent;
            else fullRule.template = parsedContent; // 默认为 mock 模板
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
        const rootPath = this.getWorkspaceRoot();
        const uri = await vscode.window.showOpenDialog({
          canSelectFiles: false, canSelectFolders: true, canSelectMany: false, defaultUri: rootPath ? vscode.Uri.file(rootPath) : undefined, openLabel: '选择全局 Mock 数据存放目录'
        });
        if (uri && uri[0]) {
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
        const rootPath = this.getWorkspaceRoot();
        const uri = await vscode.window.showOpenDialog({
          canSelectFiles: true, canSelectFolders: false, canSelectMany: false, defaultUri: rootPath ? vscode.Uri.file(rootPath) : undefined, openLabel: '选择要返回的文件'
        });
        if (uri && uri[0]) {
          let savePath = uri[0].fsPath;
          if (rootPath && savePath.startsWith(rootPath)) {
            savePath = path.relative(rootPath, savePath);
          }
          this.rulePanel?.webview.postMessage({ type: 'fileReturnPathSelected', path: savePath.replace(/\\/g, '/') });
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
      this.proxyPanel.webview.html = this.getProxyPanelHtml();

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
      this.rulePanel.webview.html = this.getRulePanelHtml();

      this.rulePanel.webview.onDidReceiveMessage(async (data) => {
        if (data.type === 'error') vscode.window.showErrorMessage(data.message);
        else if (data.type === 'cancel') this.rulePanel?.dispose();
        else if (data.type === 'simulate') {
          try {
            const result = Mock.mock(typeof data.template === 'string' ? JSON.parse(data.template) : data.template);
            this.rulePanel?.webview.postMessage({ type: 'simulateResult', result });
          } catch (e: any) {
            this.rulePanel?.webview.postMessage({ type: 'simulateResult', error: e.message });
          }
        } else if (data.type === 'selectRuleMockDir') {
           const rootPath = this.getWorkspaceRoot();
           const uri = await vscode.window.showOpenDialog({
             canSelectFiles: false, canSelectFolders: true, canSelectMany: false, defaultUri: rootPath ? vscode.Uri.file(rootPath) : undefined, openLabel: '选择此规则的数据存放目录'
           });
           if (uri && uri[0]) {
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

          // 🌟 统一判断：只有 mock 和 custom 模式才生成 JSON 文件数据
          if (newRuleData.mode === 'mock') {
            fs.writeFileSync(absPath, JSON.stringify(newRuleData.template || {}, null, 2), 'utf8');
          } else if (newRuleData.mode === 'custom') {
            fs.writeFileSync(absPath, JSON.stringify(newRuleData.data || {}, null, 2), 'utf8');
          } else if (newRuleData.mode === 'file') {
            fs.writeFileSync(absPath, JSON.stringify({ type: "file_mock", file: newRuleData.filePath, disposition: newRuleData.fileDisposition }, null, 2), 'utf8');
          }

          // 🌟 统一配置保存，使用 mode 字段代替之前的 isFile / isTemplate
          const ruleToSaveConfig: any = {
            id: newRuleData.id, 
            proxyId: newRuleData.proxyId, 
            method: newRuleData.method, 
            url: newRuleData.url,
            contentType: newRuleData.contentType, 
            enabled: newRuleData.enabled, 
            dataPath: ruleDataPath,
            mode: newRuleData.mode // 👈 核心字段：记录是 'mock' | 'custom' | 'file'
          };
          
          // 如果是文件模式，把文件路径存到配置中方便读取
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

  public getHtmlForWebview(webview: vscode.Webview) {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
        :root { --primary: var(--vscode-textLink-activeForeground); --border: var(--vscode-panel-border); --bg: var(--vscode-editor-background); --bg-hover: var(--vscode-list-hoverBackground); --text: var(--vscode-editor-foreground); --text-sub: var(--vscode-descriptionForeground); --error: var(--vscode-errorForeground); --success: #4caf50; }
        html { min-width: 298px }
        body { font-family: var(--vscode-font-family); padding: 0; margin: 0; color: var(--text); background: var(--bg); display: flex; flex-direction: column; height: 100vh; font-size: 13px; }
        .header { padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--vscode-sideBar-background); display: flex; flex-direction: column; gap: 10px; }
        .header-top { display: flex; justify-content: space-between; align-items: center; }
        .header-title { font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 8px; }
        .server-status { font-size: 12px; padding: 4px 10px; border-radius: 20px; background: #444; color: #ccc; cursor: pointer; user-select: none; display: flex; align-items: center; gap: 6px; }
        .server-status.on { background: rgba(76, 175, 80, 0.15); color: var(--success); }
        .mock-dir-setting { font-size: 11px; padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border); cursor: pointer; display: flex; align-items: center; gap: 6px; }
        .content { flex: 1; overflow-y: auto; padding: 16px 12px; }
        .proxy-container { border: 1px solid var(--border); border-radius: 8px; margin-bottom: 20px; background: var(--bg); overflow: hidden; }
        .proxy-header { background: var(--vscode-sideBar-background); padding: 12px 14px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
        .port-badge { background: var(--primary); color: white; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold;}
        .rule-list { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
        .rule-card { border: 1px solid var(--border); border-radius: 6px; padding: 10px; display: flex; align-items: center; gap: 12px; position: relative; }
        .rule-card.disabled { opacity: 0.6; filter: grayscale(0.8); }
        .rule-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
        
        .url-container { display: flex; align-items: center; gap: 6px; width: 100%; }
        .url-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .copy-icon { opacity: 0; cursor: pointer; color: var(--primary); transition: opacity 0.2s; font-size: 12px; }
        .url-container:hover .copy-icon { opacity: 1; }
        
        .data-path { font-size: 11px; color: var(--text-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 50px; }

        .tag { font-size: 10px; font-weight: bold; padding: 2px 6px; border-radius: 3px; flex-shrink: 0; }
        .tag.GET { background: rgba(52, 152, 219, 0.1); color: #3498db; }
        .tag.POST { background: rgba(46, 204, 113, 0.1); color: #2ecc71; }
        .tag.PUT { background: rgba(243, 156, 18, 0.1); color: #f39c12; }
        .tag.DELETE { background: rgba(231, 76, 60, 0.1); color: #e74c3c; }

        .icon-btn { background: transparent; border: none; color: var(--text-sub); cursor: pointer; padding: 4px 6px; }
        .switch { position: relative; display: inline-block; width: 32px; height: 18px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #555; transition: .3s; border-radius: 18px; }
        .slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 2px; bottom: 2px; background-color: white; transition: .3s; border-radius: 50%; }
        input:checked + .slider { background-color: var(--success); }
        input:checked + .slider:before { transform: translateX(14px); }
        .add-rule-btn { width: 100%; padding: 8px; border: 1px dashed var(--border); background: transparent; color: var(--text-sub); border-radius: 4px; cursor: pointer; text-align: center; }
        .footer { padding: 12px; border-top: 1px solid var(--border); background: var(--vscode-sideBar-background); }
        .btn-pri { background: var(--primary); color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; width: 100%; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="header-top">
            <div class="header-title"><i class="fa-solid fa-server"></i> Mock 服务管理</div>
            <div id="globalServerBtn" class="server-status"><i class="fa-solid fa-circle"></i> <span id="globalStatusText">已停止</span></div>
        </div>
        <div id="mockDirBtn" class="mock-dir-setting" onclick="selectGlobalMockDir()">
           <i class="fa-regular fa-folder-open"></i> <span id="mockDirDisplay">加载中...</span>
        </div>
      </div>
      <div class="content" id="proxyList"></div>
      <div class="footer"><button onclick="openProxyModal()" class="btn-pri"><i class="fa-solid fa-plus"></i> 添加 Mock 服务</button></div>

      <script>
        const vscode = acquireVsCodeApi();
        let proxies = []; let mocks = []; let runningProxies = []; let isGlobalRunning = false; let globalMockDir = ''; 

        window.addEventListener('message', e => {
           if(e.data.type === 'config') {
             proxies = e.data.proxy || []; mocks = e.data.mock || []; globalMockDir = e.data.mockDir || '';
             document.getElementById('mockDirDisplay').innerText = globalMockDir || '未设置全局路径';
             render();
           }
           if(e.data.type === 'status') {
             runningProxies = e.data.runningProxies || [];
             isGlobalRunning = runningProxies.length > 0;
             document.getElementById('globalServerBtn').className = isGlobalRunning ? 'server-status on' : 'server-status';
             document.getElementById('globalStatusText').innerText = isGlobalRunning ? \`运行中 (\${runningProxies.length})\` : '已停止';
             render();
           }
        });
        vscode.postMessage({ type: 'refresh' });

        document.getElementById('globalServerBtn').onclick = () => vscode.postMessage({ type: 'toggleServer', value: !isGlobalRunning });
        window.selectGlobalMockDir = () => vscode.postMessage({ type: 'selectGlobalMockDir' });
        window.openProxyModal = (id) => vscode.postMessage({ type: 'openProxyPanel', id });
        window.openRuleModal = (proxyId, ruleId) => vscode.postMessage({ type: 'openRulePanel', proxyId, ruleId });
        window.toggleProxy = (id, enabled) => vscode.postMessage({ type: 'toggleProxy', id, enabled });
        window.delProxy = (id) => vscode.postMessage({ type: 'deleteProxy', id });
        window.toggleRule = (ruleId, val) => vscode.postMessage({ type: 'toggleRule', ruleId, enabled: val });
        window.delRule = (ruleId) => vscode.postMessage({ type: 'deleteRule', ruleId });

        window.copyMockUrl = (url, iconEl) => {
            vscode.postMessage({ type: 'copyText', payload: url });
            const feedbackEl = iconEl.nextElementSibling;
            iconEl.style.display = 'none';
            feedbackEl.style.display = 'inline-block';
            
            setTimeout(() => {
                feedbackEl.style.display = 'none';
                iconEl.style.display = 'inline-block';
            }, 3000);
        };

        function render() {
          const list = document.getElementById('proxyList');
          list.innerHTML = '';
          proxies.forEach(p => {
            const isProxyRunning = runningProxies.includes(p.id);
            const groupDiv = document.createElement('div');
            groupDiv.className = 'proxy-container';
            groupDiv.innerHTML = \`
                <div class="proxy-header">
                    <div>
                        <i class="fa-solid fa-circle" style="color: \${isProxyRunning ? 'var(--success)' : '#555'}; font-size: 10px;"></i>
                        <span class="port-badge">端口: \${p.port}</span> 
                    </div>
                    <div style="display:flex; gap:10px;">
                        <label class="switch"><input type="checkbox" \${p.enabled ? 'checked' : ''} onchange="toggleProxy('\${p.id}', this.checked)"><span class="slider"></span></label>
                        <button class="icon-btn" onclick="openProxyModal('\${p.id}')"><i class="fa-solid fa-gear"></i></button>
                        <button class="icon-btn del" onclick="delProxy('\${p.id}')"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
                <div class="rule-list" id="rules-\${p.id}"></div>
            \`;
            list.appendChild(groupDiv);

            const rulesContainer = groupDiv.querySelector(\`#rules-\${p.id}\`);
            mocks.filter(m => m.proxyId === p.id).forEach(item => {
                const card = document.createElement('div');
                card.className = 'rule-card ' + (item.enabled ? 'active' : 'disabled');
                
                // 🌟 利用 mode 字段来判断是否为文件
                const isFile = item.mode === 'file';
                const fileTag = isFile ? '<span class="tag" style="background:#8e44ad; color:#fff; margin-left:4px;">FILE</span>' : '';
                
                card.innerHTML = \`
                    <div class="rule-main">
                        <div class="url-container">
                            <span class="tag \${item.method}">\${item.method}</span> 
                            \${fileTag}
                            <strong class="url-text" title="\${item.url}">\${item.url}</strong>
                            <i class="fa-regular fa-copy copy-icon" title="复制路径" onclick="copyMockUrl('\${item.url}', this)"></i>
                            <span class="copy-feedback" style="display:none; color:var(--success); font-size:11px; flex-shrink:0;">已复制!</span>
                        </div>
                        <div class="data-path" title="\${isFile ? item.filePath : item.dataPath}">
                            <i class="\${isFile ? 'fa-regular fa-file' : 'fa-solid fa-file-code'}"></i> \${isFile ? item.filePath : item.dataPath}
                        </div>
                    </div>
                    <div>
                        <label class="switch"><input type="checkbox" \${item.enabled ? 'checked' : ''} onchange="toggleRule('\${item.id}', this.checked)"><span class="slider"></span></label>
                        <button class="icon-btn" onclick="openRuleModal('\${p.id}', '\${item.id}')"><i class="fa-solid fa-pen"></i></button>
                        <button class="icon-btn del" onclick="delRule('\${item.id}')"><i class="fa-solid fa-trash"></i></button>
                    </div>
                \`;
                rulesContainer.appendChild(card);
            });
            const addBtn = document.createElement('button');
            addBtn.className = 'add-rule-btn';
            addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> 添加接口规则';
            addBtn.onclick = () => openRuleModal(p.id);
            rulesContainer.appendChild(addBtn);
          });
        }
      </script>
    </body>
    </html>`;
  }

  private getProxyPanelHtml() {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <style>
            body { 
                font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px);
                background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); padding: 30px; 
            }
            .panel-container { max-width: 500px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
            h2 { font-weight: 400; font-size: 20px; margin: 0 0 10px 0; color: var(--vscode-editor-foreground); }
            label { display: block; margin-bottom: 6px; color: var(--vscode-descriptionForeground); font-size: 12px; }
            input { 
                width: 100%; box-sizing: border-box; padding: 6px; border-radius: 2px;
                background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); 
            }
            input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; border-color: var(--vscode-focusBorder); }
            
            .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--vscode-panel-border); }
            button { padding: 6px 14px; cursor: pointer; border: 1px solid transparent; border-radius: 2px; font-size: 13px; font-family: var(--vscode-font-family); }
            .btn-pri { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
            .btn-pri:hover { background: var(--vscode-button-hoverBackground); }
            .btn-sec { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
            .btn-sec:hover { background: var(--vscode-button-secondaryHoverBackground); }
        </style>
    </head>
    <body>
        <div class="panel-container">
            <h2 id="panelTitle">新增 Mock 服务</h2>
            <input type="hidden" id="proxy_id">
            <div>
               <label>本地服务监听端口 (Port)</label>
               <input type="number" id="proxy_port" placeholder="例如: 8080">
            </div>
            <div class="actions">
                <button class="btn-sec" onclick="vscode.postMessage({ type: 'cancel' })">取消</button>
                <button class="btn-pri" onclick="save()">保存配置</button>
            </div>
        </div>
        <script>
            const vscode = acquireVsCodeApi();
            window.addEventListener('message', e => {
                if (e.data.type === 'init' && e.data.proxy) {
                    document.getElementById('proxy_id').value = e.data.proxy.id || '';
                    document.getElementById('proxy_port').value = e.data.proxy.port || '';
                    document.getElementById('panelTitle').innerText = '编辑 Mock 服务';
                }
            });
            function save() {
                const port = parseInt(document.getElementById('proxy_port').value);
                if(!port) return vscode.postMessage({ type: 'error', message: '端口为必填项！' });
                vscode.postMessage({ type: 'saveProxy', payload: { id: document.getElementById('proxy_id').value, port } });
            }
        </script>
    </body>
    </html>`;
  }

  // ==========================================
  // 🌟 规则面板 HTML
  // ==========================================
  private getRulePanelHtml() {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
        body { 
            font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px);
            background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); padding: 20px 30px; 
        }
        .panel-container { max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
        h2 { font-weight: 400; font-size: 20px; margin: 0; color: var(--vscode-editor-foreground); }
        
        .form-row { display: flex; gap: 24px; align-items: flex-end; }
        .form-group { flex: 1; display: flex; flex-direction: column; gap: 6px; }
        label { color: var(--vscode-descriptionForeground); font-size: 12px; }
        
        input, select, textarea { 
            width: 100%; box-sizing: border-box; padding: 6px; border-radius: 2px; font-family: var(--vscode-font-family); font-size: 13px;
            background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); 
        }
        select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); }
        input:focus, select:focus, textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; border-color: var(--vscode-focusBorder); }
        
        button { padding: 6px 14px; cursor: pointer; border: 1px solid transparent; border-radius: 2px; font-size: 13px; font-family: var(--vscode-font-family); display: inline-flex; align-items: center; justify-content: center; gap: 6px;}
        .btn-pri { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .btn-pri:hover { background: var(--vscode-button-hoverBackground); }
        .btn-sec { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .btn-sec:hover { background: var(--vscode-button-secondaryHoverBackground); }
        .btn-icon-only { background: transparent; color: var(--vscode-icon-foreground); border: none; padding: 4px; border-radius: 4px; cursor: pointer;}
        .btn-icon-only:hover { background: var(--vscode-toolbar-hoverBackground); }

        .tabs { display: flex; border-bottom: 1px solid var(--vscode-panel-border); margin-top: 10px; gap: 20px; }
        .tab { padding: 8px 0; cursor: pointer; color: var(--vscode-panelTitle-inactiveForeground); text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; border-bottom: 1px solid transparent; margin-bottom: -1px; }
        .tab.active { color: var(--vscode-panelTitle-activeForeground); border-bottom: 1px solid var(--vscode-panelTitle-activeBorder); }
        .tab:hover:not(.active) { color: var(--vscode-panelTitle-activeForeground); }
        .tab-content { padding-top: 16px; }
        .tab-pane { display: none; }
        .tab-pane.active { display: block; }

        .mock-row-container { border-left: 1px solid var(--vscode-tree-indentGuidesStroke); padding-left: 12px; margin-bottom: 8px; padding-bottom: 8px; position: relative;}
        .mock-row-container:hover { border-left-color: var(--vscode-focusBorder); }
        .actions-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 30px; padding-top: 20px; border-top: 1px solid var(--vscode-panel-border); }

        .delete-icon { cursor: pointer; color: var(--vscode-icon-foreground); padding: 4px; opacity: 0.6; }
        .delete-icon:hover { opacity: 1; color: var(--vscode-errorForeground); }
      </style>
    </head>
    <body>
      <div class="panel-container">
        <h2 id="panelTitle">配置拦截规则</h2>
        <input type="hidden" id="rule_id">
        
        <div class="form-row">
            <div class="form-group" style="flex: 0 0 100px;">
                <label>Method</label>
                <select id="rule_method"><option value="GET">GET</option><option value="POST">POST</option><option value="PUT">PUT</option><option value="DELETE">DELETE</option></select>
            </div>
            <div class="form-group">
                <label>API Path</label>
                <input type="text" id="rule_url" placeholder="/api/user/info">
            </div>
            <div class="form-group" style="flex: 0 0 200px;">
                <label>Content-Type</label>
                <select id="rule_contentType">
                    <option value="application/json">application/json</option>
                    <option value="text/plain">text/plain</option>
                    <option value="text/html">text/html</option>
                    <option value="application/xml">application/xml</option>
                    <option value="application/x-www-form-urlencoded">application/x-www-form-urlencoded</option>
                    <option value="multipart/form-data">multipart/form-data</option>
                    <option value="application/octet-stream">application/octet-stream (文件流)</option>
                </select>
            </div>
        </div>
        
        <div class="form-row">
            <div class="form-group">
                <label>规则配置存放路径 (必填)</label>
                <div style="display:flex; gap:6px;">
                    <input type="text" id="rule_dataPath" placeholder="相对于工作区的路径">
                    <button onclick="vscode.postMessage({ type: 'selectRuleMockDir' })" class="btn-sec" title="选择目录">
                        <i class="fa-regular fa-folder-open"></i>
                    </button>
                </div>
            </div>
        </div>

        <div class="tabs">
            <div id="tab-mock" class="tab active" onclick="switchTab('mock')">Mock 模板配置</div>
            <div id="tab-custom" class="tab" onclick="switchTab('custom')">静态 JSON</div>
            <div id="tab-file" class="tab" onclick="switchTab('file')">文件下发</div>
        </div>

        <div class="tab-content">
            <div id="pane-mock" class="tab-pane active">
                <div style="margin-bottom:12px; display:flex; gap:8px;">
                    <button onclick="applyMockFields()" class="btn-pri"><i class="fa-solid fa-wand-magic-sparkles"></i> 生成模板</button>
                    <button onclick="addMockRow()" class="btn-sec"><i class="fa-solid fa-plus"></i> 新增字段</button>
                    <button onclick="resetMockFields()" class="btn-sec" style="margin-left: auto; color: var(--vscode-errorForeground); border-color: var(--vscode-errorForeground);"><i class="fa-solid fa-rotate-right"></i> 重置数据结构</button>
                </div>
                <div id="mock-builder-rows" style="max-height: 250px; overflow-y: auto; padding-right: 10px;"></div>
                <textarea id="mockTemplate" style="height: 180px; margin-top:12px; font-family: var(--vscode-editor-font-family, monospace);"></textarea>
            </div>
            
            <div id="pane-custom" class="tab-pane">
                <textarea id="customJson" style="height: 250px; font-family: var(--vscode-editor-font-family, monospace);"></textarea>
            </div>

            <div id="pane-file" class="tab-pane">
                <div class="form-group" style="margin-bottom: 20px;">
                    <label>选择要作为接口返回的本地文件</label>
                    <div style="display:flex; gap:6px;">
                        <input type="text" id="rule_filePath" placeholder="例如: public/logo.png 或 绝对路径">
                        <button onclick="vscode.postMessage({ type: 'selectFileReturnPath' })" class="btn-sec" title="浏览文件">
                            <i class="fa-regular fa-file"></i>
                        </button>
                    </div>
                </div>
                <div class="form-group">
                    <label>响应方式 (Content-Disposition)</label>
                    <select id="rule_fileDisposition">
                        <option value="inline">浏览器内预览 (Inline)</option>
                        <option value="attachment">作为附件下载 (Attachment)</option>
                    </select>
                </div>
            </div>
        </div>

        <div id="previewArea" style="margin-top:10px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <label>实时预览 (Preview)</label>
                <button onclick="simulate()" class="btn-icon-only" title="刷新预览"><i class="fa-solid fa-arrows-rotate"></i></button>
            </div>
            <div id="previewBox" style="background:var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius:2px; padding:12px; font-family:var(--vscode-editor-font-family, monospace); font-size:12px; max-height:200px; overflow:auto; white-space: pre-wrap;"></div>
        </div>

        <div class="actions-footer">
            <button class="btn-sec" onclick="vscode.postMessage({ type: 'cancel' })">取消</button>
            <button class="btn-pri" onclick="save()">保存规则</button>
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
                document.getElementById('rule_dataPath').value = rule?.dataPath || (msg.globalMockDir ? msg.globalMockDir + '/' : '');

                document.getElementById('rule_filePath').value = rule?.filePath || '';
                document.getElementById('rule_fileDisposition').value = rule?.fileDisposition || 'inline';

                // 🌟 使用新增的 mode 字段直接判断当前应该激活的 Tab
                let currentMode = rule?.mode;
                // 为了兼容旧配置，如果没有 mode，则推断一下
                if (!currentMode) {
                   if (rule?.isFile) currentMode = 'file';
                   else if (rule && !rule.isTemplate && rule.data) currentMode = 'custom';
                   else currentMode = 'mock';
                }

                switchTab(currentMode);
                
                if (currentMode === 'custom') {
                    document.getElementById('customJson').value = typeof rule?.data === 'string' ? rule.data : JSON.stringify(rule?.data || {}, null, 2);
                } else if (currentMode === 'mock') {
                    document.getElementById('mockTemplate').value = typeof rule?.template === 'object' ? JSON.stringify(rule.template, null, 2) : (rule?.template || '{ "code": 200, "data": {} }');
                    parseJsonToRows(document.getElementById('mockTemplate').value); 
                    simulate(); 
                }
            } else if (msg.type === 'ruleDirSelected') {
                document.getElementById('rule_dataPath').value = msg.path.endsWith('/') ? msg.path : msg.path + '/';
            } else if (msg.type === 'fileReturnPathSelected') {
                document.getElementById('rule_filePath').value = msg.path;
            } else if (msg.type === 'simulateResult') {
                document.getElementById('previewBox').innerText = msg.error ? 'Error: ' + msg.error : JSON.stringify(msg.result, null, 2);
            }
        });

        window.save = () => {
           const id = document.getElementById('rule_id').value;
           const url = document.getElementById('rule_url').value;
           const dataPath = document.getElementById('rule_dataPath').value;
           if(!url) return vscode.postMessage({ type: 'error', message: 'API Path 不能为空！' });
           
           // 🌟 获取当前激活的 Tab 作为 mode 保存
           const activeTabId = document.querySelector('.tab.active').id;
           let mode = 'mock';
           if (activeTabId === 'tab-custom') mode = 'custom';
           else if (activeTabId === 'tab-file') mode = 'file';

           let tpl = undefined, data = undefined;
           let filePath = ''; let fileDisposition = 'inline';

           try {
               if (mode === 'mock') {
                   tpl = JSON.parse(document.getElementById('mockTemplate').value || '{}');
               } else if (mode === 'custom') {
                   data = JSON.parse(document.getElementById('customJson').value || '{}');
               } else if (mode === 'file') {
                   filePath = document.getElementById('rule_filePath').value;
                   fileDisposition = document.getElementById('rule_fileDisposition').value;
                   if(!filePath) return vscode.postMessage({ type: 'error', message: '请选择要返回的文件！' });
               }
               
               vscode.postMessage({ type: 'saveRule', payload: {
                   id, proxyId: currentProxyId, method: document.getElementById('rule_method').value,
                   url, contentType: document.getElementById('rule_contentType').value, enabled: true, dataPath, 
                   template: tpl, data, mode, filePath, fileDisposition
               }});
           } catch(e) { vscode.postMessage({ type: 'error', message: 'JSON 格式错误: ' + e.message }); }
        };

        window.simulate = () => vscode.postMessage({ type: 'simulate', template: document.getElementById('mockTemplate').value });
        window.switchTab = (mode) => {
            document.querySelectorAll('.tab, .tab-pane').forEach(el => el.classList.remove('active'));
            document.getElementById('tab-' + mode).classList.add('active');
            document.getElementById('pane-' + mode).classList.add('active');
            document.getElementById('previewArea').style.display = mode === 'file' ? 'none' : 'block';
        };

        window.handleTypeChange = (sel) => {
            const container = sel.closest('.mock-row-container');
            const val = sel.value; const hc = val === 'ARRAY' || val === 'OBJECT';
            container.querySelector('.mb-count').style.display = val === 'ARRAY' ? 'inline-block' : 'none';
            container.querySelector('.mb-add-child').style.display = hc ? 'inline-block' : 'none';
            container.querySelector('.mock-builder-children').style.display = hc ? 'block' : 'none';
        };

        function getMockTypeOptions(selectedType) {
            const isArray = selectedType === 'ARRAY';
            const isObject = selectedType === 'OBJECT';
            
            const knownTypes = [
                'ARRAY', 'OBJECT', '@id', '@guid', '@boolean', '@integer(1, 100)', '@float(0, 100, 2, 2)',
                '@cname', '@ctitle', '@cparagraph', '@name', '@title',
                '@email', '@url', '@ip', '@county(true)', '@city(true)',
                '@datetime', '@date', '@time', "@image('200x100')", '@color'
            ];
            const extraOpt = !knownTypes.includes(selectedType);

            let html = '<optgroup label="🗂️ 结构与基础">' +
                '<option value="ARRAY" ' + (isArray ? 'selected' : '') + '>[ ] 数组列表</option>' +
                '<option value="OBJECT" ' + (isObject ? 'selected' : '') + '>{ } 嵌套对象</option>' +
                '<option value="@id" ' + (selectedType === '@id' ? 'selected' : '') + '>自增 ID (@id)</option>' +
                '<option value="@guid" ' + (selectedType === '@guid' ? 'selected' : '') + '>全局唯一 ID (@guid)</option>' +
                '<option value="@boolean" ' + (selectedType === '@boolean' ? 'selected' : '') + '>布尔值 (@boolean)</option>' +
                '<option value="@integer(1, 100)" ' + (selectedType === '@integer(1, 100)' ? 'selected' : '') + '>整数 1-100 (@integer)</option>' +
                '<option value="@float(0, 100, 2, 2)" ' + (selectedType === '@float(0, 100, 2, 2)' ? 'selected' : '') + '>浮点数 (@float)</option>' +
                '</optgroup>' +
                '<optgroup label="📝 文本与名称">' +
                '<option value="@cname" ' + (selectedType === '@cname' ? 'selected' : '') + '>中文名 (@cname)</option>' +
                '<option value="@ctitle" ' + (selectedType === '@ctitle' ? 'selected' : '') + '>中文标题 (@ctitle)</option>' +
                '<option value="@cparagraph" ' + (selectedType === '@cparagraph' ? 'selected' : '') + '>中文段落 (@cparagraph)</option>' +
                '<option value="@name" ' + (selectedType === '@name' ? 'selected' : '') + '>英文名 (@name)</option>' +
                '<option value="@title" ' + (selectedType === '@title' ? 'selected' : '') + '>英文标题 (@title)</option>' +
                '</optgroup>' +
                '<optgroup label="🌐 网络与地址">' +
                '<option value="@email" ' + (selectedType === '@email' ? 'selected' : '') + '>邮箱 (@email)</option>' +
                '<option value="@url" ' + (selectedType === '@url' ? 'selected' : '') + '>网址 URL (@url)</option>' +
                '<option value="@ip" ' + (selectedType === '@ip' ? 'selected' : '') + '>IP 地址 (@ip)</option>' +
                '<option value="@county(true)" ' + (selectedType === '@county(true)' ? 'selected' : '') + '>省市区 (@county)</option>' +
                '<option value="@city(true)" ' + (selectedType === '@city(true)' ? 'selected' : '') + '>省市 (@city)</option>' +
                '</optgroup>' +
                '<optgroup label="🕒 时间与资源">' +
                '<option value="@datetime" ' + (selectedType === '@datetime' ? 'selected' : '') + '>日期时间 (@datetime)</option>' +
                '<option value="@date" ' + (selectedType === '@date' ? 'selected' : '') + '>日期 (@date)</option>' +
                '<option value="@time" ' + (selectedType === '@time' ? 'selected' : '') + '>时间 (@time)</option>' +
                '<option value="@image(\\'200x100\\')" ' + (selectedType === "@image('200x100')" ? 'selected' : '') + '>图片 (@image)</option>' +
                '<option value="@color" ' + (selectedType === '@color' ? 'selected' : '') + '>颜色代码 (@color)</option>' +
                '</optgroup>';
            
            if (extraOpt) {
                html += '<option value="' + selectedType + '" selected hidden>' + selectedType + '</option>';
            }
            return html;
        }

        window.addMockRow = (initField = '', initType = '@cname', initCount = 5, children = null) => {
            const container = document.getElementById('mock-builder-rows');
            const rowWrapper = document.createElement('div');
            rowWrapper.className = 'mock-row-container';
            const isArray = initType === 'ARRAY'; const isObject = initType === 'OBJECT'; const hasChildren = isArray || isObject;

            rowWrapper.innerHTML = \`
                <div style="display: flex; gap: 8px; align-items: center;">
                    <input type="text" class="mb-field" placeholder="字段名(Key)" value="\${initField}" style="width:130px;">
                    <select class="mb-type" style="width:170px;" onchange="handleTypeChange(this)">
                        \${getMockTypeOptions(initType)}
                    </select>
                    <input type="number" class="mb-count" placeholder="条数" style="width:70px; display:\${isArray ? 'inline-block' : 'none'};" min="1" value="\${initCount}">
                    <button class="btn-sec mb-add-child" style="display:\${hasChildren ? 'inline-flex' : 'none'}; padding: 4px 8px; font-size: 11px;" onclick="addChildRow(this)"><i class="fa-solid fa-plus"></i></button>
                    <button class="btn-icon-only" style="margin-left:auto; color:var(--vscode-textLink-activeForeground);" onclick="insertSingleField(this)" title="写入此行"><i class="fa-solid fa-arrow-down"></i></button>
                    <i class="fa-solid fa-trash delete-icon" onclick="this.closest('.mock-row-container').remove()"></i>
                </div>
                <div class="mock-builder-children" style="margin-left: 10px; padding-left: 10px; border-left: 1px dashed var(--vscode-tree-indentGuidesStroke); display: \${hasChildren ? 'block' : 'none'}; padding-top: 8px;"></div>
            \`;
            container.appendChild(rowWrapper);
            if (children && children.length > 0) children.forEach(c => addChildRowToContainer(rowWrapper.querySelector('.mock-builder-children'), c.field, c.type));
        };

        window.addChildRowToContainer = (container, field = '', type = '@cname') => {
            const row = document.createElement('div'); row.className = 'child-row'; row.style.cssText = 'display: flex; gap: 8px; margin-bottom: 8px; align-items: center;';
            row.innerHTML = \`
                <i class="fa-solid fa-turn-up" style="transform: rotate(90deg); color: var(--vscode-descriptionForeground); font-size: 10px; margin-right: 4px;"></i>
                <input type="text" class="mb-child-field" placeholder="子字段名" value="\${field}" style="width:106px;">
                <select class="mb-child-type" style="width:170px;">
                    \${getMockTypeOptions(type)}
                </select>
                <i class="fa-solid fa-xmark delete-icon" style="margin-left:auto;" onclick="this.parentElement.remove()"></i>
            \`;
            container.appendChild(row);
        };
        
        window.addChildRow = (btn) => addChildRowToContainer(btn.closest('.mock-row-container').querySelector('.mock-builder-children'));

        window.parseJsonToRows = (jsonStr) => {
            const container = document.getElementById('mock-builder-rows'); container.innerHTML = ''; 
            try {
                const jsonObj = JSON.parse(jsonStr); const dataObj = jsonObj.data;
                if (dataObj && typeof dataObj === 'object') {
                    let hasFields = false;
                    Object.keys(dataObj).forEach(key => {
                        hasFields = true; const value = dataObj[key]; const arrMatch = key.match(/^(.+)\\|(\\d+)$/); 
                        if (arrMatch && Array.isArray(value) && value.length > 0) {
                            let cl = [];
                            if (value[0] && typeof value[0] === 'object') Object.keys(value[0]).forEach(cKey => cl.push({ field: cKey.replace('|+1', ''), type: cKey.endsWith('|+1') ? '@id' : value[0][cKey] }));
                            addMockRow(arrMatch[1], 'ARRAY', parseInt(arrMatch[2]), cl);
                        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                            let cl = []; Object.keys(value).forEach(cKey => cl.push({ field: cKey.replace('|+1', ''), type: cKey.endsWith('|+1') ? '@id' : value[cKey] }));
                            addMockRow(key, 'OBJECT', 5, cl);
                        } else addMockRow(key, typeof value === 'string' ? value : JSON.stringify(value));
                    });
                    if (!hasFields) addMockRow();
                } else addMockRow();
            } catch(e) { addMockRow(); }
        };

        function getContainerValue(container) {
            const type = container.querySelector('.mb-type').value;
            if (type === 'ARRAY' || type === 'OBJECT') {
                let itemTemplate = {}; const childRows = container.querySelectorAll('.child-row');
                if (childRows.length > 0) childRows.forEach(cr => {
                    const cField = cr.querySelector('.mb-child-field').value.trim();
                    if (cField) { const cType = cr.querySelector('.mb-child-type').value; itemTemplate[cType === '@id' ? cField + '|+1' : cField] = cType; }
                }); else itemTemplate = { "id|+1": 1, "name": "@cname" }; 
                if (type === 'ARRAY') return { isComplex: true, isArray: true, count: container.querySelector('.mb-count').value || 5, value: [itemTemplate] };
                else return { isComplex: true, isArray: false, value: itemTemplate };
            } else return { isComplex: false, value: type };
        }

        window.insertSingleField = (btn) => {
            const container = btn.closest('.mock-row-container'); const field = container.querySelector('.mb-field').value.trim();
            if (!field) return vscode.postMessage({ type: 'error', message: '请填写主字段名！' });
            let cj; try { cj = JSON.parse(document.getElementById('mockTemplate').value || '{}'); } catch(e) { return; }
            if (!cj.data) cj.data = {};
            const data = getContainerValue(container);
            if (data.isComplex && data.isArray) cj.data[\`\${field}|\${data.count}\`] = data.value; else cj.data[field] = data.value;
            document.getElementById('mockTemplate').value = JSON.stringify(cj, null, 2); simulate();
        };

        window.applyMockFields = () => {
            let cj; try { cj = JSON.parse(document.getElementById('mockTemplate').value || '{}'); } catch(e) { return; }
            cj.data = {}; let hasAdded = false;
            document.querySelectorAll('.mock-row-container').forEach(container => {
                const field = container.querySelector('.mb-field').value.trim(); if (!field) return; 
                hasAdded = true; const data = getContainerValue(container);
                if (data.isComplex && data.isArray) cj.data[\`\${field}|\${data.count}\`] = data.value; else cj.data[field] = data.value;
            });
            if (!hasAdded) return vscode.postMessage({ type: 'error', message: '请填写字段！' });
            document.getElementById('mockTemplate').value = JSON.stringify(cj, null, 2); simulate();
        };

        window.resetMockFields = () => {
            document.getElementById('mock-builder-rows').innerHTML = '';
            document.getElementById('mockTemplate').value = '{\\n  "code": 200,\\n  "data": {}\\n}';
            addMockRow();
            simulate();
        };
      </script>
    </body>
    </html>`;
  }
}