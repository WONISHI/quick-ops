import * as vscode from 'vscode';
import ColorLog from '../../utils/ColorLog';
import type { OnModuleInit } from '../../core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { SmartScrollService } from './smart-scroll.service';

export class SmartScrollController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, SmartScrollService];

  private readonly id = 'SmartScrollModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly smartScrollService: SmartScrollService,
  ) {}

  public onModuleInit(): void {
    this.registerCommands();

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand('quick-ops.scrollToTop', () => {
        this.smartScrollService.scrollToTop();
      }),

      vscode.commands.registerCommand('quick-ops.scrollToBottom', () => {
        this.smartScrollService.scrollToBottom();
      }),
    );
  }
}