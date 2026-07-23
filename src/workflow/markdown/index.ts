import * as path from 'path';
import { MARKDOWN_WORKFLOW_EVENTS } from '@/workflow/markdown/type';
import type { ETIRuntime, ETIRuntimeProvide } from '@core/eti/eti.type';
import type {
  MarkdownProcessEventContext,
  MarkdownProcessResult,
  MarkdownRestoreEventContext,
  MarkdownRestoreOptions,
  MarkdownSetupOptions,
  MarkdownWorkflowEventContext,
} from '@/workflow/markdown/type';

export default class MarkdownWorkflow implements ETIRuntime {
  private static instance: MarkdownWorkflow | null = null;

  public readonly runtimeId = 'markdown';

  private events: Record<string, Function[]> = {};

  constructor() {
    if (MarkdownWorkflow.instance) {
      return MarkdownWorkflow.instance;
    }

    MarkdownWorkflow.instance = this;
  }

  public provide(): ETIRuntimeProvide {
    return {
      runtimeId: this.runtimeId,
      register: [
        {
          name: MARKDOWN_WORKFLOW_EVENTS.PROCESS,
          callback: this.emitProcess.bind(this),
        },
        {
          name: MARKDOWN_WORKFLOW_EVENTS.RESTORE,
          callback: this.emitRestore.bind(this),
        },
      ],
      global: {
        setupMarkdown: this.setupMarkdown.bind(this),
        restoreMarkdown: this.restoreMarkdown.bind(this),
      },
    };
  }

  public inject(events: Record<string, Function[]>): void {
    this.events = events;
  }

  public async setupMarkdown(options: MarkdownSetupOptions): Promise<MarkdownProcessResult> {
    const result: MarkdownProcessResult = {
      content: options.content,
      fsPath: options.fsPath,
      mdDir: path.dirname(options.fsPath),
      workspaceRoot: options.workspaceRoot || '',
      webview: options.webview,
      assets: {},
    };

    await this.emitProcess({
      options,
      result,
    });

    return result;
  }

  public async restoreMarkdown(options: MarkdownRestoreOptions): Promise<string> {
    const result = {
      content: options.content,
      assets: options.assets,
    };

    await this.emitRestore({
      options,
      result,
    });

    return result.content;
  }

  private async emitProcess(context: MarkdownProcessEventContext): Promise<void> {
    await this.emit(MARKDOWN_WORKFLOW_EVENTS.PROCESS, context);
  }

  private async emitRestore(context: MarkdownRestoreEventContext): Promise<void> {
    await this.emit(MARKDOWN_WORKFLOW_EVENTS.RESTORE, context);
  }

  private async emit(name: string, context: MarkdownWorkflowEventContext): Promise<void> {
    const callbacks = this.events[name] || [];

    for (const callback of callbacks) {
      await callback(context);
    }
  }
}
