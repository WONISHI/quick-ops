import type * as vscode from 'vscode';

/**
 * @description Markdown 工作函数事件
 */
export const MARKDOWN_WORKFLOW_EVENTS = {
  /**
   * @description 将 Markdown 中的本地图片路径转换为 Webview URI
   */
  PROCESS: 'markdown:process',

  /**
   * @description 将 Webview URI 恢复为 Markdown 原始图片路径
   */
  RESTORE: 'markdown:restore',
} as const;

export type MarkdownWorkflowEventName = (typeof MARKDOWN_WORKFLOW_EVENTS)[keyof typeof MARKDOWN_WORKFLOW_EVENTS];

export interface MarkdownSetupOptions {
  content: string;
  fsPath: string;
  workspaceRoot?: string;
  webview?: vscode.Webview;
}

export interface MarkdownProcessResult {
  content: string;
  fsPath: string;
  mdDir: string;
  workspaceRoot: string;
  webview?: vscode.Webview;
  assets: Record<string, string>;
}

/**
 * @description Markdown 正向处理事件上下文
 */
export interface MarkdownProcessEventContext {
  options: MarkdownSetupOptions;
  result: MarkdownProcessResult;
}

/**
 * @description Markdown 恢复参数
 */
export interface MarkdownRestoreOptions {
  content: string;
  assets: Record<string, string>;
}

/**
 * @description Markdown 恢复结果
 */
export interface MarkdownRestoreResult {
  content: string;
  assets: Record<string, string>;
}

/**
 * @description Markdown 恢复事件上下文
 */
export interface MarkdownRestoreEventContext {
  options: MarkdownRestoreOptions;
  result: MarkdownRestoreResult;
}

/**
 * @description Markdown Workflow 事件上下文
 */
export type MarkdownWorkflowEventContext = MarkdownProcessEventContext | MarkdownRestoreEventContext;

/**
 * @description MarkdownWorkflow 暴露的方法
 */
export interface MarkdownWorkflowGlobal {
  setupMarkdown(options: MarkdownSetupOptions): Promise<MarkdownProcessResult>;

  restoreMarkdown(options: MarkdownRestoreOptions): Promise<string>;
}
