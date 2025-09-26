import { properties } from './../global-object/properties';
import * as vscode from 'vscode';
import { matchKeyword } from '../utils/index';
import extendCompletionItem from '../utils/extendCompletionItem';
import type { FileType } from '../types/utils';
/**
 * 替换字符串中 ${} 内容为指定值
 * @param str 原字符串
 * @param values 替换对象，key 为变量名，value 为替换值
 */
function replaceTemplateVariables(str: string) {
  return str.replace(/\[\[(.+?)\]\]/g, (_, key) => {
    const k = key as keyof typeof properties;
    return !!properties[k] ? `"${properties[k]}"` : '';
  });
}

function parseFieldValue(texts: string[]) {
  if (!texts.length) return '';
  const regex = /\[\[(.+?)\]\]/g;
  return texts.reduce((prev, item) => {
    if (regex.test(item)) {
      prev += replaceTemplateVariables(item) + '\n';
    } else {
      prev += item + '\n';
    }
    return prev;
  }, '');
}

export function registerCodeSnippetsConfig(context: vscode.ExtensionContext) {
  // 准备变量
  const snippets = properties.snippets?.concat(properties.settings?.customSnippets || []) || [];
  // 获取插件自带的关键字
  const keywords = snippets.map((item) => item.prefix).concat();
  //   注册代码片段
  const LANGUAGES: vscode.DocumentSelector = properties.completionDocumentSelector;
  const completionSnippets = vscode.languages.registerCompletionItemProvider(
    LANGUAGES,
    {
      async provideCompletionItems(document, position) {
        const lineText = document.lineAt(position).text.trim();
        if (matchKeyword(keywords, String(lineText))) {
          try {
            const moduleName = properties.fileName.split(properties.fileType as FileType)[0].split('.')[0];
            const provideCompletionsList: vscode.CompletionItem[] = [];
            const completionData = properties.snippets;
            if (properties.settings?.customSnippets?.length) {
              completionData?.concat(properties.settings!.customSnippets!);
            }
            const data = completionData!.reduce<any[]>((prev, item) => {
              const sn = new extendCompletionItem(item.prefix);
              const body = parseFieldValue(item.body);
              sn.detail = item.description;
              sn.kind = vscode.CompletionItemKind.Snippet;
              // language:
              /**
               * 前端：html、vue （需要装 Volar / Vetur）、css、scss、less、javascript / js、typescript / ts、jsx （React JSX）、tsx （React TSX）、json、jsonc （带注释的 JSON）、markdown、yaml、xml
               */
              sn.documentation = new vscode.MarkdownString().appendCodeblock(body, item.style || 'vue');
              sn.filterText = item.prefix;
              sn.commitCharacters = ['\t'];
              sn.insertText = body;
              sn.checkFn = () => {
                try {
                  if (!item.scope) return true;
                  const [fileType = 'js', projectType = 'vue'] = item.scope;
                  if ((Array.isArray(fileType) && !fileType.includes(properties.fileType)) || properties.fileType !== fileType) return false;
                  if (!properties.keywords!.includes(projectType)) {
                    return false;
                  }
                  if (Array.isArray(projectType)) {
                    const is = projectType.some((k) => properties.keywords?.includes(k));
                    return is;
                  }
                  return true;
                } catch (err) {
                  console.log('err', err);
                  return false;
                }
              };
              prev.push(sn);
              return prev;
            }, []);
            for (let i = 0; i < data.length; i++) {
              const item = data[i];
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
            console.log(err);
          }
        }
        return [];
      },
    },
    ...keywords, // 触发字符
  );
  context.subscriptions.push(completionSnippets);
}
