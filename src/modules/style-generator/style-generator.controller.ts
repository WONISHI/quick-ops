import * as vscode from 'vscode';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { StyleGeneratorService } from '@modules/style-generator/style-generator.service';
import type { OnModuleInit } from '@core/lifecycle/lifecycle.interface';

export class StyleGeneratorController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, StyleGeneratorService];

  private readonly id = 'StyleGeneratorModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly styleGeneratorService: StyleGeneratorService,
  ) {}

  public onModuleInit(): void {
    this.registerCommands();

  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand('quickOps.generateStyleStructure', async () => {
        await this.styleGeneratorService.generateStyleStructure();
      }),
    );
  }
}