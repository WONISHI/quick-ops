import * as vscode from "vscode";
import { TextDecoder } from "util";
import { spawn } from "child_process";
import * as net from "net";
import { IFeature } from "../core/interfaces/IFeature";
import { WorkspaceContextService } from "../services/WorkspaceContextService";
import { TemplateEngine } from "../utils/TemplateEngine";
import { ConfigurationService } from "../services/ConfigurationService";
import type { ShellConfigItem, ScriptItem } from "../core/types/package-script";
import ColorLog from "../utils/ColorLog";

export class PackageScriptsFeature implements IFeature {
  public readonly id = "PackageScriptsFeature";
  private extensionUri!: vscode.Uri;
  private configService: ConfigurationService =
    ConfigurationService.getInstance();
  private statusBarItem?: vscode.StatusBarItem;
  private statusHideTimer?: ReturnType<typeof setTimeout>;
  private commandSeq = 0;
  private statusTickTimer?: ReturnType<typeof setInterval>;
  private externalWatchTimer?: ReturnType<typeof setInterval>;
  private activeCommands = new Map<
    number,
    {
      displayName: string;
      command: string;
      cwd: string;
      state: "running" | "success";
      startedAt: number;
      progress: number;
      ports: number[];
      url?: string;
      successAt?: number;
      lastOutputAt?: number;
      source?: "quickops" | "terminal";
      commandType?: "server" | "build" | "script";
    }
  >();
  private terminalExecutionCommandIds = new WeakMap<object, number>();
  private externalServers = new Map<
    string,
    {
      host: string;
      port: number;
      label: string;
      source: string;
      checkedAt: number;
    }
  >();
  private lastStatus: {
    type: "idle" | "success" | "failed" | "cancelled" | "external";
    displayName?: string;
    command?: string;
    message?: string;
  } = {
    type: "idle",
  };

  constructor(
    private contextService: WorkspaceContextService = WorkspaceContextService.getInstance(),
  ) {}

  public activate(context: vscode.ExtensionContext): void {
    this.extensionUri = context.extensionUri;

    const commandId = "quick-ops.showPackageScripts";

    context.subscriptions.push(
      vscode.commands.registerCommand(commandId, this.showScripts.bind(this)),
    );

    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.statusBarItem.name = "Quick Ops Scripts";
    this.statusBarItem.command = commandId;
    context.subscriptions.push(this.statusBarItem, {
      dispose: () => this.disposeStatusBarResources(),
    });
    this.updateScriptStatusBar();
    this.startExternalServerWatcher();
    this.startTerminalShellExecutionWatcher(context);

    ColorLog.black(`[${this.id}]`, "Activated.");
  }

  private async findPackageJsonUri(
    startUri: vscode.Uri,
  ): Promise<vscode.Uri | undefined> {
    let currentUri = startUri;

    while (true) {
      const packageJsonUri = vscode.Uri.joinPath(currentUri, "package.json");
      try {
        await vscode.workspace.fs.stat(packageJsonUri);
        return packageJsonUri;
      } catch {}

      const parentUri = vscode.Uri.joinPath(currentUri, "..");

      if (parentUri.toString() === currentUri.toString()) {
        return undefined;
      }
      currentUri = parentUri;
    }
  }

