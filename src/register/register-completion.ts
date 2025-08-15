import * as vscode from 'vscode';

const LANGUAGES = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'vue'];

export function registerCompletion(context: vscode.ExtensionContext) {
  // 注册代码补全
  const provider = vscode.languages.registerCompletionItemProvider(
    ['javascript', 'javascriptreact', 'typescript', 'typescriptreact'],
    {
      provideCompletionItems(document, position) {
        const completionItem = new vscode.CompletionItem('hello world');
        return [completionItem];
      },
    },
    'g'
  );

  context.subscriptions.push(provider);
}
