import * as vscode from 'vscode';
import type { EnvConfProps } from '../types/EnvConf';
import { properties } from '../global-object/properties';
import moduleConfig from '../module/log';

const LANGUAGES = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'vue'];

export function registerCompletion(context: vscode.ExtensionContext, configs: EnvConfProps) {
  // 注册代码补全
  const provider = vscode.languages.registerCompletionItemProvider(LANGUAGES, {
    provideCompletionItems(document, position) {
      const moduleName = properties.fileName.split(properties.fileType)[0].split('.')[0];
      const moduleConfigList: vscode.CompletionItem[] = [];
      // console.log('moduleName', moduleName,moduleConfig);
      for (let item of moduleConfig) {
        const configItem = item(position);
        console.log('configItem', configItem, typeof configItem.insertText);
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
      console.log('moduleConfigList', moduleConfigList);
      return [...moduleConfigList];
    },
  });

  context.subscriptions.push(provider);
}
