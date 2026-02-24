import * as vscode from 'vscode';
import { TextDecoder } from 'util';
import { IFeature } from '../core/interfaces/IFeature';
import { WorkspaceContextService } from '../services/WorkspaceContextService';
import { TemplateEngine } from '../utils/TemplateEngine';
import { ConfigurationService } from '../services/ConfigurationService';
import type { ShellConfigItem, ScriptItem } from '../core/types/package-script';
import ColorLog from '../utils/ColorLog';

export class PackageScriptsFeature implements IFeature {
  public readonly id = 'PackageScriptsFeature';
  private statusBarItem: vscode.StatusBarItem | undefined;
  private extensionUri!: vscode.Uri;
  private configService: ConfigurationService = ConfigurationService.getInstance();

  constructor(private contextService: WorkspaceContextService = WorkspaceContextService.getInstance()) {}

  public activate(context: vscode.ExtensionContext): void {
    this.extensionUri = context.extensionUri;

    const commandId = 'quick-ops.showPackageScripts';
    context.subscriptions.push(vscode.commands.registerCommand(commandId, this.showScripts.bind(this)));

    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = commandId;
    this.statusBarItem.text = '$(terminal-powershell) Scripts';
    this.statusBarItem.tooltip = 'View and execute scripts';
    this.statusBarItem.show();
    context.subscriptions.push(this.statusBarItem);

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private async findPackageJsonUri(startUri: vscode.Uri): Promise<vscode.Uri | undefined> {
    let currentUri = startUri;

    // Safety check loop to prevent infinite loops, though file system root check should suffice
    while (true) {
      const packageJsonUri = vscode.Uri.joinPath(currentUri, 'package.json');
      try {
        await vscode.workspace.fs.stat(packageJsonUri);
        return packageJsonUri; // Found it
      } catch {
        // Not found in current directory
      }

      const parentUri = vscode.Uri.joinPath(currentUri, '..');

      // If we have reached the root (parent is same as current), stop
      if (parentUri.toString() === currentUri.toString()) {
        return undefined;
      }
      currentUri = parentUri;
    }
  }

  private async showScripts() {
    const items: (ScriptItem | vscode.QuickPickItem)[] = [];
    const ctx = this.contextService.context;
    const decoder = new TextDecoder('utf-8');

    // 1. Determine the starting point for finding package.json
    let startUri: vscode.Uri | undefined;

    // Priority 1: Active Text Editor's folder
    if (vscode.window.activeTextEditor) {
      startUri = vscode.Uri.joinPath(vscode.window.activeTextEditor.document.uri, '..');
    }
    // Priority 2: Workspace Root
    else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      startUri = vscode.workspace.workspaceFolders[0].uri;
    }

    let packageJsonUri: vscode.Uri | undefined;
    let projectRootStr = ''; // Used for cwd in scripts

    if (startUri) {
      packageJsonUri = await this.findPackageJsonUri(startUri);
    }

    // 2. Read package.json if found
    if (packageJsonUri) {
      try {
        const contentUint8 = await vscode.workspace.fs.readFile(packageJsonUri);
        const content = decoder.decode(contentUint8);
        const packageJson = JSON.parse(content);
        const scripts = packageJson.scripts || {};
        const scriptNames = Object.keys(scripts);

        // The directory containing package.json
        const packageDirUri = vscode.Uri.joinPath(packageJsonUri, '..');
        projectRootStr = packageDirUri.fsPath;

        if (scriptNames.length > 0) {
          items.push({
            label: `NPM Scripts (${packageJson.name || 'Project'})`,
            description: vscode.workspace.asRelativePath(packageDirUri), // Show relative path for clarity
            kind: vscode.QuickPickItemKind.Separator,
          });

          scriptNames.forEach((name) => {
            items.push(this.createScriptItem(name, scripts[name], name, projectRootStr, true, undefined, false));
          });
        }
      } catch (e: any) {
        console.error('Error parsing package.json', e);
      }

      // Load workspace custom scripts (associated with the found project root)
      const workspaceScripts = this.loadWorkspaceScripts(projectRootStr, ctx);
      if (workspaceScripts.length > 0) {
        items.push({
          label: 'Workspace Custom Scripts',
          kind: vscode.QuickPickItemKind.Separator,
        });
        items.push(...workspaceScripts);
      }
    }

    // 3. Read built-in resources (Extension Scripts)
    const shellResourceUri = vscode.Uri.joinPath(this.extensionUri, 'resources', 'shell');

    try {
      const entries = await vscode.workspace.fs.readDirectory(shellResourceUri);

      const fileReadPromises = entries
        .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.json'))
        .map(async ([name]) => {
          try {
            const fileUri = vscode.Uri.joinPath(shellResourceUri, name);
            const contentUint8 = await vscode.workspace.fs.readFile(fileUri);
            const content = decoder.decode(contentUint8);

            const jsonItems: ShellConfigItem[] = JSON.parse(content);
            if (Array.isArray(jsonItems) && jsonItems.length > 0) {
              // Use projectRootStr if found, otherwise extension path as fallback for CWD
              const validShellItems = this.processShellItems(jsonItems, ctx, projectRootStr || this.extensionUri.fsPath);
              if (validShellItems.length > 0) {
                return { file: name, items: validShellItems };
              }
            }
          } catch (err) {
            console.error(`Error parsing shell file ${name}:`, err);
          }
          return null;
        });

      const results = await Promise.all(fileReadPromises);

      results.forEach((res) => {
        if (res) {
          items.push({ label: `Extension: ${res.file}`, kind: vscode.QuickPickItemKind.Separator });
          items.push(...res.items);
        }
      });
    } catch (err) {
      // Ignore if directory doesn't exist
    }

    if (items.length === 0) {
      vscode.window.showInformationMessage('No executable scripts found.');
      return;
    }

    const quickPick = vscode.window.createQuickPick<ScriptItem>();
    quickPick.items = items as ScriptItem[];
    quickPick.placeholder = 'Select a script to execute';
    quickPick.matchOnDescription = true;
    quickPick.ignoreFocusOut = true;

    quickPick.onDidTriggerItemButton(async (e) => {
      const isNewTerminal = e.button.tooltip === '在新终端执行';
      await this.runScript(e.item, isNewTerminal);
      if (!e.item.keepOpen) quickPick.hide();
    });

    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems[0];
      if (selected) {
        await this.runScript(selected, false);
        if (!selected.keepOpen) {
          quickPick.hide();
        } else {
          quickPick.selectedItems = [];
          quickPick.show();
        }
      }
    });

    quickPick.show();
  }

  private loadWorkspaceScripts(rootPath: string, ctx: any): ScriptItem[] {
    const shells = this.configService.config.shells;
    if (Array.isArray(shells) && shells.length > 0) {
      return this.processShellItems(shells, ctx, rootPath);
    }
    return [];
  }

  private processShellItems(jsonItems: ShellConfigItem[], ctx: any, cwd: string): ScriptItem[] {
    const validItems: ScriptItem[] = [];
    jsonItems.forEach((item) => {
      const { result, payload, status } = TemplateEngine.render(item.cmd, ctx);
      if (status === 'empty' || status === 'missing') return;
      validItems.push(this.createScriptItem(item.description, result, result, cwd, false, payload, item.keepOpen));
    });
    return validItems;
  }

  private createScriptItem(label: string, description: string, commandToExecute: string, cwd: string, isNpmScript: boolean, payload?: Record<string, any>, keepOpen: boolean = false): ScriptItem {
    return {
      label: `$(terminal) ${label}`,
      description: description,
      commandToExecute: commandToExecute,
      cwd: cwd,
      isNpmScript: isNpmScript,
      payload: payload,
      keepOpen: keepOpen,
      buttons: [
        { iconPath: new vscode.ThemeIcon('debug-start'), tooltip: '在当前终端执行' },
        { iconPath: new vscode.ThemeIcon('add'), tooltip: '在新终端执行' },
      ],
    };
  }

  private async selectPackageManager(cwd: string): Promise<string | undefined> {
    const managers = [
      { name: 'pnpm', lock: 'pnpm-lock.yaml' },
      { name: 'yarn', lock: 'yarn.lock' },
      { name: 'bun', lock: 'bun.lockb' },
      { name: 'npm', lock: 'package-lock.json' },
    ];

    const getCwdUri = (cwdPath: string): vscode.Uri => {
      // cwdPath is likely fsPath string, convert to Uri
      // Try to match with workspace folder to get correct scheme if possible
      const ws = vscode.workspace.workspaceFolders?.find((w) => w.uri.fsPath === cwdPath);
      return ws ? ws.uri : vscode.Uri.file(cwdPath);
    };

    const cwdUri = getCwdUri(cwd);

    const checkPromises = managers.map(async (m) => {
      try {
        const lockUri = vscode.Uri.joinPath(cwdUri, m.lock);
        await vscode.workspace.fs.stat(lockUri);
        return m;
      } catch {
        return null;
      }
    });

    const results = await Promise.all(checkPromises);
    const detected = results.filter((m): m is (typeof managers)[0] => m !== null);

    const items: vscode.QuickPickItem[] = [];

    if (detected.length > 0) {
      detected.forEach((m) => items.push({ label: m.name, description: `Detected ${m.lock}`, picked: true }));
      items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    }

    const detectedNames = detected.map((d) => d.name);
    if (!detectedNames.includes('npm')) items.push({ label: 'npm', description: 'Default' });

    ['pnpm', 'yarn', 'bun'].forEach((name) => {
      if (!detectedNames.includes(name)) items.push({ label: name, description: 'Force use' });
    });

    if (detected.length === 0) return 'npm';

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select package manager',
      ignoreFocusOut: true,
    });

    return selected ? selected.label : undefined;
  }

  private async runScript(item: ScriptItem, newTerminal: boolean) {
    let finalCommand = item.commandToExecute;

    if (item.payload && Object.keys(item.payload).length > 0) {
      for (const [key, value] of Object.entries(item.payload)) {
        if (Array.isArray(value)) {
          const choice = await vscode.window.showQuickPick(value.map(String), {
            placeHolder: `Select value for ${key}`,
            ignoreFocusOut: true,
          });
          if (!choice) return;
          finalCommand = finalCommand.replace(new RegExp(`\\[\\[\\s*${key}\\s*\\]\\]`, 'g'), choice);
        }
      }
    }

    if (item.isNpmScript) {
      const packageManager = await this.selectPackageManager(item.cwd);
      if (!packageManager) return;
      finalCommand = `${packageManager}${packageManager === 'yarn' ? ` ${finalCommand}` : ` run ${finalCommand}`}`;
    }

    let terminal: vscode.Terminal;
    if (newTerminal) {
      terminal = vscode.window.createTerminal({
        name: `Ops: ${item.label.replace('$(terminal) ', '')}`,
        cwd: item.cwd,
      });
    } else {
      if (vscode.window.activeTerminal) {
        terminal = vscode.window.activeTerminal;
        terminal.sendText('\u0003'); // Ctrl+C to stop running process
      } else {
        terminal = vscode.window.createTerminal({
          name: 'Terminal',
          cwd: item.cwd,
        });
      }
    }

    terminal.show();
    terminal.sendText(finalCommand);
  }
}
