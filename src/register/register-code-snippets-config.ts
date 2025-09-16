import * as vscode from 'vscode';
import { properties } from '../global-object/properties';
export function registerCodeSnippetsConfig(context: vscode.ExtensionContext) {
  // 准备变量
  const languagesCss = properties.languagesCss;
  const snippets = properties.snippets?.concat(properties.settings?.customSnippets || []) || [];
  const keywords = snippets.map((item) => item.prefix);
  //   注册代码片段
  
}
