import * as vscode from 'vscode';
import type { EnvConfProps } from './types/EnvConf';
import { properties, initProperties } from './global-object/properties';
import { registerConfig } from './register/register-config';
import { decorationType, registerAreaSearch } from './register/register-area-search';
import { registerCompletion } from './register/register-completion';
import { registerExtension } from './register/register-extension';
import { registerTop } from './register/register-top';

export function activate(context: vscode.ExtensionContext) {
  initProperties(vscode.window.activeTextEditor?.document!);

  // const serverModule = context.asAbsolutePath(path.join('out', 'server.js'));
  // const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };
  // const serverOptions = {
  //   run: { module: serverModule, transport: TransportKind.ipc },
  //   debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions },
  // };

  // const clientOptions: LanguageClientOptions = {
  //   documentSelector: [
  //     { scheme: 'file', language: 'javascript' },
  //     { scheme: 'file', language: 'typescript' },
  //     { scheme: 'file', language: 'javascriptreact' },
  //     { scheme: 'file', language: 'typescriptreact' },
  //     { scheme: 'file', language: 'vue' },
  //     { scheme: 'file', language: 'html' },
  //   ],
  //   synchronize: {
  //     fileEvents: vscode.workspace.createFileSystemWatcher('**/.clientrc'),
  //   },
  // };

  // client = new LanguageClient('languageServerExample', 'Language Server Example', serverOptions, clientOptions);

  // client.start().catch((err) => {
  //   vscode.window.showErrorMessage(`Language Server 启动失败: ${err.message}`);
  //   console.error('LanguageClient start error:', err);
  // });

  vscode.workspace.onDidChangeTextDocument((e) => {
    properties.content = e.document.getText();
    properties.fileType = e.document.languageId;
  });

  registerConfig(context)?.then((res: EnvConfProps) => {
    registerAreaSearch(context, res);
    registerCompletion(context, res);
    registerExtension(context, res);
    registerTop(context);
  });
}

export async function deactivate() {
  // if (client && client.state === 2) { // 2 = Running
  //   await client.stop();
  // }
  if (decorationType) {
    decorationType.dispose();
  }
}
