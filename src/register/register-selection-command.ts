import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { withTsType, generateUUID } from '../utils/index';
import { parseElTableColumnsFromSelection } from '../utils/parse';
import { properties } from '../global-object/properties';
import EventBus from '../utils/emitter';

let lastSelect = '';
let isStickySelected = false;
let timer: ReturnType<typeof setInterval> | null = null;

// 根据选中内容生成ts类型
async function setWithTsType(context: vscode.ExtensionContext) {
  const result = await withTsType();
  if (result) {
    // 通知可以复制内容了
    vscode.commands.executeCommand('setContext', 'Extension.SelectTots', true);
    // 注册编辑右键菜单
    let copyCommands = vscode.commands.registerCommand('extension.CopyTsType', async () => {
      // 复制内容
      const doc = await vscode.workspace.openTextDocument({
        content: result,
        language: 'typescript',
      });
      // 显示到编辑器
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.Active);
    });
    context.subscriptions.push(copyCommands);
  } else {
    vscode.commands.executeCommand('setContext', 'Extension.SelectTots', false);
  }
}

// 生成mock数据
async function generateMockData(context: vscode.ExtensionContext) {
  let result = await parseElTableColumnsFromSelection();
  if (result?.length) {
    vscode.commands.executeCommand('setContext', 'Extension.SelectToMock', true);
    let disposable = vscode.commands.registerCommand('extension.MockData', async () => {
      // 生成模拟数据
      const isAsync = properties.settings!.useAsyncMock === undefined ? true : properties.settings!.useAsyncMock;
      // 如果为异步的话可以启动服务
      if (isAsync) {
        let serverResult = '同意';
        if ((properties.settings?.mockServerCount ?? 0) < (properties.server?.length ?? 0)) {
          serverResult =
            (await vscode.window.showWarningMessage(`已启动${properties.settings?.server?.length ?? 0}个Mock服务，如果需要启动则需要关闭最早先的服务，是否同意？`, '同意', '取消')) || '取消';
        }
        if (serverResult === '同意') {
          let serverId = generateUUID(8);
          const server = http.createServer((req, res) => {
            if (req.url === `/${serverId}`) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            } else {
              res.writeHead(404);
              res.end('Not Found');
            }
          });
          server.listen(3100, () => {
            properties.server.push({
              id: serverId,
              server,
            });
            console.log('Mock server running at http://localhost:3100');
          });
        }
      } else {
      }
    });
    context.subscriptions.push(disposable);
  } else {
    vscode.commands.executeCommand('setContext', 'Extension.SelectToMock', false);
  }
}

function getWebviewContent(context: vscode.ExtensionContext, webview: vscode.Webview) {
  const htmlPath = path.join(context.extensionPath, 'resources', 'webview', 'html', 'objectToHtmlPage.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  const scriptPathOnDisk = vscode.Uri.file(path.join(context.extensionPath, 'resources', 'webview', 'js', 'objectToHtmlPage.js'));
  const scriptUri = webview.asWebviewUri(scriptPathOnDisk);

  const stylePathOnDisk = vscode.Uri.file(path.join(context.extensionPath, 'resources', 'webview', 'css', 'objectToHtmlPage.css'));
  const styleUri = webview.asWebviewUri(stylePathOnDisk);

  // 替换 index.html 中的占位符
  html = html.replace('%%SCRIPT%%', `<script src="${scriptUri}"></script>`);
  html = html.replace('%%STYLE%%', `<link rel="stylesheet" href="${styleUri}" />`);
  console.log('html', html);
  return html;
}

export function registerSelectionCommand(context: vscode.ExtensionContext) {
  // 注册webview
  // const panel = vscode.window.createWebviewPanel(
  //   'reactWebview', // 内部标识
  //   '对象转ts', // 面板标题
  //   // vscode.ViewColumn.One, // 显示在哪一列
  //   vscode.ViewColumn.Beside,
  //   {
  //     enableScripts: true, // 必须开启 JS
  //     retainContextWhenHidden:true,
  //     localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'resources/webview'))], // 限制可访问的本地资源
  //   },
  // );

  // panel.webview.html = getWebviewContent(context, panel.webview);

  // panel.reveal();

  const disposable = vscode.window.onDidChangeTextEditorSelection(() => {
    // 监听最后一次选中
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const selection = editor.selection;
    const selectedText = editor.document.getText(selection).trim();
    if (selectedText !== lastSelect) {
      isStickySelected = false;
      lastSelect = selectedText;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (selectedText) {
        timer = setInterval(() => {
          const currentText = editor.document.getText(editor.selection).trim();
          if (currentText === lastSelect && currentText !== '') {
            isStickySelected = true;
            fireTrigger(context);
            if (timer) {
              clearInterval(timer);
              timer = null;
            }
          }
        }, 1000);
      }
    }
  });
  context.subscriptions.push(disposable);
}

// 选中后防抖时候的触发时机
function fireTrigger(context: vscode.ExtensionContext) {
  // 监听是否选中对象，是否可以转成ts
  setWithTsType(context);
}
