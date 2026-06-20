import * as vscode from 'vscode';
import ColorLog from '../../utils/ColorLog';
import type { OnModuleInit } from '../../core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { StyleGeneratorService } from './style-generator.service';

export class StyleGeneratorController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, StyleGeneratorService];

  private readonly id = 'StyleGeneratorModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly styleGeneratorService: StyleGeneratorService,
  ) {}

  public onModuleInit(): void {
    this.registerCommands();

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand('quick-ops.generateStyleStructure', async () => {
        await this.styleGeneratorService.generateStyleStructure();
      }),
    );
  }
}