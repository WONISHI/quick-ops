import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { IService } from '../core/interfaces/IService';
import mergeClone from '../utils/mergeClone';

// ... ILogrcConfig 接口定义保持不变 ...
export interface ILogrcConfig {
    general: { debug: boolean; excludeConfigFiles: boolean };
    logger: { template: string; dateFormat: string };
    utils: { uuidLength: number };
    mock: { port: number; asyncMode: boolean; workerCount: number };
    git: { ignoreList: string[] };
    project: { alias: Record<string, string>; marks: Record<string, any> };
    [key: string]: any;
}

export class ConfigurationService extends EventEmitter implements IService {
    public readonly serviceId = 'ConfigurationService';
    private static _instance: ConfigurationService;

    private readonly _configFileName = '.logrc';
    private readonly _templateConfigPath = 'resources/template/logrc-template.json';
    
    private _config: ILogrcConfig = {} as ILogrcConfig;
    private _watcher: fs.FSWatcher | null = null;
    private _context?: vscode.ExtensionContext;

    private constructor() { super(); }

    public static getInstance(): ConfigurationService {
        if (!this._instance) this._instance = new ConfigurationService();
        return this._instance;
    }

    public get config(): Readonly<ILogrcConfig> { return this._config; }

    public get workspaceConfigPath(): string | null {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) return null;
        return path.join(workspaceFolders[0].uri.fsPath, this._configFileName);
    }

    public init(context?: vscode.ExtensionContext): void {
        this._context = context;
        this.loadConfig();
        this.watchConfigFile();
        // ✅ 初始化时立即更新上下文状态 (控制按钮显示/隐藏)
        this.updateContextKey();
        console.log(`[${this.serviceId}] Initialized.`);
    }

    public loadConfig(): void {
        const defaultConfig = this.loadInternalConfig();
        const userConfig = this.loadUserConfig();
        this._config = mergeClone(defaultConfig, userConfig);
        this.emit('configChanged', this._config);
    }

    /**
     * ✅ 关键方法：设置 VS Code 上下文
     * 当文件不存在时，设置 quickOps.context.configMissing = true，菜单按钮才会显示
     */
    private updateContextKey() {
        const filePath = this.workspaceConfigPath;
        const isNotFound = !filePath || !fs.existsSync(filePath);
        
        // 发送命令给 VS Code 核心
        vscode.commands.executeCommand('setContext', 'quickOps.context.configMissing', isNotFound);
    }

    private loadInternalConfig(): ILogrcConfig {
        if (!this._context) return {} as ILogrcConfig;
        const internalPath = path.join(this._context.extensionPath, this._configFileName);
        if (fs.existsSync(internalPath)) {
            try { return JSON.parse(fs.readFileSync(internalPath, 'utf-8')); } 
            catch (e) { console.error(e); }
        }
        return {} as ILogrcConfig;
    }

    private loadUserConfig(): Partial<ILogrcConfig> {
        const filePath = this.workspaceConfigPath;
        if (!filePath || !fs.existsSync(filePath)) return {};
        try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } 
        catch (error) { return {}; }
    }

    private watchConfigFile() {
        const filePath = this.workspaceConfigPath;
        if (!filePath) return;
        const watchTarget = fs.existsSync(filePath) ? filePath : path.dirname(filePath);

        if (this._watcher) { this._watcher.close(); this._watcher = null; }

        try {
            this._watcher = fs.watch(watchTarget, (eventType, filename) => {
                if (filename === this._configFileName || (filename && path.basename(filePath) === filename)) {
                    // 重新加载配置
                    setTimeout(() => this.loadConfig(), 100);
                    // ✅ 文件状态可能变了（被删除或被创建），更新上下文
                    this.updateContextKey();
                }
            });
        } catch (e) { console.warn(e); }
    }

    public createDefaultConfig(): void {
        const targetPath = this.workspaceConfigPath;
        if (!targetPath) {
            vscode.window.showErrorMessage('Quick Ops: 请先打开一个文件夹。');
            return;
        }
        if (fs.existsSync(targetPath)) return;

        try {
            let contentToWrite = "{}";
            if (this._context) {
                const templatePath = path.join(this._context.extensionPath, this._templateConfigPath);
                if (fs.existsSync(templatePath)) {
                    contentToWrite = fs.readFileSync(templatePath, 'utf-8');
                } else {
                    contentToWrite = JSON.stringify(this._config, null, 2);
                }
            }
            fs.writeFileSync(targetPath, contentToWrite, 'utf-8');
            vscode.window.showInformationMessage(`已创建 ${this._configFileName}`);
            
            this.loadConfig();
            this.watchConfigFile();
            // ✅ 创建成功后立即更新上下文，按钮会自动消失
            this.updateContextKey();

        } catch (error: any) {
            vscode.window.showErrorMessage(`创建失败: ${error.message}`);
        }
    }

    public dispose(): void {
        if (this._watcher) this._watcher.close();
        this.removeAllListeners();
    }
}