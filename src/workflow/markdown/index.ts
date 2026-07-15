import * as path from 'path';
import { MARKDOWN_WORKFLOW_EVENTS } from '@/workflow/markdown/type';
import type { ETIRuntime, ETIRuntimeProvide } from '@core/eti/eti.type';
import type { MarkdownProcessResult, MarkdownSetupOptions, MarkdownWorkflowEventContext } from '@/workflow/markdown/type';

/**
 * @description Markdown 工作函数 Runtime
 *
 * 用途：
 * - 统一创建 Markdown 处理上下文
 * - 统一触发 Markdown Plugin
 * - 通过 provide() 注册 Markdown 处理事件
 * - 通过 inject() 接收 Plugin 监听器
 *
 * Plugin 可以监听：
 * - markdown:process
 *
 * 对外暴露：
 * - setupMarkdown
 */
export default class MarkdownWorkflow implements ETIRuntime {
  /**
   * @description MarkdownWorkflow 单例实例
   *
   * 保证：
   * - ETI 调用 inject() 的实例
   * - 业务代码 new MarkdownWorkflow() 的实例
   * 是同一个实例。
   */
  private static instance: MarkdownWorkflow | null = null;

  public readonly runtimeId = 'markdown';

  /**
   * @description ETI 注入的 Markdown Plugin 监听器
   */
  private events: Record<string, Function[]> = {};

  /**
   * @description 单例构造
   *
   * 保留公开构造函数，兼容业务代码：
   *
   * new MarkdownWorkflow()
   */
  constructor() {
    if (MarkdownWorkflow.instance) {
      return MarkdownWorkflow.instance;
    }

    MarkdownWorkflow.instance = this;
  }

  /**
   * @description 注册 Markdown 工作函数
   *
   * register：
   * - 声明 Plugin 可以监听的 Markdown 事件
   *
   * global：
   * - 暴露 setupMarkdown 方法
   */
  public provide(): ETIRuntimeProvide {
    return {
      runtimeId: this.runtimeId,
      register: [
        {
          name: MARKDOWN_WORKFLOW_EVENTS.PROCESS,
          callback: this.emitProcess.bind(this),
        },
      ],
      global: {
        setupMarkdown: this.setupMarkdown.bind(this),
      },
    };
  }

  /**
   * @description ETI 注入 Markdown Plugin 监听器
   */
  public inject(events: Record<string, Function[]>): void {
    this.events = events;
  }

  /**
   * @description 处理 Markdown
   *
   * 执行流程：
   * 1. 创建 MarkdownProcessResult
   * 2. 触发 markdown:process
   * 3. Plugin 按注入顺序依次处理 result
   * 4. 返回最终处理结果
   */
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

  /**
   * @description 触发 Markdown 处理事件
   */
  private async emitProcess(context: MarkdownWorkflowEventContext): Promise<void> {
    await this.emit(MARKDOWN_WORKFLOW_EVENTS.PROCESS, context);
  }

  /**
   * @description 执行指定 Markdown 事件的全部 Plugin
   */
  private async emit(name: string, context: MarkdownWorkflowEventContext): Promise<void> {
    const callbacks = this.events[name] || [];

    for (const callback of callbacks) {
      await callback(context);
    }
  }
}
