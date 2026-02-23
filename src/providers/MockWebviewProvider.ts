import * as vscode from 'vscode';
import * as Mock from 'mockjs';
import { nanoid } from 'nanoid';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigurationService } from '../services/ConfigurationService';
import { MockServerFeature } from '../features/MockServerFeature';

export class MockWebviewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

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

      const fullMockList = mockList.map(rule => {
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
        this.sendConfigToWebview(webview, proxyList, fullMockList, mockDir);
        this._mockFeature.notifyStatusToWebview();
        break;

      case 'toggleServer':
        if (data.value) {
          await this._mockFeature.startAll();
        } else {
          await this._mockFeature.stopAll();
        }
        break;

      case 'copyText':
        vscode.env.clipboard.writeText(data.payload).then(() => {
          vscode.window.showInformationMessage('复制成功：' + data.payload);
        });
        break;

      case 'selectRuleMockDir': {
        const rootPath = this.getWorkspaceRoot();
        const defaultUri = rootPath ? vscode.Uri.file(rootPath) : undefined;

        const uri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri: defaultUri,
            openLabel: '选择数据存放文件夹'
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

            webview.postMessage({ type: 'ruleDirSelected', path: savePath });
        }
        break;
      }

      case 'saveProxy': {
        const newProxy = data.payload;
        if (!newProxy.id) {
            newProxy.id = nanoid();
            proxyList.push(newProxy);
        } else {
            const idx = proxyList.findIndex(p => p.id === newProxy.id);
            if (idx > -1) {
                proxyList[idx].port = newProxy.port;
                proxyList[idx].target = newProxy.target;
            }
        }
        await configService.updateConfig('proxy', proxyList);
        await this._mockFeature.syncServers(); 
        
        const newConf = await this.getFullConfig();
        this.sendConfigToWebview(webview, newConf.proxyList, newConf.mockList, newConf.mockDir);
        break;
      }

      case 'toggleProxy': {
        const pGroup = proxyList.find(p => p.id === data.id);
        if (pGroup) {
            pGroup.enabled = data.enabled;
            await configService.updateConfig('proxy', proxyList);
            await this._mockFeature.syncServers();
            const newConf = await this.getFullConfig();
            this.sendConfigToWebview(webview, newConf.proxyList, newConf.mockList, newConf.mockDir);
        }
        break;
      }

      case 'deleteProxy': {
        const ansProxy = await vscode.window.showWarningMessage(`确定要删除此代理吗？相关的规则也会被移除。`, { modal: true }, '删除');
        if (ansProxy === '删除') {
            const newProxyList = proxyList.filter(p => p.id !== data.id);
            const rulesToDelete = fullMockList.filter(m => m.proxyId === data.id);
            rulesToDelete.forEach(r => {
                if (r.dataPath) {
                    const absPath = this.getMockDataPath(r.dataPath);
                    if (absPath && fs.existsSync(absPath)) fs.unlinkSync(absPath);
                }
            });

            const newMockList = fullMockList.filter(m => m.proxyId !== data.id).map(r => {
                const { data, template, ...rest } = r;
                return rest;
            });
            
            await configService.updateConfig('proxy', newProxyList);
            await configService.updateConfig('mock', newMockList);
            await this._mockFeature.syncServers();
            
            const newConf = await this.getFullConfig();
            this.sendConfigToWebview(webview, newConf.proxyList, newConf.mockList, newConf.mockDir);
        }
        break;
      }

      case 'saveRule': {
        const newRuleData = data.payload;
        if (!newRuleData.id) newRuleData.id = nanoid();
        
        const rootPath = this.getWorkspaceRoot();

        let ruleDataPath = newRuleData.dataPath;
        
        if (!ruleDataPath || ruleDataPath.trim() === '') {
            let globalMockDir = configService.config.general?.mockDir;
            if (!globalMockDir) {
                const defaultUri = rootPath ? vscode.Uri.file(rootPath) : undefined;
                const uri = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    defaultUri: defaultUri,
                    openLabel: '请先选择 Mock 数据存放目录'
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
                    globalMockDir = savePath;
                } else {
                    vscode.window.showWarningMessage('保存已取消：必须配置数据存放目录才能保存规则。');
                    return; 
                }
            }
            const dataFileName = `${newRuleData.id}.json`;
            ruleDataPath = path.join(globalMockDir, dataFileName).replace(/\\/g, '/');
        } else {
             if(!ruleDataPath.endsWith('.json')) {
                 ruleDataPath = path.posix.join(ruleDataPath.replace(/\\/g, '/'), `${newRuleData.id}.json`);
             }
        }

        let absPath = ruleDataPath;
        if (!path.isAbsolute(ruleDataPath)) {
            if (!rootPath) {
                vscode.window.showErrorMessage('未打开工作区，无法保存相对路径规则！');
                return;
            }
            absPath = path.join(rootPath, ruleDataPath);
        }

        const dir = path.dirname(absPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const contentToSave = newRuleData.template !== undefined ? newRuleData.template : (newRuleData.data || {});
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
            isTemplate: isTemplate
        };

        let pureMockList = Array.isArray(configService.config.mock) ? configService.config.mock : [];
        const rIdx = pureMockList.findIndex((r: any) => r.id === newRuleData.id);
        
        if (rIdx > -1) pureMockList[rIdx] = ruleToSaveConfig;
        else pureMockList.push(ruleToSaveConfig);

        await configService.updateConfig('mock', pureMockList);
        
        webview.postMessage({ type: 'closeRuleModal' });
        
        const newConf = await this.getFullConfig();
        this.sendConfigToWebview(webview, newConf.proxyList, newConf.mockList, newConf.mockDir);
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
            
            const newConf = await this.getFullConfig();
            this.sendConfigToWebview(webview, newConf.proxyList, newConf.mockList, newConf.mockDir);
        }
        break;
      }

      case 'toggleRule': {
        let pureMockList = Array.isArray(configService.config.mock) ? configService.config.mock : [];
        const rule = pureMockList.find((r: any) => r.id === data.ruleId);
        if (rule) {
            rule.enabled = data.enabled;
            await configService.updateConfig('mock', pureMockList);
            
            const newConf = await this.getFullConfig();
            this.sendConfigToWebview(webview, newConf.proxyList, newConf.mockList, newConf.mockDir);
        }
        break;
      }

      case 'simulate':
        try {
          const template = typeof data.template === 'string' ? JSON.parse(data.template) : data.template;
          const result = Mock.mock(template);
          webview.postMessage({ type: 'simulateResult', result });
        } catch (e: any) {
          webview.postMessage({ type: 'simulateResult', error: e.message });
        }
        break;
    }
  }

  public updateStatus(runningProxyIds: string[]) {
    this._view?.webview.postMessage({ type: 'status', runningProxies: runningProxyIds });
  }

  private sendConfigToWebview(webview: vscode.Webview, proxyList: any[], mockList: any[], mockDir: string) {
    webview.postMessage({ type: 'config', proxy: proxyList, mock: mockList, mockDir });
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
          --input-bg: var(--vscode-input-background);
          --input-fg: var(--vscode-input-foreground);
          --input-border: var(--vscode-input-border);
        }
        body { font-family: var(--vscode-font-family); padding: 0; margin: 0; color: var(--text); background: var(--bg); display: flex; flex-direction: column; height: 100vh; font-size: 13px; }
        
        .header { padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--vscode-sideBar-background); display: flex; justify-content: space-between; align-items: center; }
        /* 🌟 修改点：字体改小为 13px，字重变轻为 600 */
        .header-title { font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 8px; }
        
        .server-status { font-size: 12px; padding: 4px 10px; border-radius: 20px; background: #444; color: #ccc; cursor: pointer; user-select: none; display: flex; align-items: center; gap: 6px; transition: all 0.2s; border: 1px solid transparent; }
        .server-status:hover { filter: brightness(1.1); }
        .server-status.on { background: rgba(76, 175, 80, 0.15); color: var(--success); border-color: var(--success); }
        .server-status i { font-size: 8px; }

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
        .btn-sec { background: transparent; border: 1px solid var(--border); color: var(--text); padding: 6px 14px; border-radius: 4px; cursor: pointer; }
        .btn-sec:hover { background: var(--bg-hover); }

        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 100; justify-content: center; align-items: center; }
        .modal.active { display: flex; }
        .modal-box { background: var(--bg); width: 680px; max-width: 95%; max-height: 95vh; border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        .modal-header { padding: 15px 20px; border-bottom: 1px solid var(--border); font-weight: bold; display: flex; justify-content: space-between; align-items: center; }
        .modal-body { padding: 20px; overflow-y: auto; flex: 1; }
        .modal-footer { padding: 15px 20px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 10px; background: var(--vscode-sideBar-background); border-radius: 0 0 8px 8px; }
        
        .form-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 15px; }
        .form-row { display: flex; gap: 15px; }
        .form-row .form-group { flex: 1; }
        .form-label { font-size: 12px; font-weight: 600; color: var(--text); }
        input, select, textarea { background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); padding: 8px; border-radius: 4px; outline: none; font-family: inherit; font-size: 13px; }
        input:focus, select:focus, textarea:focus { border-color: var(--primary); }

        .tabs { display: flex; margin-bottom: 0; border-bottom: 1px solid var(--border); }
        .tab { padding: 8px 16px; cursor: pointer; font-size: 12px; border-bottom: 2px solid transparent; opacity: 0.6; display: flex; align-items: center; gap: 6px; }
        .tab.active { opacity: 1; border-bottom-color: var(--primary); color: var(--primary); font-weight: bold; }
        .tab-content { border: 1px solid var(--border); border-top: none; padding: 15px; background: var(--vscode-sideBar-background); border-radius: 0 0 4px 4px; }
        .tab-pane { display: none; }
        .tab-pane.active { display: block; }
        
        .mock-builder-container { background: rgba(0,0,0,0.15); padding: 10px; border-radius: 6px; border: 1px solid var(--border); margin-bottom: 12px; }
        .mock-builder-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .mock-row-container { border-left: 2px solid var(--border); padding-left: 8px; margin-bottom: 10px; padding-bottom: 5px; border-bottom: 1px dashed rgba(150,150,150,0.2); }
        
        #previewArea { display: none; margin-top: 15px; }
        #previewBox { background: rgba(0,0,0,0.3); padding: 10px; border-radius: 4px; font-family: monospace; font-size: 12px; white-space: pre-wrap; max-height: 150px; overflow: auto; border: 1px solid var(--border); }
      </style>
    </head>
    <body>
      
      <div class="header">
        <div class="header-title"><i class="fa-solid fa-network-wired"></i> 代理与 Mock</div>
        <div id="globalServerBtn" class="server-status" title="点击一键启停所有启用的服务">
           <i class="fa-solid fa-circle"></i> <span id="globalStatusText">已停止</span>
        </div>
      </div>

      <div class="content" id="proxyList"></div>

      <div class="footer">
        <button onclick="openProxyModal()" class="btn-pri"><i class="fa-solid fa-plus"></i> 添加代理服务 (Proxy)</button>
      </div>

      <div id="proxyModal" class="modal">
        <div class="modal-box" style="width: 400px;">
          <div class="modal-header">
            <span id="proxyModalTitle">配置代理服务</span>
            <i class="fa-solid fa-xmark" onclick="closeModal('proxyModal')" style="cursor:pointer; opacity:0.6;"></i>
          </div>
          <div class="modal-body">
            <input type="hidden" id="proxy_id">
            <div class="form-group">
               <label class="form-label">本地服务端口 (Port) <span style="color:var(--error)">*</span></label>
               <input type="number" id="proxy_port" placeholder="e.g. 8080">
            </div>
            <div class="form-group">
               <label class="form-label">全局代理目标 (Target) <span style="color:var(--error)">*</span></label>
               <input type="text" id="proxy_target" placeholder="e.g. https://devcms.nfnews.com">
               <div style="font-size:11px; opacity:0.6; margin-top:4px;">未命中 Mock 规则的请求将默认转发至此地址</div>
            </div>
          </div>
          <div class="modal-footer">
            <button onclick="closeModal('proxyModal')" class="btn-sec">取消</button>
            <button onclick="saveProxy()" class="btn-pri" style="width: auto;">保存</button>
          </div>
        </div>
      </div>

      <div id="ruleModal" class="modal">
        <div class="modal-box">
          <div class="modal-header">
            <span id="ruleModalTitle">配置拦截规则</span>
            <i class="fa-solid fa-xmark" onclick="closeModal('ruleModal')" style="cursor: pointer; opacity: 0.6;"></i>
          </div>
          <div class="modal-body">
            <input type="hidden" id="rule_id">
            <input type="hidden" id="rule_proxyId">
            
            <div class="form-row">
              <div class="form-group" style="flex: 0 0 110px;">
                <label class="form-label">Method</label>
                <select id="rule_method">
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                  <option value="PATCH">PATCH</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">API Path</label>
                <input type="text" id="rule_url" placeholder="e.g. /xy/app/theme/list">
              </div>
            </div>

            <div class="form-row">
               <div class="form-group" style="flex: 2">
                 <label class="form-label">Content-Type</label>
                 <select id="rule_contentType">
                   <option value="application/json">application/json</option>
                   <option value="text/plain">text/plain</option>
                   <option value="text/html">text/html</option>
                 </select>
               </div>
               <div class="form-group" style="flex: 3">
                 <label class="form-label">独立 Target <span style="color:var(--error)">*</span></label>
                 <input type="text" id="rule_target" list="targetOptions" placeholder="输入需转发的目标地址">
                 <datalist id="targetOptions"></datalist>
               </div>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Mock数据存放路径 (基于根目录)</label>
                  <div style="display:flex; gap:8px;">
                     <input type="text" id="rule_dataPath" placeholder="默认: .quickops/mocks/xxx.json">
                     <button onclick="selectRuleMockDir()" class="btn-sec" style="padding: 0 10px; white-space:nowrap;" title="选择文件夹"><i class="fa-regular fa-folder-open"></i></button>
                  </div>
               </div>
            </div>

            <label class="form-label">Response Body (响应数据)</label>
            <div class="tabs">
              <div id="tab-mock" class="tab active" onclick="switchTab('mock')"><i class="fa-solid fa-wand-magic-sparkles"></i> Mock 模板构建</div>
              <div id="tab-custom" class="tab" onclick="switchTab('custom')"><i class="fa-solid fa-code"></i> 静态 JSON</div>
            </div>

            <div class="tab-content">
                <div id="pane-mock" class="tab-pane active">
                    
                    <div class="mock-builder-container">
                        <div class="mock-builder-header">
                            <span style="font-size:12px; font-weight:bold;"><i class="fa-solid fa-list-ul"></i> 快捷字段生成器</span>
                            <div style="display:flex; gap: 8px;">
                               <button onclick="applyMockFields()" class="btn-pri" style="padding: 2px 8px; font-size:11px; width:auto;" title="收集下方所有表单，一次性生成完整结构"><i class="fa-solid fa-bolt"></i> 生成全量 JSON</button>
                               <button onclick="addMockRow()" class="btn-sec" style="padding: 2px 8px; font-size:11px;"><i class="fa-solid fa-plus"></i> 新增空行</button>
                            </div>
                        </div>
                        <div id="mock-builder-rows" style="max-height: 200px; overflow-y: auto; padding-right: 5px;">
                            </div>
                    </div>

                    <textarea id="mockTemplate" style="height: 120px;" placeholder='{ "code": 200, "data": {} }'></textarea>
                </div>
                
                <div id="pane-custom" class="tab-pane">
                    <textarea id="customJson" style="height: 200px;" placeholder='[ { "id": 1, "name": "Item 1" } ]'></textarea>
                </div>
            </div>

            <div id="previewArea">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                    <label class="form-label">Mock 预览结果</label>
                    <button onclick="simulate()" class="btn-sec" style="font-size: 11px; padding: 2px 8px;"><i class="fa-solid fa-play"></i> 刷新</button>
                </div>
                <div id="previewBox"></div>
            </div>

          </div>
          <div class="modal-footer">
            <button onclick="closeModal('ruleModal')" class="btn-sec">取消</button>
            <button onclick="saveRule()" class="btn-pri" style="width: auto;">保存规则</button>
          </div>
        </div>
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        let proxies = []; 
        let mocks = [];
        let runningProxies = []; 
        let isGlobalRunning = false;
        let globalMockDir = '.quickops/mocks'; 

        window.addEventListener('message', e => {
           const msg = e.data;
           if(msg.type === 'config') {
             proxies = msg.proxy || [];
             mocks = msg.mock || [];
             if(msg.mockDir) globalMockDir = msg.mockDir;
             updateTargetDatalist(); 
             render();
           }
           if(msg.type === 'status') {
             runningProxies = msg.runningProxies || [];
             isGlobalRunning = runningProxies.length > 0;
             const btn = document.getElementById('globalServerBtn');
             const txt = document.getElementById('globalStatusText');
             // 🌟 修改点：状态文本字数缩减
             if(isGlobalRunning) {
               btn.className = 'server-status on';
               txt.innerText = \`运行中 (\${runningProxies.length})\`;
             } else {
               btn.className = 'server-status';
               txt.innerText = '已停止';
             }
             render();
           }
           if(msg.type === 'simulateResult') {
             const box = document.getElementById('previewBox');
             box.innerText = msg.error ? 'Error: ' + msg.error : JSON.stringify(msg.result, null, 2);
             box.style.color = msg.error ? 'var(--error)' : 'var(--text)';
           }
           if(msg.type === 'closeRuleModal') {
               closeModal('ruleModal');
           }
           if(msg.type === 'ruleDirSelected') {
               let p = msg.path;
               if (!p.endsWith('/')) p += '/';
               const pathEl = document.getElementById('rule_dataPath');
               if (pathEl) pathEl.value = p;
           }
        });
        
        vscode.postMessage({ type: 'refresh' });

        function updateTargetDatalist() {
            const datalist = document.getElementById('targetOptions');
            if(!datalist) return;
            datalist.innerHTML = '';
            const targetSet = new Set();
            proxies.forEach(p => { if (p.target) targetSet.add(p.target) });
            mocks.forEach(m => { if (m.target) targetSet.add(m.target) });

            targetSet.forEach(t => {
                const option = document.createElement('option');
                option.value = t;
                datalist.appendChild(option);
            });
        }

        document.getElementById('globalServerBtn').onclick = () => {
            vscode.postMessage({ type: 'toggleServer', value: !isGlobalRunning });
        };
        
        window.selectRuleMockDir = () => {
            vscode.postMessage({ type: 'selectRuleMockDir' });
        };

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

        window.copyTargetUrl = (url) => {
            vscode.postMessage({ type: 'copyText', payload: url });
        };

        window.handleTypeChange = (select) => {
            const container = select.closest('.mock-row-container');
            const val = select.value;
            const isArray = val === 'ARRAY';
            const isObject = val === 'OBJECT';
            const hasChildren = isArray || isObject;
            
            container.querySelector('.mb-count').style.display = isArray ? 'inline-block' : 'none';
            container.querySelector('.mb-add-child').style.display = hasChildren ? 'inline-block' : 'none';
            
            const childrenDiv = container.querySelector('.mock-builder-children');
            childrenDiv.style.display = hasChildren ? 'block' : 'none';
            
            if (hasChildren && childrenDiv.children.length === 0) {
                addChildRowToContainer(childrenDiv);
            }
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
                <div class="mock-builder-row" style="display: flex; gap: 8px; align-items: center;">
                    <input type="text" class="mb-field" placeholder="字段名(如 data)" value="\${initField}" style="width:110px; padding: 4px 6px; font-size: 12px;">
                    <select class="mb-type" style="width:140px; padding: 4px 6px; font-size: 12px;" onchange="handleTypeChange(this)">
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
                    <input type="number" class="mb-count" placeholder="条数" style="width:60px; display:\${isArray ? 'inline-block' : 'none'}; padding: 4px 6px; font-size: 12px;" min="1" value="\${initCount}">
                    
                    <button class="mb-add-child btn-sec" style="display:\${hasChildren ? 'inline-block' : 'none'}; padding: 3px 6px; font-size:11px;" onclick="addChildRow(this)">添加单项字段</button>
                    
                    <button onclick="insertSingleField(this)" class="btn-sec" style="padding: 3px 8px; font-size:11px; white-space:nowrap; border-color:var(--primary); color:var(--primary);" title="只把这一行的数据独立写入">写入 JSON</button>
                    <i class="fa-solid fa-trash" style="cursor:pointer; opacity:0.6; font-size:14px; margin-left: 5px; color: var(--error);" onclick="this.closest('.mock-row-container').remove()" title="删除此行"></i>
                </div>
                <div class="mock-builder-children" style="margin-left: 15px; display: \${hasChildren ? 'block' : 'none'}; padding-top: 6px;"></div>
            \`;
            
            container.appendChild(rowWrapper);

            if (children && children.length > 0) {
                const childContainer = rowWrapper.querySelector('.mock-builder-children');
                children.forEach(c => addChildRowToContainer(childContainer, c.field, c.type));
            }
        };

        window.addChildRowToContainer = (container, field = '', type = '@cname') => {
            const row = document.createElement('div');
            row.className = 'mock-builder-row child-row';
            row.style.cssText = 'display: flex; gap: 8px; margin-bottom: 6px; align-items: center;';
            const extraOpt = !['@id', '@cname', '@title', '@integer(1, 100)', '@boolean', '@date', "@image('200x100')"].includes(type);

            row.innerHTML = \`
                <i class="fa-solid fa-turn-up" style="transform: rotate(90deg); opacity:0.4; font-size:10px;"></i>
                <input type="text" class="mb-child-field" placeholder="子字段名(如 id)" value="\${field}" style="width:100px; padding: 4px 6px; font-size: 12px;">
                <select class="mb-child-type" style="width:120px; padding: 4px 6px; font-size: 12px;">
                    <option value="@id" \${type === '@id' ? 'selected' : ''}>自增ID (@id)</option>
                    <option value="@cname" \${type === '@cname' ? 'selected' : ''}>中文名 (@cname)</option>
                    <option value="@title" \${type === '@title' ? 'selected' : ''}>标题 (@title)</option>
                    <option value="@integer(1, 100)" \${type === '@integer(1, 100)' ? 'selected' : ''}>数字 (@integer)</option>
                    <option value="@boolean" \${type === '@boolean' ? 'selected' : ''}>布尔值 (@boolean)</option>
                    <option value="@date" \${type === '@date' ? 'selected' : ''}>日期 (@date)</option>
                    <option value="@image('200x100')" \${type === "@image('200x100')" ? 'selected' : ''}>图片 (@image)</option>
                    \${extraOpt ? \`<option value='\${type}' selected hidden>\${type}</option>\` : ''}
                </select>
                <i class="fa-solid fa-xmark" style="cursor:pointer; opacity:0.6; font-size:14px; margin-left: 5px; color: var(--error);" onclick="this.parentElement.remove()" title="删除子字段"></i>
            \`;
            container.appendChild(row);
        };

        window.addChildRow = (btn) => {
            const container = btn.closest('.mock-row-container').querySelector('.mock-builder-children');
            addChildRowToContainer(container);
        };

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
                            const fieldName = arrMatch[1];
                            const count = arrMatch[2];
                            const itemObj = value[0];
                            
                            let childrenList = [];
                            if (itemObj && typeof itemObj === 'object') {
                                Object.keys(itemObj).forEach(cKey => {
                                    let cFieldName = cKey;
                                    let cType = itemObj[cKey];
                                    if (cKey.endsWith('|+1')) {
                                        cFieldName = cKey.replace('|+1', '');
                                        cType = '@id';
                                    }
                                    childrenList.push({ field: cFieldName, type: cType });
                                });
                            }
                            addMockRow(fieldName, 'ARRAY', parseInt(count), childrenList);
                        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                            let childrenList = [];
                            Object.keys(value).forEach(cKey => {
                                let cFieldName = cKey;
                                let cType = value[cKey];
                                if (cKey.endsWith('|+1')) {
                                    cFieldName = cKey.replace('|+1', '');
                                    cType = '@id';
                                }
                                childrenList.push({ field: cFieldName, type: cType });
                            });
                            addMockRow(key, 'OBJECT', 5, childrenList);
                        } else {
                            let typeStr = typeof value === 'string' ? value : JSON.stringify(value);
                            addMockRow(key, typeStr);
                        }
                    });
                    
                    if (!hasFields) addMockRow();
                } else {
                    addMockRow();
                }
            } catch(e) {
                addMockRow();
            }
        };

        function getContainerValue(container) {
            const type = container.querySelector('.mb-type').value;
            
            if (type === 'ARRAY' || type === 'OBJECT') {
                let itemTemplate = {};
                const childRows = container.querySelectorAll('.child-row');
                if (childRows.length > 0) {
                    childRows.forEach(cr => {
                        const cField = cr.querySelector('.mb-child-field').value.trim();
                        const cType = cr.querySelector('.mb-child-type').value;
                        if (cField) {
                            if (cType === '@id') {
                                itemTemplate[cField + '|+1'] = 1; 
                            } else {
                                itemTemplate[cField] = cType;
                            }
                        }
                    });
                } else {
                    itemTemplate = { "id|+1": 1, "name": "@cname" }; 
                }
                
                if (type === 'ARRAY') {
                    const countInput = container.querySelector('.mb-count');
                    const count = countInput && countInput.value ? countInput.value : 5;
                    return { isComplex: true, isArray: true, count, value: [itemTemplate] };
                } else {
                    return { isComplex: true, isArray: false, value: itemTemplate };
                }
            } else {
                return { isComplex: false, value: type };
            }
        }

        window.insertSingleField = (btn) => {
            const container = btn.closest('.mock-row-container');
            const field = container.querySelector('.mb-field').value.trim();
            
            if (!field) return vscode.postMessage({ type: 'error', message: '请填写主字段名！' });

            const tplArea = document.getElementById('mockTemplate');
            let currentJson;
            try { currentJson = JSON.parse(tplArea.value || '{}'); } 
            catch(e) { return vscode.postMessage({ type: 'error', message: 'JSON框解析失败' }); }

            if (!currentJson.data) currentJson.data = {};

            const data = getContainerValue(container);
            if (data.isComplex && data.isArray) {
                currentJson.data[\`\${field}|\${data.count}\`] = data.value;
            } else {
                currentJson.data[field] = data.value;
            }

            tplArea.value = JSON.stringify(currentJson, null, 2);
            simulate();
            
            const originalText = btn.innerText;
            btn.innerText = '成功';
            setTimeout(() => { btn.innerText = originalText; }, 1000);
        };

        window.applyMockFields = () => {
            const tplArea = document.getElementById('mockTemplate');
            let currentJson;
            try { currentJson = JSON.parse(tplArea.value || '{}'); } 
            catch(e) { return vscode.postMessage({ type: 'error', message: 'JSON 解析异常！' }); }

            currentJson.data = {};
            const containers = document.querySelectorAll('.mock-row-container');
            let hasAdded = false;

            containers.forEach(container => {
                const field = container.querySelector('.mb-field').value.trim();
                if (!field) return; 
                hasAdded = true;

                const data = getContainerValue(container);
                if (data.isComplex && data.isArray) {
                    currentJson.data[\`\${field}|\${data.count}\`] = data.value;
                } else {
                    currentJson.data[field] = data.value;
                }
            });

            if (!hasAdded) return vscode.postMessage({ type: 'error', message: '请至少填写一个字段名后再生成！' });

            tplArea.value = JSON.stringify(currentJson, null, 2);
            simulate();
        };

        window.switchTab = (mode) => {
            document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
            document.getElementById('tab-' + mode).classList.add('active');
            document.getElementById('pane-' + mode).classList.add('active');
            const previewArea = document.getElementById('previewArea');
            if (mode === 'mock') {
                previewArea.style.display = 'block';
            } else {
                previewArea.style.display = 'none';
            }
        };

        window.closeModal = (id) => document.getElementById(id).classList.remove('active');

        window.openProxyModal = (id) => {
           if (typeof id === 'string' && id.trim() !== '') {
               const p = proxies.find(x => x.id === id);
               if(p) {
                 document.getElementById('proxyModalTitle').innerText = '编辑代理服务';
                 document.getElementById('proxy_id').value = p.id;
                 document.getElementById('proxy_port').value = p.port;
                 document.getElementById('proxy_target').value = p.target;
               }
           } else {
               document.getElementById('proxyModalTitle').innerText = '新增代理服务';
               document.getElementById('proxy_id').value = '';
               document.getElementById('proxy_port').value = '';
               document.getElementById('proxy_target').value = '';
           }
           document.getElementById('proxyModal').classList.add('active');
        };

        window.saveProxy = () => {
            const id = document.getElementById('proxy_id').value;
            const port = parseInt(document.getElementById('proxy_port').value);
            const target = document.getElementById('proxy_target').value;
            if(!port || !target) return vscode.postMessage({ type: 'error', message: '端口和目标地址为必填项！' });
            vscode.postMessage({ type: 'saveProxy', payload: { id, port, target, enabled: true } });
            closeModal('proxyModal');
        };

        window.toggleProxy = (id, enabled) => vscode.postMessage({ type: 'toggleProxy', id, enabled });
        window.delProxy = (id) => vscode.postMessage({ type: 'deleteProxy', id });

        window.openRuleModal = (proxyId, ruleId) => {
           let rule = null;
           if (typeof ruleId === 'string' && ruleId.trim() !== '') {
               rule = mocks.find(r => r.id === ruleId);
           }
           
           const safelySetValue = (id, value) => {
               const el = document.getElementById(id);
               if (el) el.value = value;
           };

           document.getElementById('ruleModalTitle').innerText = rule ? '编辑拦截规则' : '新增拦截规则';
           safelySetValue('rule_proxyId', proxyId);
           safelySetValue('rule_id', rule ? rule.id : '');
           safelySetValue('rule_method', rule ? rule.method : 'GET');
           safelySetValue('rule_url', rule ? rule.url : '');
           safelySetValue('rule_contentType', rule?.contentType || 'application/json');
           safelySetValue('rule_target', rule?.target || '');
           
           let pPath = rule?.dataPath || '';
           if(!pPath) {
               pPath = globalMockDir.endsWith('/') ? globalMockDir : globalMockDir + '/';
           }
           safelySetValue('rule_dataPath', pPath);

           if (rule && !rule.isTemplate && rule.data) {
               const valStr = typeof rule.data === 'string' ? rule.data : JSON.stringify(rule.data, null, 2);
               safelySetValue('customJson', valStr);
               safelySetValue('mockTemplate', '{ "code": 200, "data": {} }'); 
               switchTab('custom');
               
               document.getElementById('mock-builder-rows').innerHTML = '';
               addMockRow();
           } else {
               const tpl = rule?.template || { "code": 200, "data": {} };
               const valStr = typeof tpl === 'string' ? tpl : JSON.stringify(tpl, null, 2);
               safelySetValue('mockTemplate', valStr);
               safelySetValue('customJson', '[]');
               switchTab('mock');
               
               parseJsonToRows(valStr);
               
               simulate(); 
           }

           document.getElementById('ruleModal').classList.add('active');
        };

        window.saveRule = () => {
           const proxyId = document.getElementById('rule_proxyId').value;
           const id = document.getElementById('rule_id').value;
           const method = document.getElementById('rule_method').value;
           const url = document.getElementById('rule_url').value;
           const contentType = document.getElementById('rule_contentType').value;
           const target = document.getElementById('rule_target').value;
           const dataPath = document.getElementById('rule_dataPath').value;
           
           if(!url) return vscode.postMessage({ type: 'error', message: 'API Path 不能为空' });
           
           if (!target || target.trim() === '') {
               return vscode.postMessage({ type: 'error', message: '独立 Target 不能为空！' });
           }

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

               const payload = {
                   id: id || null, proxyId, method, url, contentType, target, enabled: true,
                   template: template, data: staticData, dataPath: dataPath || undefined
               };

               vscode.postMessage({ type: 'saveRule', payload });
           } catch(e) {
               vscode.postMessage({ type: 'error', message: 'JSON 格式错误: ' + e.message });
           }
        };

        window.simulate = () => {
           const raw = document.getElementById('mockTemplate').value;
           vscode.postMessage({ type: 'simulate', template: raw });
        };

        window.toggleRule = (ruleId, val) => vscode.postMessage({ type: 'toggleRule', ruleId, enabled: val });
        window.delRule = (ruleId) => vscode.postMessage({ type: 'deleteRule', ruleId });

        function render() {
          const list = document.getElementById('proxyList');
          list.innerHTML = '';
          
          if(proxies.length === 0) {
            list.innerHTML = \`<div class="empty-tip">
              <i class="fa-solid fa-server fa-2x"></i>
              <div style="margin-top:10px">暂无代理服务</div>
              <div style="font-size:11px; margin-top:5px;">请先添加代理服务后，方可配置 Mock 规则</div>
            </div>\`;
            return;
          }

          proxies.forEach(p => {
            const isProxyRunning = runningProxies.includes(p.id);
            const proxyStatusColor = isProxyRunning ? 'var(--success)' : '#555';
            
            const groupDiv = document.createElement('div');
            groupDiv.className = 'proxy-container';
            
            groupDiv.innerHTML = \`
                <div class="proxy-header">
                    <div class="proxy-info" title="状态: \${isProxyRunning ? '运行中' : '已停止'}">
                        <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                            <i class="fa-solid fa-circle" style="color: \${proxyStatusColor}; font-size: 10px;"></i>
                            <span class="port-badge">:\${p.port}</span> 
                            <i class="fa-solid fa-arrow-right-long" style="opacity:0.5;"></i> 
                        </div>
                        <div class="target-wrapper" onmouseenter="showCopyIcon(this)">
                            <span class="proxy-target" title="\${p.target}">\${p.target}</span>
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
}