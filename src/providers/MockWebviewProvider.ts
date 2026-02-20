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

      case 'selectMockDir': {
        const rootPath = this.getWorkspaceRoot();
        const defaultUri = rootPath ? vscode.Uri.file(rootPath) : undefined;

        const uri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri: defaultUri,
            openLabel: '选择此文件夹存放 Mock 数据'
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
            
            const newConf = await this.getFullConfig();
            this.sendConfigToWebview(webview, newConf.proxyList, newConf.mockList, savePath);
            vscode.window.showInformationMessage(`Mock 数据存放目录已更改为: ${savePath}`);
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

      // 🛡️ 核心：添加规则时强制拦截选择目录
      case 'saveRule': {
        const newRuleData = data.payload;
        if (!newRuleData.id) newRuleData.id = nanoid();
        
        const rootPath = this.getWorkspaceRoot();

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

        let ruleDataPath = newRuleData.dataPath;
        if (!ruleDataPath) {
            const dataFileName = `${newRuleData.id}.json`;
            ruleDataPath = path.join(globalMockDir, dataFileName).replace(/\\/g, '/');
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

        const contentToSave = newRuleData.template !== undefined ? newRuleData.template : newRuleData.data;
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
        
        // 关键修复：直接在这里通知前端关闭弹窗，避免后端成功后前端还需要手动关
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
        .header-title { font-weight: bold; font-size: 14px; display: flex; align-items: center; gap: 8px; }
        
        .server-status { font-size: 12px; padding: 4px 10px; border-radius: 20px; background: #444; color: #ccc; cursor: pointer; user-select: none; display: flex; align-items: center; gap: 6px; transition: all 0.2s; border: 1px solid transparent; }
        .server-status:hover { filter: brightness(1.1); }
        .server-status.on { background: rgba(76, 175, 80, 0.15); color: var(--success); border-color: var(--success); }
        .server-status i { font-size: 8px; }

        .mock-dir-setting { font-size: 11px; padding: 4px 8px; border-radius: 4px; background: var(--vscode-editor-background); color: var(--text-sub); border: 1px solid var(--border); cursor: pointer; display: flex; align-items: center; gap: 6px; transition: 0.2s; }
        .mock-dir-setting:hover { border-color: var(--primary); color: var(--text); }
        .mock-dir-setting.empty { color: var(--error); border-color: var(--error); }

        .content { flex: 1; overflow-y: auto; padding: 16px 12px; }
        .empty-tip { text-align: center; padding: 40px; opacity: 0.5; color: var(--text-sub); }

        /* Proxy Container */
        .proxy-container { border: 1px solid var(--border); border-radius: 8px; margin-bottom: 20px; background: var(--bg); overflow: hidden; }
        .proxy-header { background: var(--vscode-sideBar-background); padding: 12px 14px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
        .proxy-info { display: flex; align-items: center; gap: 8px; font-weight: bold; }
        .port-badge { background: var(--primary); color: white; padding: 2px 6px; border-radius: 4px; font-size: 11px; }
        .proxy-target { font-family: monospace; font-size: 12px; opacity: 0.8; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .proxy-actions { display: flex; align-items: center; gap: 10px; }
        
        /* Rule List */
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

        /* Switch UI */
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

        /* Modals */
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 100; justify-content: center; align-items: center; }
        .modal.active { display: flex; }
        .modal-box { background: var(--bg); width: 650px; max-width: 90%; max-height: 90vh; border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        .modal-header { padding: 15px 20px; border-bottom: 1px solid var(--border); font-weight: bold; display: flex; justify-content: space-between; align-items: center; }
        .modal-body { padding: 20px; overflow-y: auto; flex: 1; }
        .modal-footer { padding: 15px 20px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 10px; background: var(--vscode-sideBar-background); border-radius: 0 0 8px 8px; }
        
        .form-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 15px; }
        .form-row { display: flex; gap: 15px; }
        .form-row .form-group { flex: 1; }
        .form-label { font-size: 12px; font-weight: 600; color: var(--text); }
        input, select, textarea { background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); padding: 8px; border-radius: 4px; outline: none; font-family: inherit; font-size: 13px; }
        input:focus, select:focus, textarea:focus { border-color: var(--primary); }

        /* Tabs */
        .tabs { display: flex; margin-bottom: 0; border-bottom: 1px solid var(--border); }
        .tab { padding: 8px 16px; cursor: pointer; font-size: 12px; border-bottom: 2px solid transparent; opacity: 0.6; display: flex; align-items: center; gap: 6px; }
        .tab.active { opacity: 1; border-bottom-color: var(--primary); color: var(--primary); font-weight: bold; }
        .tab-content { border: 1px solid var(--border); border-top: none; padding: 15px; background: var(--vscode-sideBar-background); border-radius: 0 0 4px 4px; }
        .tab-pane { display: none; }
        .tab-pane.active { display: block; }
        
        #previewArea { display: none; margin-top: 15px; }
        #previewBox { background: rgba(0,0,0,0.3); padding: 10px; border-radius: 4px; font-family: monospace; font-size: 12px; white-space: pre-wrap; max-height: 150px; overflow: auto; border: 1px solid var(--border); }
      </style>
    </head>
    <body>
      
      <div class="header">
        <div class="header-title"><i class="fa-solid fa-network-wired"></i> 代理与 Mock 管理</div>
        <div style="display:flex; gap:10px; align-items:center;">
            <div id="mockDirBtn" class="mock-dir-setting" title="修改数据文件存放目录" onclick="selectMockDir()">
               <i class="fa-regular fa-folder-open"></i> <span id="mockDirDisplay">加载中...</span>
            </div>
            <div id="globalServerBtn" class="server-status" title="点击一键启停">
               <i class="fa-solid fa-circle"></i> <span id="globalStatusText">全部停止</span>
            </div>
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
            <input type="hidden" id="rule_dataPath">
            
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
              <div class="form-group">
                 <label class="form-label">Content-Type</label>
                 <select id="rule_contentType">
                   <option value="application/json">application/json</option>
                   <option value="text/plain">text/plain</option>
                   <option value="text/html">text/html</option>
                 </select>
              </div>
              <div class="form-group">
                 <label class="form-label">独立 Target (可选覆盖)</label>
                 <input type="text" id="rule_target" list="targetOptions" placeholder="留空则使用所属 Proxy 的 Target">
                 <datalist id="targetOptions"></datalist>
              </div>
            </div>

            <label class="form-label">Response Body (响应数据)</label>
            <div class="tabs">
              <div id="tab-mock" class="tab active" onclick="switchTab('mock')"><i class="fa-solid fa-wand-magic-sparkles"></i> Mock 模板</div>
              <div id="tab-custom" class="tab" onclick="switchTab('custom')"><i class="fa-solid fa-code"></i> 静态 JSON</div>
            </div>

            <div class="tab-content">
                <div id="pane-mock" class="tab-pane active">
                    <textarea id="mockTemplate" style="height: 160px;" placeholder='{ "code": 0, "data": { "list|10": [{"id|+1":1, "name":"@cname"}] } }'></textarea>
                </div>
                <div id="pane-custom" class="tab-pane">
                    <textarea id="customJson" style="height: 160px;" placeholder='[ { "id": 1, "name": "Item 1" } ]'></textarea>
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
        let currentMockDir = '';

        window.addEventListener('message', e => {
           const msg = e.data;
           if(msg.type === 'config') {
             proxies = msg.proxy || [];
             mocks = msg.mock || [];
             
             currentMockDir = msg.mockDir || '';
             const dirBtn = document.getElementById('mockDirBtn');
             const dirDisplay = document.getElementById('mockDirDisplay');
             if (currentMockDir) {
                 dirDisplay.innerText = currentMockDir;
                 dirBtn.classList.remove('empty');
             } else {
                 dirDisplay.innerText = '请点击设置存放目录';
                 dirBtn.classList.add('empty');
             }
             
             updateTargetDatalist(); 
             render();
           }
           if(msg.type === 'status') {
             runningProxies = msg.runningProxies || [];
             isGlobalRunning = runningProxies.length > 0;
             const btn = document.getElementById('globalServerBtn');
             const txt = document.getElementById('globalStatusText');
             if(isGlobalRunning) {
               btn.className = 'server-status on';
               txt.innerText = \`运行中: \${runningProxies.length} 个服务\`;
             } else {
               btn.className = 'server-status';
               txt.innerText = '全部停止';
             }
             render();
           }
           if(msg.type === 'simulateResult') {
             const box = document.getElementById('previewBox');
             box.innerText = msg.error ? 'Error: ' + msg.error : JSON.stringify(msg.result, null, 2);
             box.style.color = msg.error ? 'var(--error)' : 'var(--text)';
           }
           
           // 🌟 监听后端传来的关闭指令
           if(msg.type === 'closeRuleModal') {
               closeModal('ruleModal');
           }
        });
        
        vscode.postMessage({ type: 'refresh' });

        function updateTargetDatalist() {
            const datalist = document.getElementById('targetOptions');
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
        
        window.selectMockDir = () => {
            vscode.postMessage({ type: 'selectMockDir' });
        };

        window.switchTab = (mode) => {
            document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
            document.getElementById('tab-' + mode).classList.add('active');
            document.getElementById('pane-' + mode).classList.add('active');
            const previewArea = document.getElementById('previewArea');
            if (mode === 'mock') {
                previewArea.style.display = 'block';
                document.getElementById('previewBox').innerText = ''; 
            } else {
                previewArea.style.display = 'none';
            }
        };

        window.closeModal = (id) => document.getElementById(id).classList.remove('active');

        window.openProxyModal = (id = null) => {
           if (id) {
               const p = proxies.find(x => x.id === id);
               document.getElementById('proxyModalTitle').innerText = '编辑代理服务';
               document.getElementById('proxy_id').value = p.id;
               document.getElementById('proxy_port').value = p.port;
               document.getElementById('proxy_target').value = p.target;
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

        window.openRuleModal = (proxyId, ruleId = null) => {
           let rule = null;
           if (ruleId) rule = mocks.find(r => r.id === ruleId);
           
           document.getElementById('ruleModalTitle').innerText = rule ? '编辑拦截规则' : '新增拦截规则';
           document.getElementById('rule_proxyId').value = proxyId;
           document.getElementById('rule_id').value = rule ? rule.id : '';
           document.getElementById('rule_method').value = rule ? rule.method : 'GET';
           document.getElementById('rule_url').value = rule ? rule.url : '';
           document.getElementById('rule_contentType').value = rule?.contentType || 'application/json';
           document.getElementById('rule_target').value = rule?.target || '';
           document.getElementById('rule_dataPath').value = rule?.dataPath || '';

           if (rule && !rule.isTemplate && rule.data) {
               document.getElementById('customJson').value = typeof rule.data === 'string' ? rule.data : JSON.stringify(rule.data, null, 2);
               document.getElementById('mockTemplate').value = '{}'; 
               switchTab('custom');
           } else {
               const tpl = rule?.template || {};
               document.getElementById('mockTemplate').value = typeof tpl === 'string' ? tpl : JSON.stringify(tpl, null, 2);
               document.getElementById('customJson').value = '{}';
               switchTab('mock');
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
               // 🚨注意：这里移除了 closeModal()，关闭操作交给后端校验通过后触发
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
                        <i class="fa-solid fa-circle" style="color: \${proxyStatusColor}; font-size: 10px;"></i>
                        <span class="port-badge">:\${p.port}</span> 
                        <i class="fa-solid fa-arrow-right-long" style="opacity:0.5;"></i> 
                        <span class="proxy-target">\${p.target}</span>
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