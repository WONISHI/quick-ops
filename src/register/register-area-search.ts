import * as vscode from "vscode";

export let decorationType: vscode.TextEditorDecorationType =
  vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(255, 255, 0, 0.3)",
    borderRadius: "2px",
  });

export const registerAreaSearch = (context: vscode.ExtensionContext) => {
  // 打开搜索框需要重置样式
  vscode.commands.registerCommand("actions.find", () => {
    resetHighlight();
  });

  // 1. 注册搜索命令-区域搜索指令
  const searchCommand = vscode.commands.registerCommand(
    "scope-search.search",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("没有激活的编辑器");
        return;
      }
      const selection = editor.selection;
      if (selection.isEmpty) {
        vscode.window.showWarningMessage("请先选中文本");
        return;
      }
      const text = editor.document.getText(selection);

      const result = await vscode.window.showInputBox({
        prompt: "请输入正则表达式（无需加 //，默认全局匹配）",
        placeHolder: "例如 foo|bar",
        validateInput: (input) => (input.trim() === "" ? "输入不能为空" : null),
      });
      if (result === undefined) {
        vscode.window.showInformationMessage("用户取消输入");
        return;
      }

      let regex: RegExp;
      try {
        regex = new RegExp(result, "g");
      } catch {
        vscode.window.showErrorMessage("无效的正则表达式");
        return;
      }

      const startOffset = editor.document.offsetAt(selection.start);
      const decorationsArray: vscode.DecorationOptions[] = [];

      let match;
      while ((match = regex.exec(text)) !== null) {
        const matchStart = startOffset + match.index;
        const matchEnd = matchStart + match[0].length;
        const startPos = editor.document.positionAt(matchStart);
        const endPos = editor.document.positionAt(matchEnd);
        decorationsArray.push({
          range: new vscode.Range(startPos, endPos),
          hoverMessage: `匹配关键字: **${match[0]}**`,
        });
        // 防止死循环，空匹配时跳过
        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }
      }

      editor.setDecorations(decorationType, decorationsArray);

      vscode.window.showInformationMessage(
        `匹配到 ${decorationsArray.length} 处，输入的正则：${result}`
      );
    }
  );

  // 2. 注册重置高亮命令
  const resetCommand = vscode.commands.registerCommand(
    "scope-search.resetHighlight",
    () => {
      resetHighlight();
    }
  );
  function resetHighlight() {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      editor.setDecorations(decorationType, []);
      vscode.window.showInformationMessage("已清除搜索高亮");
    }
  }

  context.subscriptions.push(searchCommand, resetCommand);
};
