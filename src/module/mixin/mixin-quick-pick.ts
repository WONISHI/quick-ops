import * as vscode from 'vscode';
import { mergeGlobalVars, properties } from '../../global-object/properties';
import { OpenMode } from '../../constants/index';
import HttpService from '../../services/HttpService';

export function MixinSubscribeCommandChannel(message: any) {
  switch (message.type) {
    case 'start-service':
      // 运行指令
      const command = message.command;
      runCommand(command);
      break;
    case 'debug':
      vscode.window.showInformationMessage(`打印数据${JSON.stringify(message)}`);
      break;
    case 'new-service':
      // 新建服务
      const newService = HttpService.addRoute({
        ...message.data,
      });
      mergeGlobalVars({ server: [...properties.server, newService] });
      break;
    case 'enable-service':
      // 运行停止服务
      const serviceOptions = HttpService.toggleServer({
        ...message.data,
      });
      const server = properties.server.find((item) => {
        return item.id === serviceOptions?.id;
      });
      server.active = serviceOptions?.active;
      mergeGlobalVars({ server: [...properties.server] });
      break;
    case 'update-service':
      // 更新服务
      HttpService.updateRouteData({
        ...message.data,
      });
      break;
    case 'delete-service':
      // 删除服务
      const serviceStatus = HttpService.removeRoute({
        ...message.data,
      });
      if (serviceStatus) {
        const server = properties.server.filter((item) => item.id !== message.data.id);
        mergeGlobalVars({ server });
      }
      break;
    case 'webview-lifecycle-change': // 更新挂载状态
      mergeGlobalVars(message.data);
      break;
    case 'data-update':
      properties.panel!.webview.postMessage({ type: 'vscode-params-channel', data: properties });
      break;
    case 'execute-in-current':
      const cmd = message.command;
      runCommand(cmd, message.type);
    case 'execute-in-terminal':
      const terminal = vscode.window.activeTerminal;
      console.log('.terminal',terminal)
      if (!terminal) {
        vscode.window.showWarningMessage('没有活动终端。');
        return;
      }
      terminal.dispose();
      break;
  }
}

function runCommand(command: any, type: OpenMode = OpenMode.NEW) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const cwd = workspaceFolders ? properties.rootFilePath : process.cwd();
  const terminal = vscode.window.terminals.length && type === OpenMode.CURRENT ? vscode.window.activeTerminal : vscode.window.createTerminal({ name: '命令执行终端', cwd });
  terminal!.show();
  terminal!.sendText(command);
}
