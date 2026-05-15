import * as vscode from 'vscode';
import * as path from 'path';

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

export type MarkdownPlugin<T = any> = (context: MarkdownProcessResult, options?: T) => void | Promise<void>;

class MarkdownProcessor {
  private plugins: Array<{
    plugin: MarkdownPlugin;
    options?: any;
  }> = [];

  private context: MarkdownProcessResult;

  constructor(options: MarkdownSetupOptions) {
    this.context = {
      content: options.content,
      fsPath: options.fsPath,
      mdDir: path.dirname(options.fsPath),
      workspaceRoot: options.workspaceRoot || '',
      webview: options.webview,
      assets: {},
    };
  }

  public use<T = any>(plugin: MarkdownPlugin<T>, options?: T) {
    this.plugins.push({
      plugin,
      options,
    });

    return this;
  }

  public async end(): Promise<MarkdownProcessResult> {
    for (const item of this.plugins) {
      await item.plugin(this.context, item.options);
    }

    return this.context;
  }
}

export function setupMarkdown(options: MarkdownSetupOptions) {
  return new MarkdownProcessor(options);
}