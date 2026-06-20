import * as vscode from 'vscode';
import ColorLog from '../../utils/ColorLog';
import type { OnModuleInit } from '../../core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { ClipboardTransformService } from './clipboard-transform.service';

export class ClipboardTransformController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, ClipboardTransformService];

  private readonly id = 'ClipboardTransformModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly clipboardTransformService: ClipboardTransformService,
  ) {}

  public onModuleInit(): void {
    this.registerCommands();

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand('quick-ops.transformToLower', async () => {
        await this.clipboardTransformService.transformSelection('lower');
      }),

      vscode.commands.registerCommand('quick-ops.transformToCamel', async () => {
        await this.clipboardTransformService.transformSelection('camel');
      }),

      vscode.commands.registerCommand('quick-ops.transformToPascal', async () => {
        await this.clipboardTransformService.transformSelection('pascal');
      }),

      vscode.commands.registerCommand('quick-ops.transformToKebab', async () => {
        await this.clipboardTransformService.transformSelection('kebab');
      }),

      vscode.commands.registerCommand('quick-ops.transformToConstant', async () => {
        await this.clipboardTransformService.transformSelection('constant');
      }),
    );
  }
}