import * as vscode from 'vscode';
import type { FileType } from '../types/utils';
import { properties } from '../global-object/properties';
import provideCompletions from '../module/log/log';
import { moveCursor, matchKeyword } from '../utils/index';
import { LogSnippetString } from '../module/log/constants';

const LANGUAGES: vscode.DocumentSelector = properties.completionDocumentSelector;
// 获取触发字段
const isTarggetLogs = LogSnippetString.map((item) => item.label);

export function registerCompletion(context: vscode.ExtensionContext) {
  // 补全插入完成触发的事件
  const disposable = vscode.commands.registerCommand('scope-search.onCompletionSelected', (line: number, character: number) => {
    moveCursor(line, character);
  });

  // 注册代码补全
  const provider: any = vscode.languages.registerCompletionItemProvider(LANGUAGES, {
    provideCompletionItems(document, position) {
      const lineText = document.lineAt(position).text.trim();
      if (matchKeyword(isTarggetLogs, String(lineText))) {
        try {
          const moduleName = properties.fileName.split(properties.fileType as FileType)[0].split('.')[0];
          const provideCompletionsList: vscode.CompletionItem[] = [];
          const configItem = provideCompletions(position);
          for (let i = 0; i < configItem.length; i++) {
            const item = configItem[i];
            if (typeof item.insertText === 'string') {
              item.insertText = new vscode.SnippetString(item.insertText.replace(/\{module-name/g, moduleName));
            }
            if (item.checkFn) {
              if (item.checkFn(properties)) {
                provideCompletionsList.push(item);
              }
            } else {
              provideCompletionsList.push(item);
            }
          }
          return [...provideCompletionsList];
        } catch (err) {
          console.log('err', err);
        }
      } else {
        return [];
      }
    },
  });

  context.subscriptions.push(provider, disposable);
}
