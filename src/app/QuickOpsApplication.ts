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
import { TerminalFeature } from '../features/TerminalFeature';
import { ComponentIntellisenseFeature } from '../features/ComponentIntellisenseFeature';
import { TextCompareFeature } from '../features/TextCompareFeature';

export class QuickOpsApplication {
  private context: vscode.ExtensionContext;
  private services: IService[] = [];
  private features: IFeature[] = [];

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  public async start() {
    ColorLog.black('[QuickOps]', 'Application Starting...');
    console.time('QuickOps Activation');

    this.services = [ConfigurationService.getInstance(), WorkspaceStateService.getInstance(), EditorContextService.getInstance(), TerminalExecutor.getInstance()];

    const initPromises = this.services.map(async (service) => {
      try {
        //@ts-ignore
        if (service.init) await service.init(this.context);
      } catch (error) {
        console.error(`[Service] ${service.serviceId} failed to init:`, error);
      }
    });
    await Promise.all(initPromises);

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
      new TerminalFeature(),
      new ComponentIntellisenseFeature(),
      new TextCompareFeature(),
    ];

    for (const feature of this.features) {
      try {
        feature.activate(this.context);
      } catch (error) {
        console.error(`[Feature] ${feature.id} failed to activate:`, error);
      }
    }

    this.setupGlobalDisposables();
    console.timeEnd('QuickOps Activation');
    ColorLog.black('[QuickOps]', 'All features registered instantly!');
  }

  private setupGlobalDisposables() {}

  public dispose() {
    for (let i = this.features.length - 1; i >= 0; i--) {
      try {
        this.features[i].dispose?.();
      } catch (e) {
        console.error(e);
      }
    }
    for (let i = this.services.length - 1; i >= 0; i--) {
      try {
        this.services[i].dispose?.();
      } catch (e) {
        console.error(e);
      }
    }
    ColorLog.red('[QuickOps]', 'Application Disposed.');
  }
}
