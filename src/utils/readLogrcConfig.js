"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.onDidChangeLogrcConfig = void 0;
exports.registerLogrcConfig = registerLogrcConfig;
exports.getLogrcConfig = getLogrcConfig;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
let currentConfig = null;
let watchers = [];
// 创建事件发射器
const _onDidChangeConfig = new vscode.EventEmitter();
exports.onDidChangeLogrcConfig = _onDidChangeConfig.event;
/**
 * 注册读取并监听项目 & 插件自带的 .logrc 配置
 */
function registerLogrcConfig(context) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const rootPath = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : null;
    const loadConfig = () => {
        let configPath = null;
        // 1️⃣ 优先读取项目根目录
        if (rootPath) {
            const projectConfig = path.join(rootPath, '.logrc');
            if (fs.existsSync(projectConfig))
                configPath = projectConfig;
        }
        if (!configPath) {
            currentConfig = null;
            _onDidChangeConfig.fire(currentConfig);
            return;
        }
        try {
            const content = fs.readFileSync(configPath, 'utf-8').trim();
            currentConfig = JSON.parse(content);
            _onDidChangeConfig.fire(currentConfig);
        }
        catch (err) {
            currentConfig = null;
            _onDidChangeConfig.fire(currentConfig);
            vscode.window.showErrorMessage(`读取或解析 .logrc 文件失败: ${err}`);
        }
    };
    // 初次加载配置
    loadConfig();
    // 创建安全 watcher
    const createWatcher = (watchFolder) => {
        if (!watchFolder || !fs.existsSync(watchFolder))
            return;
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(watchFolder, '.logrc'));
        watcher.onDidChange(loadConfig);
        watcher.onDidCreate(loadConfig);
        watcher.onDidDelete(() => {
            currentConfig = null;
            _onDidChangeConfig.fire(currentConfig);
        });
        context.subscriptions.push(watcher);
        watchers.push(watcher);
    };
    // 监听项目根目录 .logrc
    if (rootPath)
        createWatcher(rootPath);
}
;
/**
 * 获取最新的 .logrc 配置
 */
function getLogrcConfig() {
    return currentConfig;
}
//# sourceMappingURL=readLogrcConfig.js.map