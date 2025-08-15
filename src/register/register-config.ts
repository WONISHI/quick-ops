import * as vscode from 'vscode';
import { registerLogrcConfig, onDidChangeLogrcConfig } from '../utils/readLogrcConfig';

export function registerConfig(context: vscode.ExtensionContext) {
  registerLogrcConfig(context);
  onDidChangeLogrcConfig((cfg) => {
    console.log('配置变更了:', cfg);
  });
}
