import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { IService } from '../core/interfaces/IService';
import * as path from 'path';

const execAsync = promisify(exec);

export class GitIntegrationService implements IService {
    public readonly serviceId = 'GitIntegrationService';
    private static _instance: GitIntegrationService;

    private constructor() {}

    public static getInstance(): GitIntegrationService {
        if (!this._instance) {
            this._instance = new GitIntegrationService();
        }
        return this._instance;
    }

    public init(): void {}

    private get workspaceRoot(): string | null {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
    }

    /**
     * 切换文件的 Git 跟踪模式
     * @param filePath 相对路径或绝对路径
     * @param mode 'public' (公共使用/跟踪) | 'private' (单独使用/本地忽略)
     */
    public async setFileTrackingMode(filePath: string, mode: 'public' | 'private') {
        const root = this.workspaceRoot;
        if (!root) return;

        // 确保是相对路径，用于 git 命令
        const relativePath = path.isAbsolute(filePath) ? path.relative(root, filePath) : filePath;
        
        try {
            if (mode === 'private') {
                // 方案 A: skip-worktree (适用于文件已经在仓库中，但你想在本地魔改且不提交)
                // git update-index --skip-worktree .logrc
                await execAsync(`git update-index --skip-worktree "${relativePath}"`, { cwd: root });
                vscode.window.showInformationMessage(`[Git] ${relativePath} 已设置为“单独使用模式” (本地修改将不会被提交)`);
            } else {
                // 方案 B: no-skip-worktree (恢复跟踪，你的修改会变成待提交状态)
                // git update-index --no-skip-worktree .logrc
                await execAsync(`git update-index --no-skip-worktree "${relativePath}"`, { cwd: root });
                vscode.window.showInformationMessage(`[Git] ${relativePath} 已设置为“公共使用模式” (本地修改将被 Git 捕获)`);
            }
        } catch (error: any) {
            // 如果文件还没被 git add 过，update-index 会报错，这里可以做降级处理（比如加到 .gitignore）
            console.error('Git operation failed:', error);
            
            if (mode === 'private' && error.message.includes('Unable to mark file')) {
                 vscode.window.showWarningMessage('该文件尚未被 Git 跟踪，请先提交一次，或直接添加到 .gitignore。');
            } else {
                 vscode.window.showErrorMessage(`Git 操作失败: ${error.message}`);
            }
        }
    }

    /**
     * 检查当前文件的状态（可选功能，用于UI显示当前是 Public 还是 Private）
     */
    public async checkFileStatus(filePath: string): Promise<'public' | 'private' | 'untracked'> {
        const root = this.workspaceRoot;
        if (!root) return 'untracked';
        const relativePath = path.isAbsolute(filePath) ? path.relative(root, filePath) : filePath;

        try {
            // ls-files -v 输出格式：
            // H .logrc (H = cached/tracked, Public)
            // S .logrc (S = skip-worktree, Private)
            const { stdout } = await execAsync(`git ls-files -v "${relativePath}"`, { cwd: root });
            const status = stdout.trim().charAt(0);
            
            if (status === 'S') return 'private';
            if (status === 'H') return 'public';
            return 'untracked';
        } catch {
            return 'untracked';
        }
    }
}