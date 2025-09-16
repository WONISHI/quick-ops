import * as vscode from 'vscode';
import { properties } from '../global-object/properties';
export function registerCodeSnippetsConfig(context: vscode.ExtensionContext) {
  // 准备变量
  const languagesCss = properties.languagesCss;
  const snippets = properties.snippets?.concat(properties.settings?.customSnippets || []) || [];
  const keywords = snippets.map((item) => item.prefix);
  console.log('keywords',keywords)
  //   注册代码片段
  const LANGUAGES: vscode.DocumentSelector = properties.completionDocumentSelector;
  // vscode.languages.registerCompletionItemProvider(
  //   LANGUAGES,
  //   {
  //     async provideCompletionItems(document, position) {
  //       console.log(5555);
  //       return [];
  //     },
  //   },
  //   'vue2', // 触发字符
  // );
}
