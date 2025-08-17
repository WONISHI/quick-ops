import * as vscode from 'vscode';
import type { EnvConfProps } from '../types/EnvConf';
import { properties } from '../global-object/properties';
import moduleConfig from '../module/log';

const LANGUAGES = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'vue'];

export function registerCompletion(context: vscode.ExtensionContext, configs: EnvConfProps) {
  // 补全插入完成触发的事件
  const disposable = vscode.commands.registerCommand('scope-search.onCompletionSelected', (itemLabel: string) => {
    console.log(itemLabel);
    vscode.window.showInformationMessage(`你选择了补全项: ${itemLabel}`);
  });

  // 注册代码补全
  const provider = vscode.languages.registerCompletionItemProvider(LANGUAGES, {
    provideCompletionItems(document, position) {
      const moduleName = properties.fileName.split(properties.fileType)[0].split('.')[0];
      const moduleConfigList: vscode.CompletionItem[] = [];
      for (let item of moduleConfig) {
        const configItem = item(position);
        if (typeof configItem.insertText === 'string') {
          configItem.insertText = new vscode.SnippetString(configItem.insertText.replace(/\{module-name/g, moduleName));
        }
        if (configItem.checkFn) {
          if (configItem.checkFn(properties)) {
            moduleConfigList.push(configItem);
          }
        } else {
          moduleConfigList.push(configItem);
        }
      }
      return [...moduleConfigList];
    },
  });

  context.subscriptions.push(provider, disposable);
}
