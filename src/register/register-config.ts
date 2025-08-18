import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { registerLogrcConfig, onDidChangeLogrcConfig } from '../utils/readLogrcConfig';
import mergeClone from '../utils/mergeClone';
import type { EnvConf, EnvConfProps } from '../types/EnvConf';
import { setEnvConf } from '../global-object/envconfig';

export function registerConfig(context: vscode.ExtensionContext) {
  let configContext = null;
  const pkgPath = path.join(context.extensionPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const id = `${pkg.publisher}.${pkg.name}`;
  const extensionPath = vscode.extensions.getExtension(id)?.extensionPath;

  registerLogrcConfig(context);
  return new Promise<EnvConfProps>(async (resolve) => {
    if (extensionPath) {
      const pluginConfig = path.join(extensionPath, '.logrc');
      if (fs.existsSync(pluginConfig)) {
        const document = await vscode.workspace.openTextDocument(pluginConfig);
        configContext = JSON.parse(document.getText()) as Partial<EnvConf>;
        setEnvConf([configContext, configContext]);
        resolve([configContext, configContext]);
      }
    }
    onDidChangeLogrcConfig((cfg: Partial<EnvConf>) => {
      setEnvConf([mergeClone(configContext!, cfg), configContext!]);
      resolve([mergeClone(configContext!, cfg), configContext!]);
    });
  });
}
