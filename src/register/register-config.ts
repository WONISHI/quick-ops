import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { registerLogrcConfig, onDidChangeLogrcConfig } from '../utils/readLogrcConfig';

export async function registerConfig(context: vscode.ExtensionContext) {
  const pkgPath = path.join(context.extensionPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const id = `${pkg.publisher}.${pkg.name}`;
  const extensionPath = vscode.extensions.getExtension(id)?.extensionPath;
  if (extensionPath) {
    const pluginConfig = path.join(extensionPath, '.logrc');
    if (fs.existsSync(pluginConfig)) {
      const document = await vscode.workspace.openTextDocument(pluginConfig);
      console.log(document.getText());
    }
  }

  registerLogrcConfig(context);
  onDidChangeLogrcConfig((cfg) => {
    console.log('配置变更了:', cfg);
  });
}
