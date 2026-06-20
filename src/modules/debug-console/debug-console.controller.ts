import * as vscode from 'vscode';
import ColorLog from '../../utils/ColorLog';
import type { OnModuleInit } from '../../core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { ConfigurationService } from '../../common/services/configuration.service';
import { DebugConsoleService } from './debug-console.service';

export class DebugConsoleController implements OnModuleInit {
  public static inject = [
    ExtensionContextProvider,
    ConfigurationService,
    DebugConsoleService,
  ];

  private readonly id = 'DebugConsoleModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly configurationService: ConfigurationService,
    private readonly debugConsoleService: DebugConsoleService,
  ) {}

  public onModuleInit(): void {
    this.debugConsoleService.initStatusBar();

    this.registerCommands();
    this.registerConfigListener();

    this.debugConsoleService.checkConfigAndToggle();
    this.debugConsoleService.hijackConsole();

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  public dispose(): void {
    this.debugConsoleService.dispose();
  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand(
        'quick-ops.debug.toggleConsole',
        (type: string) => {
          this.debugConsoleService.toggleConsole(type);
        },
      ),
    );
  }

  private registerConfigListener(): void {
    this.configurationService.on('configChanged', () => {
      this.debugConsoleService.checkConfigAndToggle();
    });
  }
}