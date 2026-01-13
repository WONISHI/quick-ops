import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { IService } from '../core/interfaces/IService';

export class GitService implements IService {
  public readonly serviceId = 'GitService';
  private static _instance: GitService;

  // 缓存上一份忽略列表，用于对比差异
  private _previousIgnoreList: string[] = [];

  private constructor() {}

  public static getInstance(): GitService {
    if (!this._instance) this._instance = new GitService();
    return this._instance;
  }

  public init(): void {}

  /**
   * 核心入口：处理忽略列表的变更
   * @param newIgnoreList 新的配置列表
   * @param configDir .logrc 文件所在的目录（用于解析相对路径）
   */
  public async updateIgnoreRules(newIgnoreList: string[], configDir: string) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return;

    const rootPath = workspaceFolders[0].uri.fsPath;

    // 1. 计算差异：哪些是新增的（需要忽略），哪些是移除的（需要恢复跟踪）
    const toIgnore = newIgnoreList.filter((item) => !this._previousIgnoreList.includes(item));
    const toTrack = this._previousIgnoreList.filter((item) => !newIgnoreList.includes(item));

    // 更新缓存
    this._previousIgnoreList = [...newIgnoreList];

    // 2. 执行忽略 (assume-unchanged)
    for (const pattern of toIgnore) {
      const files = await this.resolveFiles(pattern, rootPath, configDir);
      for (const file of files) {
        this.executeGitCommand(file, '--skip-worktree', rootPath);
      }
    }

    // 3. 执行恢复 (no-assume-unchanged)
    for (const pattern of toTrack) {
      const files = await this.resolveFiles(pattern, rootPath, configDir);
      for (const file of files) {
        this.executeGitCommand(file, '--no-skip-worktree', rootPath);
      }
    }
  }

  /**
   * 解析路径规则
   * - ./ 或 ../ 开头：基于 configDir 解析相对路径
   * - 其他：基于 workspace 查找所有匹配的文件名
   */
  private async resolveFiles(pattern: string, rootPath: string, configDir: string): Promise<string[]> {
    const filesToProcess: string[] = [];

    if (pattern.startsWith('./') || pattern.startsWith('../')) {
      // 相对路径逻辑
      const absolutePath = path.resolve(configDir, pattern);
      if (fs.existsSync(absolutePath)) {
        filesToProcess.push(absolutePath);
      }
    } else {
      // 全局文件名搜索逻辑 (排除 node_modules)
      // glob pattern: **/{pattern}
      const foundUris = await vscode.workspace.findFiles(`**/${pattern}`, '**/node_modules/**');
      foundUris.forEach((uri) => filesToProcess.push(uri.fsPath));
    }

    return filesToProcess;
  }

  /**
   * 执行 git update-index 命令
   */
  private executeGitCommand(filePath: string, flag: string, cwd: string) {
    // 使用引号包裹路径，防止文件名带空格报错
    const command = `git update-index ${flag} "${filePath}"`;

    exec(command, { cwd }, (error, stdout, stderr) => {
      if (error) {
        // 如果文件是新创建的还没 commit 过，git 会报错，这里选择 warn 而不是 error
        console.warn(`[GitService] Failed to set ${flag} for ${path.basename(filePath)}: ${stderr.trim()}`);
      } else {
        console.log(`[GitService] Success: ${path.basename(filePath)} -> ${flag}`);
      }
    });
  }
}
