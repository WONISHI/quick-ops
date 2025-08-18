import * as vscode from 'vscode';
import type { EnvConfProps } from '../types/EnvConf';
import { properties } from '../global-object/properties';
import provideCompletions from '../module/log';
import { moveCursor } from '../utils/index';
import { moduleConfig } from '../utils/moduleTemplate';

const LANGUAGES = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'vue'];

export function registerCompletion(context: vscode.ExtensionContext, configs: EnvConfProps) {
  // 补全插入完成触发的事件
  const disposable = vscode.commands.registerCommand(
    'scope-search.onCompletionSelected',
    (line: number, character: number) => {
      moveCursor(line, character);
    },
  );

  // 注册代码补全
  const provider: any = vscode.languages.registerCompletionItemProvider(LANGUAGES, {
    provideCompletionItems(document, position) {
      const moduleName = properties.fileName.split(properties.fileType)[0].split('.')[0];
      const provideCompletionsList: vscode.CompletionItem[] = [];
      for (let item of provideCompletions) {
        const configItem = item(position);
        if (typeof configItem.insertText === 'string') {
          configItem.insertText = new vscode.SnippetString(configItem.insertText.replace(/\{module-name/g, moduleName));
        }
        if (configItem.checkFn) {
          if (configItem.checkFn(properties)) {
            provideCompletionsList.push(configItem);
          }
        } else {
          provideCompletionsList.push(configItem);
        }
      }
      return [...provideCompletionsList];
    },
  });

  context.subscriptions.push(provider, disposable);
}
