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
import { LivePreviewFeature } from '../features/LivePreviewFeature';

export class QuickOpsApplication {
  private context: vscode.ExtensionContext;

  private services: IService[] = [];
  private features: IFeature[] = [];

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * 启动应用
   */
  public async start() {
    ColorLog.black('[QuickOps]', 'Application Starting...');
    console.time('QuickOps Activation');

    // ==========================================
    // 第一阶段：核心服务并发初始化 (极大缩短 I/O 等待)
    // ==========================================
    this.services = [ConfigurationService.getInstance(), WorkspaceStateService.getInstance(), EditorContextService.getInstance(), TerminalExecutor.getInstance()];

    // 🌟 性能优化：Promise.all 保证所有服务同时去读取本地配置/环境，总耗时取决于最慢的一个
    const initPromises = this.services.map(async (service) => {
      try {
        //@ts-ignore
        if (service.init) await service.init(this.context);
      } catch (error) {
        console.error(`[Service] ${service.serviceId} failed to init:`, error);
      }
    });
    await Promise.all(initPromises);

    // ==========================================
    // 第二阶段：核心功能瞬间激活 (UI/右键菜单强相关)
    // ==========================================
    // 🌟 性能优化：这些功能只做轻量级的注册，必须瞬间完成以保证用户一打开 VS Code 菜单立即可用
    const criticalFeatures = [
      new ConfigManagementFeature(), // 维护右键 Toggle Ignore 状态，最重要
      new FileNavigationFeature(), // 文件定位
      new SmartScrollFeature(), // 滚动辅助
      new ClipboardTransformFeature(), // 剪贴板文本转换 (纯正则，极快)
      new LogEnhancerFeature(), // 日志快捷键
      new EditorHistoryFeature(), // 编辑历史
      new MarkDecorationFeature(), // 文本高亮
      new DebugConsoleFeature(), // Debug 按钮
      new LivePreviewFeature(),
    ];

    for (const feature of criticalFeatures) {
      this.features.push(feature);
      try {
        feature.activate(this.context);
      } catch (error) {
        console.error(`[Critical Feature] ${feature.id} failed to activate:`, error);
      }
    }

    this.setupGlobalDisposables();
    console.timeEnd('QuickOps Activation');
    ColorLog.black('[QuickOps]', 'Critical Core is now active!');

    // ==========================================
    // 第三阶段：重量级功能延后激活 (彻底让出启动主线程)
    // ==========================================
    // 🌟 性能优化：将扫描文件、读取 Package、开启服务等重型任务推迟 2 秒执行
    setTimeout(() => {
      const deferredFeatures = [
        new AnchorFeature(), // 涉及遍历文件树寻找锚点
        new MockServerFeature(), // 涉及 Webview Provider 和大量 JSON 规则加载
        new PackageScriptsFeature(), // 涉及扫描 package.json 和 workspace
        new StyleGeneratorFeature(), // 涉及庞大 AST 解析引擎预热
        new ProjectExportFeature(), // 涉及 Git 忽略状态和文件树扫描
        new CodeSnippetFeature(),
        new SnippetGeneratorFeature(),
      ];

      for (let i = 0; i < deferredFeatures.length; i++) {
        const feature = deferredFeatures[i];
        this.features.push(feature);
        try {
          feature.activate(this.context);
        } catch (error) {
          console.error(`[Deferred Feature] ${feature.id} failed to activate:`, error);
        }
      }
      ColorLog.black('[QuickOps]', 'Deferred Features loaded seamlessly.');
    }, 2000);
  }

  private setupGlobalDisposables() {
    // 全局清理逻辑
  }

  /**
   * 销毁应用
   */
  public dispose() {
    for (let i = this.features.length - 1; i >= 0; i--) {
      try {
        this.features[i].dispose?.();
      } catch (e) {
        console.error(`Error disposing feature ${this.features[i].id}`, e);
      }
    }

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
