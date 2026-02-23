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
import { DebugConsoleFeature } from '../features/DebugConsoleFeature'

export class QuickOpsApplication {
  private context: vscode.ExtensionContext;

  // 维护服务和功能的列表，方便统一管理生命周期
  private services: IService[] = [];
  private features: IFeature[] = [];

  constructor(context: vscode.ExtensionContext) {
    this.context = context;

    this.services = [ConfigurationService.getInstance(), WorkspaceStateService.getInstance(), EditorContextService.getInstance(), TerminalExecutor.getInstance()];

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
      new DebugConsoleFeature()
    ];
  }

  /**
   * 启动应用
   */
  public async start() {
    ColorLog.black('[QuickOps]', 'Application Starting...');
    console.time();

    // 1. 初始化服务 (Initialization)
    // 某些服务可能需要异步加载配置或状态
    for (const service of this.services) {
      try {
        //@ts-ignore
        await service.init(this.context);
      } catch (error) {
        console.error(`[Service] ${service.serviceId} failed to init:`, error);
      }
    }

    // 2. 激活功能 (Activation)
    // 注册 VS Code 命令、事件监听器、Provider 等
    for (const feature of this.features) {
      try {
        feature.activate(this.context);
      } catch (error) {
        console.error(`[Feature] ${feature.id} failed to activate:`, error);
      }
    }

    this.setupGlobalDisposables();
    console.timeEnd();
    ColorLog.black('[QuickOps]', '(Refactored) is now active!');
    vscode.window.showInformationMessage('Quick Ops (Refactored) is now active!');
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

    ColorLog.black('[QuickOps]', 'Application Disposed.');
  }
}
