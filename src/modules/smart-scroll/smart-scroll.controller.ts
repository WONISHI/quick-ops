import * as vscode from 'vscode';

import type { OnModuleInit } from '@core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { SmartScrollService } from '@modules/smart-scroll/smart-scroll.service';

export class SmartScrollController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, SmartScrollService];

  private readonly id = 'SmartScrollModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly smartScrollService: SmartScrollService,
  ) {}

  public onModuleInit(): void {
    this.registerCommands();

  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand('quickOps.scrollToTop', () => {
        this.smartScrollService.scrollToTop();
      }),

      vscode.commands.registerCommand('quickOps.scrollToBottom', () => {
        this.smartScrollService.scrollToBottom();
      }),
    );
  }
}