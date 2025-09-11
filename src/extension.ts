import * as vscode from 'vscode';
import type { EnvConfProps } from './types/EnvConf';
import type { FileType } from './types/utils';
import { properties, initProperties } from './global-object/properties';
import { registerConfig } from './register/register-config';
import { decorationType, registerAreaSearch } from './register/register-area-search';
import { registerCompletion } from './register/register-completion';
import { registerExtension } from './register/register-extension';
import { registerTop } from './register/register-top';
import { registerExport } from './register/register-export';
import { registerLogrcDecoration } from './register/register-logrc-decoration';

export function activate(context: vscode.ExtensionContext) {
  vscode.window.showInformationMessage('插件已激活！');
  initProperties(vscode.window.activeTextEditor?.document!);
  vscode.workspace.onDidChangeTextDocument((e) => {
    properties.content = e.document.getText();
    properties.fileType = e.document.languageId as FileType;
  });
  registerConfig(context);
}

export async function deactivate() {
  if (decorationType) {
    decorationType.dispose();
  }
}
