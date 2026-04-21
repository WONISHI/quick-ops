import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import { IService } from '../core/interfaces/IService';
import ColorLog from '../utils/ColorLog';

// 引入服务
import { ConfigurationService } from '../services/ConfigurationService';
import { WorkspaceStateService } from '../services/WorkspaceStateService';
import { EditorContextService } from '../services/EditorContextService';
import { TerminalExecutor } from '../services/TerminalExecutor';

// 引入功能模块
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
import { LivePreviewFeature } from '../features/LivePreviewFeature';
import { RecentProjectsFeature } from '../features/RecentProjectsFeature';
import { ComponentIntellisenseFeature } from '../features/ComponentIntellisenseFeature';
import { TextCompareFeature } from '../features/TextCompareFeature';
import { GitFeature } from '../features/GitFeature';
// import { ZeroConfigConsoleFeature } from '../features/InlineConsoleFeature';

export class QuickOpsApplication {
  private readonly context: vscode.ExtensionContext;
  private services: IService[] = [];
  private features: IFeature[] = [];
  private started = false;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  public async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    ColorLog.black('[QuickOps]', 'Application Starting...');

    this.services = [
      ConfigurationService.getInstance(),
      WorkspaceStateService.getInstance(),
      EditorContextService.getInstance(),
      TerminalExecutor.getInstance()
    ];

    for (const service of this.services) {
      try {
        //@ts-ignore
        await service.init?.(this.context);
      } catch (error) {
        console.error(`[Service] ${service.serviceId} failed to init:`, error);
      }
    }

    this.features = [
      new ConfigManagementFeature(),
      new FileNavigationFeature(),
      new SmartScrollFeature(),
      new ClipboardTransformFeature(),
      new LogEnhancerFeature(),
      new EditorHistoryFeature(),
      new MarkDecorationFeature(),
      new DebugConsoleFeature(),
      new AnchorFeature(),
      new MockServerFeature(),
      new PackageScriptsFeature(),
      new StyleGeneratorFeature(),
      new ProjectExportFeature(),
      new CodeSnippetFeature(),
      new SnippetGeneratorFeature(),
      new LivePreviewFeature(),
      new RecentProjectsFeature(),
      new ComponentIntellisenseFeature(),
      new TextCompareFeature(),
      new GitFeature(),
      // new ZeroConfigConsoleFeature()
    ];

    for (const feature of this.features) {
      try {
        await feature.activate(this.context);
      } catch (error) {
        console.error(`[Feature] ${feature.id} failed to activate:`, error);
      }
    }

    this.setupGlobalDisposables();

    ColorLog.black('[QuickOps]', 'Application started successfully.');
  }

  private setupGlobalDisposables(): void {
    this.context.subscriptions.push({
      dispose: () => {
        void this.dispose();
      }
    });
  }

  public async dispose(): Promise<void> {
    for (let i = this.features.length - 1; i >= 0; i--) {
      try {
        await this.features[i].dispose?.();
      } catch (error) {
        console.error(error);
      }
    }

    for (let i = this.services.length - 1; i >= 0; i--) {
      try {
        await this.services[i].dispose?.();
      } catch (error) {
        console.error(error);
      }
    }

    this.features = [];
    this.services = [];
    this.started = false;

    ColorLog.red('[QuickOps]', 'Application Disposed.');
  }
}