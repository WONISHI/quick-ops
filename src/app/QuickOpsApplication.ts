import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import { IService } from '../core/interfaces/IService';
import ColorLog from '../utils/ColorLog';

// 1. 引入服务
import { ConfigurationService } from '../services/ConfigurationService';
import { WorkspaceStateService } from '../services/WorkspaceStateService';
import { EditorContextService } from '../services/EditorContextService';
import { TerminalExecutor } from '../services/TerminalExecutor';

// 2. 引入功能模块
import { SmartScrollFeature } from '../features/SmartScrollFeature';
import { CodeSnippetFeature } from '../features/CodeSnippetFeature';
import { ProjectExportFeature } from '../features/ProjectExportFeature';
import { FileNavigationFeature } from '../features/FileNavigationFeature';
import { ConfigManagementFeature } from '../features/ConfigManagementFeature';
import { LogEnhancerFeature } from '../features/LogEnhancerFeature';
import { PackageScriptsFeature } from '../features/PackageScriptsFeature';
import { MarkDecorationFeature } from '../features/MarkDecorationFeature';
import { StyleGeneratorFeature } from '../features/StyleGeneratorFeature';
import { AnchorFeature } from '../features/AnchorFeature';
import { SnippetGeneratorFeature } from '../features/SnippetGeneratorFeature';
import { ClipboardTransformFeature } from '../features/ClipboardTransformFeature';
import { EditorHistoryFeature } from '../features/EditorHistoryFeature';
import { MockServerFeature } from '../features/MockServerFeature';
import { DebugConsoleFeature } from '../features/DebugConsoleFeature';

export class QuickOpsApplication {
  private context: vscode.ExtensionContext;

  // 维护服务和功能的列表，方便统一管理生命周期
  private services: IService[] = [];
  private features: IFeature[] = [];

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    // 🌟 优化：不在 constructor 中 new，将内存分配延后到 start 阶段
  }

  /**
   * 启动应用
   */
  public async start() {
    ColorLog.black('[QuickOps]', 'Application Starting...');
    console.time('QuickOps Activation');

    this.services = [
        ConfigurationService.getInstance(), 
        WorkspaceStateService.getInstance(), 
        EditorContextService.getInstance(), 
        TerminalExecutor.getInstance()
    ];

    this.features = [
      new SmartScrollFeature(),
      new CodeSnippetFeature(),
      new ProjectExportFeature(),
      new FileNavigationFeature(),
      new ConfigManagementFeature(),
      new LogEnhancerFeature(),
      new PackageScriptsFeature(),
      new MarkDecorationFeature(),
      new StyleGeneratorFeature(),
      new AnchorFeature(),
      new SnippetGeneratorFeature(),
      new ClipboardTransformFeature(),
      new EditorHistoryFeature(),
      new MockServerFeature(),
      new DebugConsoleFeature(),
    ];

    // 1. 初始化核心服务 (Initialization)
    for (const service of this.services) {
      try {
        //@ts-ignore
        await service.init(this.context);
      } catch (error) {
        console.error(`[Service] ${service.serviceId} failed to init:`, error);
      }
    }

    // 2. 激活功能 (Activation) - 🌟 性能优化：分片激活 & 让出主线程
    for (let i = 0; i < this.features.length; i++) {
      const feature = this.features[i];
      try {
        feature.activate(this.context);
      } catch (error) {
        console.error(`[Feature] ${feature.id} failed to activate:`, error);
      }

      // 🌟 核心优化：每同步激活 3 个功能模块，就利用宏任务队列强行中断一次阻塞。
      // 这能把 CPU 的控制权短暂交还给 VS Code 主进程，用于处理页面渲染和用户的键盘输入。
      // 彻底消除插件加载时可能导致的界面卡死问题！
      if ((i + 1) % 3 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    this.setupGlobalDisposables();
    console.timeEnd('QuickOps Activation');
    ColorLog.black('[QuickOps]', '(Refactored) is now active!');
    
  }

  private setupGlobalDisposables() {
    // 如果有一些不属于特定 Feature 的全局清理逻辑放这里
  }

  /**
   * 销毁应用
   */
  public dispose() {
    // 遵循 "先注册后销毁" 的逆序原则 (LIFO)

    // 1. 销毁功能
    for (let i = this.features.length - 1; i >= 0; i--) {
      try {
        this.features[i].dispose?.();
      } catch (e) {
        console.error(`Error disposing feature ${this.features[i].id}`, e);
      }
    }

    // 2. 销毁服务
    for (let i = this.services.length - 1; i >= 0; i--) {
      try {
        this.services[i].dispose?.();
      } catch (e) {
        console.error(`Error disposing service ${this.services[i].serviceId}`, e);
      }
    }

    ColorLog.red('[QuickOps]', 'Application Disposed.');
  }
}