  private async showScripts() {
    const items: (ScriptItem | vscode.QuickPickItem)[] = [];
    const ctx = this.contextService.context;
    const decoder = new TextDecoder("utf-8");

    let startUri: vscode.Uri | undefined;

    if (vscode.window.activeTextEditor) {
      startUri = vscode.Uri.joinPath(
        vscode.window.activeTextEditor.document.uri,
        "..",
      );
    } else if (
      vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length > 0
    ) {
      startUri = vscode.workspace.workspaceFolders[0].uri;
    }

    let packageJsonUri: vscode.Uri | undefined;
    let projectRootStr = "";

    if (startUri) {
      packageJsonUri = await this.findPackageJsonUri(startUri);
    }

    if (packageJsonUri) {
      try {
        const contentUint8 = await vscode.workspace.fs.readFile(packageJsonUri);
        const content = decoder.decode(contentUint8);
        const packageJson = JSON.parse(content);
        const scripts = packageJson.scripts || {};
        const scriptNames = Object.keys(scripts);

        const packageDirUri = vscode.Uri.joinPath(packageJsonUri, "..");
        projectRootStr = packageDirUri.fsPath;

        if (scriptNames.length > 0) {
          items.push({
            label: `NPM Scripts (${packageJson.name || "Project"})`,
            description: vscode.workspace.asRelativePath(packageDirUri),
            kind: vscode.QuickPickItemKind.Separator,
          });

          scriptNames.forEach((name) => {
            items.push(
              this.createScriptItem(
                name,
                scripts[name],
                name,
                projectRootStr,
                true,
                undefined,
                false,
              ),
            );
          });
        }
      } catch (e: any) {
        console.error("Error parsing package.json", e);
      }

      const workspaceScripts = this.loadWorkspaceScripts(projectRootStr, ctx);
      if (workspaceScripts.length > 0) {
        items.push({
          label: "Workspace Custom Scripts",
          kind: vscode.QuickPickItemKind.Separator,
        });
        items.push(...workspaceScripts);
      }
    }

    const shellResourceUri = vscode.Uri.joinPath(
      this.extensionUri,
      "resources",
      "shell",
    );

    try {
      const entries = await vscode.workspace.fs.readDirectory(shellResourceUri);

      const fileReadPromises = entries
        .filter(
          ([name, type]) =>
            type === vscode.FileType.File && name.endsWith(".json"),
        )
        .map(async ([name]) => {
          try {
            const fileUri = vscode.Uri.joinPath(shellResourceUri, name);
            const contentUint8 = await vscode.workspace.fs.readFile(fileUri);
            const content = decoder.decode(contentUint8);

            const jsonItems: ShellConfigItem[] = JSON.parse(content);
            if (Array.isArray(jsonItems) && jsonItems.length > 0) {
              const validShellItems = this.processShellItems(
                jsonItems,
                ctx,
                projectRootStr || this.extensionUri.fsPath,
              );
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
          items.push({
            label: `Extension: ${res.file}`,
            kind: vscode.QuickPickItemKind.Separator,
          });
          items.push(...res.items);
        }
      });
    } catch (err) {}

    if (items.length === 0) {
      vscode.window.showInformationMessage("No executable scripts found.");
      return;
    }

    const quickPick = vscode.window.createQuickPick<ScriptItem>();
    quickPick.items = items as ScriptItem[];
    quickPick.placeholder = "Select a script to execute";
    quickPick.matchOnDescription = true;
    quickPick.ignoreFocusOut = true;

    quickPick.onDidTriggerItemButton(async (e) => {
      if (!e.item.keepOpen) {
        quickPick.hide();
      }

      await this.runScript(e.item);

      if (e.item.keepOpen) {
        quickPick.selectedItems = [];
        quickPick.show();
      }
    });

    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems[0];

      if (!selected || !selected.commandToExecute) {
        return;
      }

      if (!selected.keepOpen) {
        quickPick.hide();
      }

      await this.runScript(selected);

      if (selected.keepOpen) {
        quickPick.selectedItems = [];
        quickPick.show();
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

  private processShellItems(
    jsonItems: ShellConfigItem[],
    ctx: any,
    cwd: string,
  ): ScriptItem[] {
    const validItems: ScriptItem[] = [];
    jsonItems.forEach((item) => {
      const { result, payload, status } = TemplateEngine.render(item.cmd, ctx);
      if (status === "empty" || status === "missing") return;
      validItems.push(
        this.createScriptItem(
          item.description,
          result,
          result,
          cwd,
          false,
          payload,
          item.keepOpen,
        ),
      );
    });
    return validItems;
  }

  private createScriptItem(
    label: string,
    description: string,
    commandToExecute: string,
    cwd: string,
    isNpmScript: boolean,
    payload?: Record<string, any>,
    keepOpen: boolean = false,
  ): ScriptItem {
    return {
      label: `$(terminal) ${label}`,
      description: description,
      commandToExecute: commandToExecute,
      cwd: cwd,
      isNpmScript: isNpmScript,
      payload: payload,
      keepOpen: keepOpen,
      buttons: [
        { iconPath: new vscode.ThemeIcon("debug-start"), tooltip: "后台执行" },
      ],
    };
  }

  private async selectPackageManager(cwd: string): Promise<string | undefined> {
    const managers = [
      { name: "pnpm", lock: "pnpm-lock.yaml" },
      { name: "yarn", lock: "yarn.lock" },
      { name: "bun", lock: "bun.lockb" },
      { name: "npm", lock: "package-lock.json" },
    ];

    const getCwdUri = (cwdPath: string): vscode.Uri => {
      const ws = vscode.workspace.workspaceFolders?.find(
        (w) => w.uri.fsPath === cwdPath,
      );
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
    const detected = results.filter(
      (m): m is (typeof managers)[0] => m !== null,
    );

    const items: vscode.QuickPickItem[] = [];

    if (detected.length > 0) {
      detected.forEach((m) =>
        items.push({
          label: m.name,
          description: `Detected ${m.lock}`,
          picked: true,
        }),
      );
      items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
    }

    const detectedNames = detected.map((d) => d.name);
    if (!detectedNames.includes("npm"))
      items.push({ label: "npm", description: "Default" });

    ["pnpm", "yarn", "bun"].forEach((name) => {
      if (!detectedNames.includes(name))
        items.push({ label: name, description: "Force use" });
    });

    if (detected.length === 0) return "npm";

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select package manager",
      ignoreFocusOut: true,
    });

    return selected ? selected.label : undefined;
  }

  private getScriptDisplayName(item: ScriptItem) {
    return (
      item.label.replace("$(terminal) ", "").trim() || item.commandToExecute
    );
  }

  private getCommandErrorMessage(
    error: Error | null,
    stderr: string,
    command: string,
  ) {
    const rawMessage = stderr.trim() || error?.message || "命令执行失败";
    const firstLines = rawMessage
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 6)
      .join("\n");

    return `命令执行失败：${command}\n\n${firstLines}`;
  }

  private appendCommandOutput(buffer: string[], chunk: Buffer | string) {
    const value = Buffer.isBuffer(chunk)
      ? chunk.toString("utf8")
      : String(chunk);

    if (!value) return;

    buffer.push(value);

    const maxLength = 8000;
    let totalLength = buffer.reduce((total, item) => total + item.length, 0);

    while (totalLength > maxLength && buffer.length > 1) {
      const removed = buffer.shift() || "";
      totalLength -= removed.length;
    }
  }

  private disposeStatusBarResources() {
    this.clearStatusHideTimer();

    if (this.statusTickTimer) {
      clearInterval(this.statusTickTimer);
      this.statusTickTimer = undefined;
    }

    if (this.externalWatchTimer) {
      clearInterval(this.externalWatchTimer);
      this.externalWatchTimer = undefined;
    }
  }

  private formatElapsed(ms: number) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  private ensureStatusTicker() {
    if (this.statusTickTimer) return;

    this.statusTickTimer = setInterval(() => {
      this.updateRunningCommandProgress();
      this.updateScriptStatusBar();
    }, 1000);
  }

  private stopStatusTickerIfIdle() {
    if (this.activeCommands.size > 0 || this.externalServers.size > 0) return;
    if (!this.statusTickTimer) return;

    clearInterval(this.statusTickTimer);
    this.statusTickTimer = undefined;
  }

  private updateRunningCommandProgress() {
    const now = Date.now();

    this.activeCommands.forEach((item, commandId) => {
      if (item.state !== "running") return;

      const elapsedSeconds = Math.floor((now - item.startedAt) / 1000);
      const progressLimit = item.commandType === "server" ? 95 : 99;
      const step = item.commandType === "server" ? 3 : 5;
      const nextProgress = Math.min(
        progressLimit,
        Math.max(item.progress, 8 + elapsedSeconds * step),
      );

      if (nextProgress !== item.progress) {
        this.activeCommands.set(commandId, {
          ...item,
          progress: nextProgress,
        });
      }
    });
  }

  private extractPortsFromText(value: string) {
    const ports = new Set<number>();
    const text = String(value || "");

    const patterns = [
      /(?:localhost|127\.0\.0\.1|0\.0\.0\.0)[:：](\d{2,5})/gi,
      /(?:--port|--https-port|--host\s+[^\s]+\s+--port)\s*[= ]\s*(\d{2,5})/gi,
      /(?:PORT|port)\s*[=:]\s*(\d{2,5})/g,
      /listen(?:ing)?\s+(?:on\s+)?(?:port\s+)?(\d{2,5})/gi,
    ];

    patterns.forEach((pattern) => {
      let matched: RegExpExecArray | null;

      while ((matched = pattern.exec(text))) {
        const port = Number(matched[1]);

        if (port >= 1 && port <= 65535) {
          ports.add(port);
        }
      }
    });

    return Array.from(ports);
  }

  private getDefaultMonitorPorts() {
    return [3000, 3001, 5173, 5174, 4173, 4200, 5000, 5170, 8000, 8080, 8888];
  }

  private async getWorkspacePackageScriptPorts() {
    const decoder = new TextDecoder("utf-8");
    const result = new Map<number, string>();
    const workspaceFolders = vscode.workspace.workspaceFolders || [];

    for (const folder of workspaceFolders) {
      try {
        const packageJsonUri = vscode.Uri.joinPath(folder.uri, "package.json");
        const contentUint8 = await vscode.workspace.fs.readFile(packageJsonUri);
        const packageJson = JSON.parse(decoder.decode(contentUint8));
        const scripts = packageJson.scripts || {};

        Object.entries(scripts).forEach(([name, command]) => {
          this.extractPortsFromText(String(command)).forEach((port) => {
            result.set(port, `${folder.name}:${name}`);
          });
        });
      } catch {}
    }

    this.getDefaultMonitorPorts().forEach((port) => {
      if (!result.has(port)) {
        result.set(port, `localhost:${port}`);
      }
    });

    return result;
  }

  private isPortOpen(
    port: number,
    host: string = "127.0.0.1",
    timeout: number = 450,
  ) {
    return new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      let settled = false;

      const finish = (opened: boolean) => {
        if (settled) return;

        settled = true;
        socket.destroy();
        resolve(opened);
      };

      socket.setTimeout(timeout);
      socket.once("connect", () => finish(true));
      socket.once("timeout", () => finish(false));
      socket.once("error", () => finish(false));
      socket.connect(port, host);
    });
  }

  private getRunningCommandEntries() {
    return Array.from(this.activeCommands.entries()).filter(([, item]) => item.state === "running");
  }

  private getServerFromCommandPorts(commandPorts: number[]) {
    const portSet = new Set(commandPorts);

    if (portSet.size === 0) return undefined;

    return Array.from(this.externalServers.values()).find((server) => portSet.has(server.port));
  }

  private getFallbackSuccessServerForRunningCommand(startedAt: number) {
    const servers = Array.from(this.externalServers.values()).sort((a, b) => a.port - b.port);

    if (servers.length === 0) return undefined;

    /**
     * package scripts 里很多启动命令不会显式写端口，例如：
     * pnpm run start -> vite/next/nuxt 自己输出 localhost。
     * 这种情况下 item.ports 为空，不能只靠端口匹配。
     * 如果当前只有一个后台命令在启动，并且已经探测到 localhost 端口可用，
     * 就把这个后台命令视为启动成功，避免状态栏一直卡在 95%。
     */
    if (Date.now() - startedAt < 1200) return undefined;

    return servers[0];
  }

  private syncRunningCommandsWithExternalServers() {
    const runningEntries = this.getRunningCommandEntries();

    if (runningEntries.length === 0 || this.externalServers.size === 0) {
      return;
    }

    runningEntries.forEach(([commandId, item]) => {
      const matchedServer = this.getServerFromCommandPorts(item.ports);

      if (matchedServer) {
        this.markCommandSuccess(commandId, {
          port: matchedServer.port,
          url: `http://localhost:${matchedServer.port}`,
        });
      }
    });

    const stillRunningEntries = this.getRunningCommandEntries();

    if (stillRunningEntries.length !== 1) {
      return;
    }

    const [commandId, item] = stillRunningEntries[0];

    if (item.ports.length > 0) {
      return;
    }

    const fallbackServer = this.getFallbackSuccessServerForRunningCommand(item.startedAt);

    if (!fallbackServer) {
      return;
    }

    this.markCommandSuccess(commandId, {
      port: fallbackServer.port,
      url: `http://localhost:${fallbackServer.port}`,
    });
  }

  private async detectExternalServers() {
    const portMap = await this.getWorkspacePackageScriptPorts();
    const now = Date.now();
    const nextServers = new Map<
      string,
      {
        host: string;
        port: number;
        label: string;
        source: string;
        checkedAt: number;
      }
    >();

    await Promise.all(
      Array.from(portMap.entries()).map(async ([port, label]) => {
        const opened = await this.isPortOpen(port);

        if (!opened) return;

        nextServers.set(`127.0.0.1:${port}`, {
          host: "127.0.0.1",
          port,
          label,
          source: label.includes(":") ? "package.json" : "default-port",
          checkedAt: now,
        });
      }),
    );

    const oldKey = Array.from(this.externalServers.keys()).sort().join("|");
    const newKey = Array.from(nextServers.keys()).sort().join("|");

    this.externalServers = nextServers;
    this.syncRunningCommandsWithExternalServers();

    if (oldKey !== newKey) {
      if (this.externalServers.size > 0 && this.activeCommands.size === 0) {
        this.lastStatus = {
          type: "external",
          displayName: `外部服务 ${this.externalServers.size} 个`,
        };
      }

      this.updateScriptStatusBar();
    }
  }

  private startExternalServerWatcher() {
    if (this.externalWatchTimer) return;

    this.detectExternalServers().catch(() => undefined);

    this.externalWatchTimer = setInterval(() => {
      this.detectExternalServers().catch(() => undefined);
    }, 3500);
  }

  private startTerminalShellExecutionWatcher(context: vscode.ExtensionContext) {
    const vscodeWindow = vscode.window as any;
    const onDidStartTerminalShellExecution = vscodeWindow.onDidStartTerminalShellExecution;
    const onDidEndTerminalShellExecution = vscodeWindow.onDidEndTerminalShellExecution;

    if (
      typeof onDidStartTerminalShellExecution !== "function" ||
      typeof onDidEndTerminalShellExecution !== "function"
    ) {
      return;
    }

    context.subscriptions.push(
      onDidStartTerminalShellExecution((event: any) => {
        this.handleTerminalShellExecutionStart(event);
      }),
      onDidEndTerminalShellExecution((event: any) => {
        this.handleTerminalShellExecutionEnd(event);
      }),
    );
  }

  private getShellExecutionCommandLine(event: any) {
    const commandLine = event?.execution?.commandLine;

    if (typeof commandLine === "string") {
      return commandLine.trim();
    }

    if (typeof commandLine?.value === "string") {
      return commandLine.value.trim();
    }

    if (typeof commandLine?.original === "string") {
      return commandLine.original.trim();
    }

    return "";
  }

  private getShellExecutionCwd(event: any) {
    const cwd = event?.execution?.cwd || event?.terminal?.creationOptions?.cwd;

    if (!cwd) {
      return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
    }

    if (typeof cwd === "string") {
      return cwd;
    }

    if (typeof cwd.fsPath === "string") {
      return cwd.fsPath;
    }

    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
  }

  private getCommandType(command: string, displayName: string = ""): "server" | "build" | "script" {
    const value = `${displayName} ${command}`.toLowerCase();

    if (/\b(dev|serve|start|preview)\b/.test(value)) {
      return "server";
    }

    if (/\b(build|compile|typecheck|check|lint|test)\b/.test(value)) {
      return "build";
    }

    return "script";
  }

  private isTrackableExternalCommand(command: string) {
    const value = command.trim().toLowerCase();

    if (!value) return false;

    return /(^|\s)(npm|pnpm|yarn|bun)(\s+run)?\s+/.test(value) ||
      /(^|\s)(vite|webpack|vue-cli-service|next|nuxt|tsc|eslint|vitest|jest)\b/.test(value);
  }

  private getExternalCommandDisplayName(command: string) {
    const value = command.trim();

    if (!value) return "外部命令";

    const npmScriptMatch = value.match(/\b(?:npm|pnpm|bun)\s+run\s+([^\s]+)/i);
    if (npmScriptMatch?.[1]) {
      return `外部: ${npmScriptMatch[1]}`;
    }

    const yarnScriptMatch = value.match(/\byarn\s+([^\s]+)/i);
    if (yarnScriptMatch?.[1]) {
      return `外部: ${yarnScriptMatch[1]}`;
    }

    return `外部: ${value.split(/\s+/).slice(0, 3).join(" ")}`;
  }

  private handleTerminalShellExecutionStart(event: any) {
    const execution = event?.execution;
    const command = this.getShellExecutionCommandLine(event);

    if (!execution || !this.isTrackableExternalCommand(command)) {
      return;
    }

    const commandId = ++this.commandSeq;
    const displayName = this.getExternalCommandDisplayName(command);
    const commandType = this.getCommandType(command, displayName);

    this.terminalExecutionCommandIds.set(execution, commandId);
    this.activeCommands.set(commandId, {
      displayName,
      command,
      cwd: this.getShellExecutionCwd(event),
      state: "running",
      startedAt: Date.now(),
      progress: 3,
      ports: this.extractPortsFromText(command),
      source: "terminal",
      commandType,
    });

    this.lastStatus = { type: "idle" };
    this.updateScriptStatusBar();
    this.ensureStatusTicker();
  }

  private handleTerminalShellExecutionEnd(event: any) {
    const execution = event?.execution;

    if (!execution) {
      return;
    }

    const commandId = this.terminalExecutionCommandIds.get(execution);

    if (!commandId) {
      return;
    }

    const commandItem = this.activeCommands.get(commandId);

    if (!commandItem) {
      return;
    }

    const exitCodeValue = event?.exitCode ?? event?.execution?.exitCode;
    const exitCode = typeof exitCodeValue === "number" ? exitCodeValue : Number(exitCodeValue || 0);

    this.activeCommands.delete(commandId);

    if (exitCode === 0) {
      this.setLastCommandStatus("success", commandItem.displayName, commandItem.command);
      return;
    }

    const errorMessage = `退出码 ${Number.isFinite(exitCode) ? exitCode : "未知"}`;
    this.setLastCommandStatus("failed", commandItem.displayName, commandItem.command, errorMessage);
    vscode.window.showErrorMessage(`命令执行失败：${commandItem.command}\n\n${errorMessage}`);
  }

  private clearStatusHideTimer() {
    if (!this.statusHideTimer) return;

    clearTimeout(this.statusHideTimer);
    this.statusHideTimer = undefined;
  }

  private getActiveCommandsTooltip() {
    const commands = Array.from(this.activeCommands.values());

    if (commands.length === 0) {
      if (this.lastStatus.type === "idle") {
        return "Quick Ops 脚本执行器：点击选择要执行的命令";
      }

      const prefixMap: Record<
        "idle" | "success" | "failed" | "cancelled" | "external",
        string
      > = {
        idle: "Quick Ops",
        success: "success",
        failed: "failed",
        cancelled: "cancelled",
        external: "external success",
      };

      return [
        `Quick Ops ${prefixMap[this.lastStatus.type]}`,
        this.lastStatus.displayName
          ? `命令：${this.lastStatus.displayName}`
          : "",
        this.lastStatus.command ? `执行：${this.lastStatus.command}` : "",
        this.lastStatus.message || "",
      ]
        .filter(Boolean)
        .join("\n");
    }

    const runningCount = commands.filter(
      (item) => item.state === "running",
    ).length;
    const successCount = commands.filter(
      (item) => item.state === "success",
    ).length;

    return [
      `Quick Ops 后台命令`,
      `执行中：${runningCount}`,
      `success：${successCount}`,
      "",
      ...commands.map((item) => {
        const runningText = item.commandType === "server" ? "启动中" : "执行中";
        const sourceText = item.source === "terminal" ? "外部终端" : "Quick Ops";
        const icon =
          item.state === "success" ? "success" : `${runningText} ${item.progress}%`;
        const elapsed = this.formatElapsed(Date.now() - item.startedAt);
        const url = item.url ? ` · ${item.url}` : "";
        return `${icon} · ${sourceText} · ${elapsed} · ${item.displayName} · ${item.command}${url}`;
      }),
      ...(this.externalServers.size > 0
        ? [
            "",
            `外部已运行：${this.externalServers.size}`,
            ...Array.from(this.externalServers.values()).map((item) => {
              return `success · ${item.label} · http://localhost:${item.port}`;
            }),
          ]
        : []),
    ]
      .filter(Boolean)
      .join("\n");
  }

  private updateScriptStatusBar() {
    if (!this.statusBarItem) return;

    this.clearStatusHideTimer();
    this.updateRunningCommandProgress();

    const commands = Array.from(this.activeCommands.values());

    if (commands.length > 0) {
      const runningCommands = commands.filter(
        (item) => item.state === "running",
      );
      const successCommands = commands.filter(
        (item) => item.state === "success",
      );
      const runningCount = runningCommands.length;
      const successCount = successCommands.length;

      if (runningCount > 0) {
        const avgProgress = Math.round(
          runningCommands.reduce((total, item) => total + item.progress, 0) /
            Math.max(1, runningCount),
        );
        const maxElapsed = Math.max(
          ...runningCommands.map((item) => Date.now() - item.startedAt),
        );
        const runningLabel = runningCommands.some((item) => item.commandType === "server")
          ? "启动中"
          : "执行中";

        this.statusBarItem.text =
          successCount > 0
            ? `$(sync~spin) Quick Ops: ${runningLabel} ${runningCount} · ${avgProgress}% · ${this.formatElapsed(maxElapsed)} · success ${successCount}`
            : `$(sync~spin) Quick Ops: ${runningLabel} ${runningCount} · ${avgProgress}% · ${this.formatElapsed(maxElapsed)}`;
        this.statusBarItem.color = new vscode.ThemeColor("charts.blue");
      } else {
        this.statusBarItem.text = `$(check) Quick Ops: success ${successCount}`;
        this.statusBarItem.color = new vscode.ThemeColor("testing.iconPassed");
      }

      this.statusBarItem.tooltip = this.getActiveCommandsTooltip();
      this.statusBarItem.show();
      this.ensureStatusTicker();
      return;
    }

    if (this.externalServers.size > 0) {
      this.statusBarItem.text = `$(radio-tower) Quick Ops: external success ${this.externalServers.size}`;
      this.statusBarItem.color = new vscode.ThemeColor("testing.iconPassed");
      this.statusBarItem.tooltip = [
        "监听到外部启动的本地服务",
        "",
        ...Array.from(this.externalServers.values()).map(
          (item) => `${item.label} · http://localhost:${item.port}`,
        ),
        "",
        "说明：这是通过 localhost 端口探测识别的，不是读取外部终端输出。",
      ].join("\n");
      this.statusBarItem.show();
      this.ensureStatusTicker();
      return;
    }

    if (this.lastStatus.type === "success") {
      this.statusBarItem.text = "$(check) Quick Ops: success";
      this.statusBarItem.color = new vscode.ThemeColor("testing.iconPassed");
    } else if (this.lastStatus.type === "failed") {
      this.statusBarItem.text = "$(error) Quick Ops: failed";
      this.statusBarItem.color = new vscode.ThemeColor("testing.iconFailed");
    } else if (this.lastStatus.type === "cancelled") {
      this.statusBarItem.text = "$(warning) Quick Ops: cancelled";
      this.statusBarItem.color = new vscode.ThemeColor(
        "list.warningForeground",
      );
    } else if (this.lastStatus.type === "external") {
      this.statusBarItem.text = "$(radio-tower) Quick Ops: external success";
      this.statusBarItem.color = new vscode.ThemeColor("testing.iconPassed");
    } else {
      this.statusBarItem.text = "$(rocket) Quick Ops";
      this.statusBarItem.color = undefined;
    }

    this.statusBarItem.tooltip = this.getActiveCommandsTooltip();
    this.statusBarItem.show();
    this.stopStatusTickerIfIdle();
  }

  private setLastCommandStatus(
    type: "success" | "failed" | "cancelled",
    displayName: string,
    command: string,
    message?: string,
  ) {
    this.lastStatus = {
      type,
      displayName,
      command,
      message,
    };
    this.updateScriptStatusBar();
  }

  private isStartupSuccessOutput(output: string) {
    const value = output.toLowerCase();

    return [
      "compiled successfully",
      "successfully compiled",
      "built in",
      "build complete",
      "build completed",
      "done in",
      "ready in",
      "local:",
      "network:",
      "localhost:",
      "127.0.0.1:",
      "server running",
      "server started",
      "started server",
      "listening on",
      "running at",
      "app running",
    ].some((keyword) => value.includes(keyword));
  }

  private markCommandSuccess(
    commandId: number,
    options?: { port?: number; url?: string },
  ) {
    const commandItem = this.activeCommands.get(commandId);

    if (!commandItem || commandItem.state === "success") return;

    this.activeCommands.set(commandId, {
      ...commandItem,
      state: "success",
      progress: 100,
      successAt: Date.now(),
      url: options?.url || commandItem.url,
      ports:
        options?.port && !commandItem.ports.includes(options.port)
          ? [...commandItem.ports, options.port]
          : commandItem.ports,
    });
    this.lastStatus = {
      type: "success",
      displayName: commandItem.displayName,
      command: commandItem.command,
    };
    this.updateScriptStatusBar();
  }

  private getSafeProcessEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    const nodeOptions = env.NODE_OPTIONS || '';

    if (nodeOptions.includes('quickops-boot.js')) {
      const parts = nodeOptions
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean);

      const nextParts: string[] = [];

      for (let index = 0; index < parts.length; index++) {
        const item = parts[index];
        const nextItem = parts[index + 1] || '';

        if (item.includes('quickops-boot.js')) {
          continue;
        }

        if ((item === '-r' || item === '--require') && nextItem.includes('quickops-boot.js')) {
          index++;
          continue;
        }

        if (item.startsWith('-r') && item.includes('quickops-boot.js')) {
          continue;
        }

        if (item.startsWith('--require=') && item.includes('quickops-boot.js')) {
          continue;
        }

        nextParts.push(item);
      }

      if (nextParts.length > 0) {
        env.NODE_OPTIONS = nextParts.join(' ');
      } else {
        delete env.NODE_OPTIONS;
      }
    }

    return env;
  }

  private executeCommandInBackground(
    command: string,
    cwd: string,
    displayName: string,
  ): void {
    const commandId = ++this.commandSeq;
    const outputBuffer: string[] = [];
    let settled = false;

    this.activeCommands.set(commandId, {
      displayName,
      command,
      cwd,
      state: "running",
      startedAt: Date.now(),
      progress: 3,
      ports: this.extractPortsFromText(command),
      source: "quickops",
      commandType: this.getCommandType(command, displayName),
    });
    this.lastStatus = { type: "idle" };
    this.updateScriptStatusBar();
    this.ensureStatusTicker();
    this.detectExternalServers().catch(() => undefined);

    const childProcess = spawn(command, {
      cwd,
      env: this.getSafeProcessEnv(),
      shell: true,
      windowsHide: true,
    });

    const handleOutput = (chunk: Buffer | string) => {
      this.appendCommandOutput(outputBuffer, chunk);

      const value = Buffer.isBuffer(chunk)
        ? chunk.toString("utf8")
        : String(chunk);
      const detectedPorts = this.extractPortsFromText(value);

      if (detectedPorts.length > 0) {
        const commandItem = this.activeCommands.get(commandId);

        if (commandItem) {
          const ports = Array.from(
            new Set([...commandItem.ports, ...detectedPorts]),
          );
          const urlPort = detectedPorts[0];

          this.activeCommands.set(commandId, {
            ...commandItem,
            ports,
            url: commandItem.url || `http://localhost:${urlPort}`,
            progress: Math.max(commandItem.progress, 80),
            lastOutputAt: Date.now(),
          });
        }
      }

      if (this.isStartupSuccessOutput(value)) {
        this.markCommandSuccess(
          commandId,
          detectedPorts[0]
            ? {
                port: detectedPorts[0],
                url: `http://localhost:${detectedPorts[0]}`,
              }
            : undefined,
        );
      }
    };

    childProcess.stdout?.on("data", handleOutput);
    childProcess.stderr?.on("data", handleOutput);

    childProcess.on("error", (error) => {
      if (settled) return;

      settled = true;
      const commandItem = this.activeCommands.get(commandId);

      this.activeCommands.delete(commandId);
      this.setLastCommandStatus(
        "failed",
        commandItem?.displayName || displayName,
        commandItem?.command || command,
        error.message,
      );
      vscode.window.showErrorMessage(
        this.getCommandErrorMessage(error, outputBuffer.join(""), command),
      );
    });

    childProcess.on("close", (code, signal) => {
      if (settled) return;

      settled = true;
      const commandItem = this.activeCommands.get(commandId);
      const currentState = commandItem?.state || "running";

      this.activeCommands.delete(commandId);

      if (signal) {
        this.setLastCommandStatus(
          "cancelled",
          displayName,
          command,
          `信号：${signal}`,
        );
        return;
      }

      if (code && code !== 0) {
        const errorMessage = `退出码 ${code}`;

        this.setLastCommandStatus("failed", displayName, command, errorMessage);
        vscode.window.showErrorMessage(
          this.getCommandErrorMessage(
            new Error(errorMessage),
            outputBuffer.join(""),
            command,
          ),
        );
        return;
      }

      this.setLastCommandStatus("success", displayName, command);

      if (currentState !== "success") {
        this.updateScriptStatusBar();
      }
    });
  }

  private async runScript(item: ScriptItem) {
    let finalCommand = item.commandToExecute;

    if (!finalCommand) {
      return;
    }

    if (item.payload && Object.keys(item.payload).length > 0) {
      for (const [key, value] of Object.entries(item.payload)) {
        if (Array.isArray(value)) {
          const choice = await vscode.window.showQuickPick(value.map(String), {
            placeHolder: `Select value for ${key}`,
            ignoreFocusOut: true,
          });
          if (!choice) return;
          finalCommand = finalCommand.replace(
            new RegExp(`\\[\\[\\s*${key}\\s*\\]\\]`, "g"),
            choice,
          );
        }
      }
    }

    if (item.isNpmScript) {
      const packageManager = await this.selectPackageManager(item.cwd);
      if (!packageManager) return;
      finalCommand = `${packageManager}${packageManager === "yarn" ? ` ${finalCommand}` : ` run ${finalCommand}`}`;
    }

    this.executeCommandInBackground(
      finalCommand,
      item.cwd,
      this.getScriptDisplayName(item),
    );
  }
}
