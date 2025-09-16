import { fileTypes } from './../types/utils';
import { properties } from './../global-object/properties';
import * as vscode from 'vscode';
import { matchKeyword } from '../utils/index';
import extendCompletionItem from '../utils/extendCompletionItem';

/**
 * 替换字符串中 ${} 内容为指定值
 * @param str 原字符串
 * @param values 替换对象，key 为变量名，value 为替换值
 */
function replaceTemplateVariables(str: string) {
  return str.replace(/\$\{([^}]+)\}/g, (_, key) => {
    const k = key as keyof typeof properties;
    return properties[k] ?? '';
  });
}

function parseFieldValue(texts: string[]) {
  if (!texts.length) return '';
  const regex = /\$\{([^}]+)\}/g;
  return texts.reduce((prev, item) => {
    if (regex.test(item)) {
      prev += replaceTemplateVariables(item);
    }
    prev += item;
    return prev;
  }, '');
}

export function registerCodeSnippetsConfig(context: vscode.ExtensionContext) {
  // 准备变量
  const languagesCss = properties.languagesCss;
  const snippets = properties.snippets?.concat(properties.settings?.customSnippets || []) || [];
  const keywords = snippets.map((item) => item.prefix);
  //   注册代码片段
  const LANGUAGES: vscode.DocumentSelector = properties.completionDocumentSelector;
  const completionSnippets = vscode.languages.registerCompletionItemProvider(
    LANGUAGES,
    {
      async provideCompletionItems(document, position) {
        const lineText = document.lineAt(position).text.trim();
        if (matchKeyword(keywords, String(lineText))) {
          try {
            const provideCompletionsList: vscode.CompletionItem[] = [];
            // 先处理默认的
            if (properties.snippets!.length) {
              const data = properties.snippets!.reduce<any[]>((prev, item) => {
                const sn = new extendCompletionItem(item.prefix);
                sn.detail = item.description;
                sn.filterText = item.prefix;
                sn.commitCharacters = ['\t'];
                sn.insertText = parseFieldValue(item.body);
                sn.checkFn = () => {
                  const [fileType = 'js', projectType = 'vue'] = item.scope;
                  if (properties.fileType !== fileType) return false;
                  return true;
                };
                prev.push(sn);
                return prev;
              }, []);
              provideCompletionsList.concat(data);
            }
          } catch (err) {
            console.log(err);
          }
        }
        return [];
      },
    },
    ...keywords, // 触发字符
  );
}
