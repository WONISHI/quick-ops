import type * as vscode from 'vscode';

/**
 * @description Markdown 工作函数事件
 */
export const MARKDOWN_WORKFLOW_EVENTS = {
  /**
   * @description 处理 Markdown 内容
   *
   * 所有 Markdown Plugin 都监听该事件，
   * 并按照 ETI 注入顺序依次修改 result。
   */
  PROCESS: 'markdown:process',
} as const;

/**
 * @description Markdown 工作函数事件名称
 */
export type MarkdownWorkflowEventName = (typeof MARKDOWN_WORKFLOW_EVENTS)[keyof typeof MARKDOWN_WORKFLOW_EVENTS];

/**
 * @description Markdown 工作函数参数
 */
export interface MarkdownSetupOptions {
  /**
   * @description Markdown 原始内容
   */
  content: string;

  /**
   * @description Markdown 文件绝对路径
   */
  fsPath: string;

  /**
   * @description 当前工作区根目录
   */
  workspaceRoot?: string;

  /**
   * @description 当前 Webview
   *
   * Markdown 图片转为 Webview URI 时使用。
   */
  webview?: vscode.Webview;
}

/**
 * @description Markdown 工作函数处理结果
 *
 * Plugin 可以直接修改 content 和 assets。
 */
export interface MarkdownProcessResult {
  /**
   * @description 当前 Markdown 内容
   */
  content: string;

  /**
   * @description Markdown 文件绝对路径
   */
  fsPath: string;

  /**
   * @description Markdown 文件所在目录
   */
  mdDir: string;

  /**
   * @description 当前工作区根目录
   */
  workspaceRoot: string;

  /**
   * @description 当前 Webview
   */
  webview?: vscode.Webview;

  /**
   * @description Webview 图片地址与 Markdown 原始地址映射
   */
  assets: Record<string, string>;
}

/**
 * @description Markdown Workflow 传递给 Plugin 的上下文
 */
export interface MarkdownWorkflowEventContext {
  /**
   * @description 本次 setupMarkdown 的原始参数
   */
  options: MarkdownSetupOptions;

  /**
   * @description 当前 Markdown 处理结果
   *
   * Plugin 直接修改该对象即可。
   */
  result: MarkdownProcessResult;
}

/**
 * @description MarkdownWorkflow 通过 runtime.global 暴露的方法
 */
export interface MarkdownWorkflowGlobal {
  /**
   * @description 处理 Markdown
   */
  setupMarkdown(options: MarkdownSetupOptions): Promise<MarkdownProcessResult>;
}
