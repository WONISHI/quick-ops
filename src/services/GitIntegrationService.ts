import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { IService } from '../core/interfaces/IService';

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
   * 检查文件是否被 Git 跟踪
   */
  public async isGitTracked(filePath: string): Promise<boolean> {
    const root = this.workspaceRoot;
    if (!root) return false;

    try {
      await execAsync(`git ls-files --error-unmatch "${filePath}"`, { cwd: root });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 更新本地忽略文件 (.git/info/exclude)
   */
  public updateLocalIgnore(filesToIgnore: string[]) {
    const root = this.workspaceRoot;
    if (!root) return;

    const excludeFile = path.join(root, '.git', 'info', 'exclude');
    if (!fs.existsSync(excludeFile)) return;

    try {
      const content = fs.readFileSync(excludeFile, 'utf-8');
      const lines = content.split(/\r?\n/);

      // 简单的追加逻辑，避免重复
      const newLines = filesToIgnore.filter((f) => !lines.includes(f.trim()));

      if (newLines.length > 0) {
        fs.appendFileSync(excludeFile, '\n' + newLines.join('\n'));
        vscode.window.showInformationMessage(`Added ${newLines.length} files to local ignore.`);
      }
    } catch (error) {
      console.error('[GitService] Failed to update exclude file', error);
    }
  }
}
