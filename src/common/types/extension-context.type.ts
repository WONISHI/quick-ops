import * as vscode from 'vscode';

export interface OpenWorkspaceTextDocumentAtLineOptions {
  /**
   * @description 打开文件时使用的编辑器列
   */
  viewColumn?: vscode.ViewColumn;

  /**
   * @description 是否以预览模式打开
   */
  preview?: boolean;

  /**
   * @description 跳转到目标行后的滚动展示方式
   */
  revealType?: vscode.TextEditorRevealType;
}