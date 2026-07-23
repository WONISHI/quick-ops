import * as vscode from 'vscode';
import { WORKSPACE_EVENTS } from '@workflow/workspace-events/type';
import type { WebviewCreatedPayload, WebviewIcon } from '@plugins/webview-enhancer/type';
import type { WorkspaceOn, WebviewAppearancePluginInitOptions } from '@plugins/webview-enhancer/type';

const ACTIVE_WEBVIEW_FULLSCREEN_CONTEXT = 'quickOps.activeWebview.fullscreen';
const ACTIVE_WEBVIEW_FLOATING_CONTEXT = 'quickOps.activeWebview.floating';
const TOGGLE_WEBVIEW_FULLSCREEN_COMMAND = 'quickOps.webview.toggleFullscreen';
const MOVE_WEBVIEW_TO_FLOATING_WINDOW_COMMAND = 'quickOps.webview.moveToFloatingWindow';
const MOVE_EDITOR_TO_NEW_WINDOW_COMMANDS = ['workbench.action.moveEditorToNewWindow', 'workbench.action.editor.moveEditorToNextWindow'] as const;

export class WebviewAppearancePlugin {
  public readonly use = ['on'] as const;

  private workspaceOn?: WorkspaceOn;

  private readonly fullscreenPanels = new Set<vscode.WebviewPanel>();

  private readonly floatingPanels = new Set<vscode.WebviewPanel>();

  private readonly disposables: vscode.Disposable[] = [];

  private globalListenersRegistered = false;

  private commandRegistered = false;

  private moveEditorToNewWindowCommand?: string;

  public init({ on }: WebviewAppearancePluginInitOptions = {}) {
    this.workspaceOn = on;

    this.registerCommandsOnce();
    void this.detectFloatingWindowSupport();

    return {
      pluginId: 'webview-appearance-plugin',
      on: [
        {
          name: 'webview:created',
          callback: this.handleWebviewCreated.bind(this),
        },
        {
          name: 'webview:disposed',
          callback: this.handleWebviewDisposed.bind(this),
        },
      ],
    };
  }

  /**
   * @description 注册 editor/title 按钮点击命令
   */
  private registerCommandsOnce(): void {
    if (this.commandRegistered) return;

    this.commandRegistered = true;

    this.disposables.push(
      vscode.commands.registerCommand(TOGGLE_WEBVIEW_FULLSCREEN_COMMAND, async () => {
        await this.toggleFullscreen();
      }),

      vscode.commands.registerCommand(MOVE_WEBVIEW_TO_FLOATING_WINDOW_COMMAND, async () => {
        await this.moveToFloatingWindow();
      }),
    );
  }

  /**
   * @description 执行 Webview 放大 / 还原
   */
  private async toggleFullscreen(): Promise<void> {
    try {
      await vscode.commands.executeCommand('workbench.action.toggleMaximizeEditorGroup');
    } catch (error) {
      console.warn('[WebviewAppearancePlugin] toggle maximize failed, trying fallback.', error);

      await vscode.commands.executeCommand('workbench.action.minimizeOtherEditors');
    }
  }

  /**
   * @description 将当前激活的 Webview 编辑器移入 VS Code 浮动窗口
   */
  private async moveToFloatingWindow(): Promise<void> {
    const hasActiveFloatingWebview = Array.from(this.floatingPanels).some((panel) => panel.active && panel.visible);

    if (!hasActiveFloatingWebview) return;

    if (!this.moveEditorToNewWindowCommand) {
      void vscode.window.showWarningMessage('当前 VS Code 版本不支持浮动编辑器窗口，请升级到 1.85 或更高版本。');
      return;
    }

    try {
      await vscode.commands.executeCommand(this.moveEditorToNewWindowCommand);
    } catch (error) {
      console.warn('[WebviewAppearancePlugin] move editor to floating window failed.', error);
      void vscode.window.showWarningMessage('无法将当前 Webview 移至浮动编辑器窗口。');
    }
  }

  /**
   * @description 仅在宿主提供对应命令时展示浮动窗口按钮
   */
  private async detectFloatingWindowSupport(): Promise<void> {
    try {
      const commands = await vscode.commands.getCommands(true);

      this.moveEditorToNewWindowCommand = MOVE_EDITOR_TO_NEW_WINDOW_COMMANDS.find((command) => commands.includes(command));
    } catch (error) {
      this.moveEditorToNewWindowCommand = undefined;
      console.warn('[WebviewAppearancePlugin] detect floating window support failed.', error);
    }

    this.refreshAppearanceContexts();
  }

