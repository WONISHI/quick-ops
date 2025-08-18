import * as vscode from 'vscode';

export function registerTop(context: vscode.ExtensionContext){
     // 滚动到顶部
    context.subscriptions.push(
        vscode.commands.registerCommand('myExtension.scrollToTop', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const topLine = new vscode.Position(0, 0);
            editor.selection = new vscode.Selection(topLine, topLine);
            editor.revealRange(
                new vscode.Range(topLine, topLine),
                vscode.TextEditorRevealType.AtTop
            );
        })
    );

    // 滚动到底部
    context.subscriptions.push(
        vscode.commands.registerCommand('myExtension.scrollToBottom', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const lastLineIndex = editor.document.lineCount - 1;
            const lastLine = new vscode.Position(lastLineIndex, 0);
            editor.selection = new vscode.Selection(lastLine, lastLine);
            editor.revealRange(
                new vscode.Range(lastLine, lastLine),
                vscode.TextEditorRevealType.InCenter
            );
        })
    );
}