import * as vscode from 'vscode';
import * as path from 'path';
import { registerConfig } from './register/register-config';
import { decorationType, registerAreaSearch } from './register/register-area-search';
import { registerCompletion } from './register/register-completion';
import { registerExtension } from './register/register-extension';
import type { EnvConfProps } from './types/EnvConf';
import { properties, initProperties } from './global-object/properties';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export function activate(context: vscode.ExtensionContext) {
  initProperties(vscode.window.activeTextEditor?.document!);

  const serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'));
  const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };
  const serverOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'javascript' },
      { scheme: 'file', language: 'typescript' },
      { scheme: 'file', language: 'javascriptreact' },
      { scheme: 'file', language: 'typescriptreact' },
      { scheme: 'file', language: 'vue' },
      { scheme: 'file', language: 'html' },
    ],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/.clientrc'),
    },
  };

  client = new LanguageClient('languageServerExample', 'Language Server Example', serverOptions, clientOptions);

  client.start().catch((err) => {
    vscode.window.showErrorMessage(`Language Server 启动失败: ${err.message}`);
    console.error('LanguageClient start error:', err);
  });

  vscode.workspace.onDidChangeTextDocument((e) => {
    properties.content = e.document.getText();
  });

  registerConfig(context)?.then((res: EnvConfProps) => {
    registerAreaSearch(context, res);
    registerCompletion(context, res);
    registerExtension(context, res);
  });
}

export async function deactivate() {
  if (client && client.state === 2) { // 2 = Running
    await client.stop();
  }
  if (decorationType) {
    decorationType.dispose();
  }
}


