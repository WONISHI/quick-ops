import * as vscode from 'vscode';
import { properties } from '../global-object/properties';

// 定义不同标识符的样式
const decorationStyles: Record<string, vscode.TextEditorDecorationType> = {
  success: vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(76, 175, 80, 0.3)',
    color: '#ffffff',
    borderRadius: '2px',
  }),
  warning: vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 193, 7, 0.3)',
    color: '#ff6f00',
    borderRadius: '2px',
  }),
  error: vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(244, 67, 54, 0.3)',
    color: '#b71c1c',
    borderRadius: '2px',
  }),
  head: vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(33, 150, 243, 0.3)',
    color: '#0d47a1',
    borderRadius: '2px',
  }),
};

// 扫描文档并应用装饰
function decorateAnnotations(editor: vscode.TextEditor) {
  if (!editor) return;
  const doc = editor.document;
  const decorationsMap: Record<string, vscode.DecorationOptions[]> = {};
  // 初始化
  properties.identifiers.forEach((id) => (decorationsMap[id] = []));
  for (let line = 0; line < doc.lineCount; line++) {
    const text = doc.lineAt(line).text;
    properties.identifiers.forEach((id) => {
      const regex = new RegExp(`@${id}:`, 'g');
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const startPos = new vscode.Position(line, match.index);
        const endPos = new vscode.Position(line, match.index + match[0].length);
        decorationsMap[id].push({ range: new vscode.Range(startPos, endPos) });
      }
    });
  }
  // 应用装饰
  properties.identifiers.forEach((id) => {
    editor.setDecorations(decorationStyles[id], decorationsMap[id]);
  });
}

// 注册监听
export function registerMark(context: vscode.ExtensionContext) {
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    decorateAnnotations(activeEditor);
  }
  const updateDecorations = (editor: vscode.TextEditor) => {
    if (!editor) return;
    decorateAnnotations(editor); // 之前写的装饰函数
  };

  // 监听光标切换和文档变化
  // 切换编辑器时
  vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor) updateDecorations(editor);
  });

  // 文档变化时
  vscode.workspace.onDidChangeTextDocument((event) => {
    const editor = vscode.window.activeTextEditor;
    if (editor && event.document === editor.document) {
      updateDecorations(editor);
    }
  });
}