  private handleWebviewCreated(payload: WebviewCreatedPayload): void {
    const { panel } = payload;

    if (!panel) return;

    this.applyWebviewIcon(payload);

    this.registerGlobalListenersOnce();
    this.registerAppearancePanel(payload);
    this.refreshAppearanceContexts();
  }

  private handleWebviewDisposed(payload: WebviewCreatedPayload): void {
    const { panel } = payload;

    if (!panel) return;

    this.fullscreenPanels.delete(panel);
    this.floatingPanels.delete(panel);
    this.refreshAppearanceContexts();
  }

  private applyWebviewIcon(payload: WebviewCreatedPayload): void {
    const { panel, options } = payload;

    if (!panel) return;
    if (!options?.icon) return;
    if (!options.extensionUri) return;

    panel.iconPath = this.resolveIconPath(options.extensionUri, options.icon);
  }

  private registerAppearancePanel(payload: WebviewCreatedPayload): void {
    const { panel, options } = payload;

    if (!panel) return;

    if (options?.fullscreen) {
      this.fullscreenPanels.add(panel);
    }

    if (options?.floating) {
      this.floatingPanels.add(panel);
    }

    if (!options?.fullscreen && !options?.floating) return;

    this.disposables.push(
      panel.onDidChangeViewState(() => {
        this.refreshAppearanceContexts();
      }),

      panel.onDidDispose(() => {
        this.fullscreenPanels.delete(panel);
        this.floatingPanels.delete(panel);
        this.refreshAppearanceContexts();
      }),
    );
  }

  private registerGlobalListenersOnce(): void {
    if (this.globalListenersRegistered) return;

    if (!this.workspaceOn) {
      console.warn('[WebviewAppearancePlugin] workspace-events on is not injected.');
      return;
    }

    this.globalListenersRegistered = true;

    this.disposables.push(
      this.workspaceOn(WORKSPACE_EVENTS.DID_CHANGE_ACTIVE_TEXT_EDITOR, () => {
        this.refreshAppearanceContexts();
      }),

      this.workspaceOn(WORKSPACE_EVENTS.DID_CHANGE_TABS, () => {
        this.refreshAppearanceContexts();
      }),

      this.workspaceOn(WORKSPACE_EVENTS.DID_CHANGE_TAB_GROUPS, () => {
        this.refreshAppearanceContexts();
      }),
    );
  }

  private refreshAppearanceContexts(): void {
    const isActiveFullscreenWebview = Array.from(this.fullscreenPanels).some((panel) => {
      return panel.active && panel.visible;
    });

    const isActiveFloatingWebview =
      Boolean(this.moveEditorToNewWindowCommand) &&
      Array.from(this.floatingPanels).some((panel) => {
        return panel.active && panel.visible;
      });

    void vscode.commands.executeCommand('setContext', ACTIVE_WEBVIEW_FULLSCREEN_CONTEXT, isActiveFullscreenWebview);
    void vscode.commands.executeCommand('setContext', ACTIVE_WEBVIEW_FLOATING_CONTEXT, isActiveFloatingWebview);
  }

  private resolveIconPath(extensionUri: vscode.Uri, icon: WebviewIcon): vscode.Uri | { light: vscode.Uri; dark: vscode.Uri } {
    if (typeof icon === 'string') {
      return vscode.Uri.joinPath(extensionUri, icon);
    }

    return {
      light: vscode.Uri.joinPath(extensionUri, icon.light),
      dark: vscode.Uri.joinPath(extensionUri, icon.dark),
    };
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }

    this.disposables.length = 0;
    this.fullscreenPanels.clear();
    this.floatingPanels.clear();
    this.globalListenersRegistered = false;
    this.commandRegistered = false;
    this.moveEditorToNewWindowCommand = undefined;
    this.workspaceOn = undefined;

    void vscode.commands.executeCommand('setContext', ACTIVE_WEBVIEW_FULLSCREEN_CONTEXT, false);
    void vscode.commands.executeCommand('setContext', ACTIVE_WEBVIEW_FLOATING_CONTEXT, false);
  }
}

export default WebviewAppearancePlugin;
