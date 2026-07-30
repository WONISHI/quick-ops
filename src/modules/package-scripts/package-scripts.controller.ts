import * as vscode from 'vscode';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { PackageScriptsService } from './package-scripts.service';
import type { OnModuleInit } from '@core/lifecycle/lifecycle.interface';

export class PackageScriptsController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, PackageScriptsService];

  private readonly id = 'PackageScriptsModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly packageScriptsService: PackageScriptsService,
  ) {}

  public onModuleInit(): void {
    this.packageScriptsService.init();

    this.registerCommands();
    this.registerWatchers();

  }

  public dispose(): void {
    this.packageScriptsService.dispose();
  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand('quickOps.showPackageScripts', async () => {
        await this.packageScriptsService.showScripts();
      }),

      vscode.commands.registerCommand('quick-ops.packageScripts.stopRunning', async () => {
        await this.packageScriptsService.stopRunningCommand();
      }),
    );
  }

  private registerWatchers(): void {
    const watcher = vscode.workspace.createFileSystemWatcher('**/package.json');

    watcher.onDidChange(() => {
      this.packageScriptsService.clearPackageJsonCache();
    });

    watcher.onDidCreate(() => {
      this.packageScriptsService.clearPackageJsonCache();
    });

    watcher.onDidDelete(() => {
      this.packageScriptsService.clearPackageJsonCache();
    });

    this.extensionContextProvider.register(watcher);
  }
}