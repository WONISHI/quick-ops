import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import type {
  CompareSelection,
  RecentProjectItem,
  RecentProjectPlatform,
  RemoteProjectParseResult,
} from './recent-projects.type';

const execFileAsync = promisify(execFile);

export class RecentProjectsService {
  public static inject = [ExtensionContextProvider];

  private readonly storageKey = 'quickOps.recentProjects';
  private compareSelection: CompareSelection | undefined;

  constructor(private readonly extensionContextProvider: ExtensionContextProvider) {}

  public getRecentProjects(): RecentProjectItem[] {
    const context = this.extensionContextProvider.getContext();

    return context.globalState.get<RecentProjectItem[]>(this.storageKey, []);
  }

  public async saveRecentProjects(projects: RecentProjectItem[]): Promise<void> {
    const context = this.extensionContextProvider.getContext();

    await context.globalState.update(this.storageKey, projects);
  }

  public async insertProjectToHistory(
    name: string,
    fsPath: string,
    platform: RecentProjectPlatform = 'local',
    customDomain?: string,
  ): Promise<RecentProjectItem> {
    const projects = this.getRecentProjects();
    const normalizedPath = this.normalizeProjectPath(fsPath);
    const existed = projects.find(item => {
      return this.normalizeProjectPath(item.fsPath) === normalizedPath;
    });

    const now = Date.now();

    if (existed) {
      existed.name = name;
      existed.platform = platform;
      existed.customDomain = customDomain;
      existed.lastOpenedAt = now;

      await this.saveRecentProjects(this.sortProjects(projects));

      return existed;
    }

    const project: RecentProjectItem = {
      id: this.createId(),
      name,
      fsPath,
      platform,
      customDomain,
      lastOpenedAt: now,
      createdAt: now,
    };

    await this.saveRecentProjects(this.sortProjects([project, ...projects]));

    return project;
  }

  public async addLocalProject(): Promise<RecentProjectItem | undefined> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: '添加项目',
      title: '选择一个本地项目文件夹',
    });

    const uri = uris?.[0];

    if (!uri) return undefined;

    const uriStr = uri.toString();
    const existed = this.getRecentProjects().some(item => item.fsPath === uriStr);

    if (existed) {
      vscode.window.showWarningMessage('⚠️ 该本地项目已存在于列表中！');
      return undefined;
    }

    const folderName = path.basename(uri.fsPath) || '本地项目';

    const project = await this.insertProjectToHistory(
      folderName,
      uriStr,
      'local',
    );

    vscode.window.showInformationMessage(`✅ 已添加本地项目: ${folderName}`);

    return project;
  }

  public async addRemoteProject(): Promise<RecentProjectItem | undefined> {
    const input = await vscode.window.showInputBox({
      title: '添加远程仓库',
      placeHolder: 'GitHub/GitLab/Gitee 地址，例如 owner/repo 或 https://github.com/owner/repo',
      prompt: '输入远程仓库地址',
    });

    if (!input) return undefined;

    const parsed = this.parseRemoteUrlInput(input);

    if (!parsed) {
      vscode.window.showErrorMessage('❌ 无效的远程地址格式，请检查。');
      return undefined;
    }

    const existed = this.getRecentProjects().some(item => {
      return item.fsPath === parsed.targetUriStr;
    });

    if (existed) {
      vscode.window.showWarningMessage('⚠️ 该远程项目已存在于列表中！');
      return undefined;
    }

    const projectName = await vscode.window.showInputBox({
      title: '确认远程项目名称',
      value: parsed.repoFullName.split('/').pop() || parsed.repoFullName,
    });

    if (!projectName) return undefined;

    const project = await this.insertProjectToHistory(
      projectName,
      parsed.targetUriStr,
      parsed.platform,
      parsed.customDomain,
    );

    vscode.window.showInformationMessage(`✅ 已添加远程项目: ${projectName}`);

    return project;
  }

  public async clearAll(): Promise<void> {
    const answer = await vscode.window.showWarningMessage(
      '确定要清空最近项目列表吗？',
      {
        modal: true,
      },
      '清空',
    );

    if (answer !== '清空') return;

    await this.saveRecentProjects([]);

    vscode.window.showInformationMessage('最近项目列表已清空');
  }

  public parseRemoteUrlInput(input: string): RemoteProjectParseResult | null {
    const value = input.trim();

    if (!value) return null;

    let platform: RecentProjectPlatform = 'remote';
    let repoFullName = '';
    let customDomain: string | undefined;

    const simpleRepoMatch = value.match(/^([^/\s]+\/[^/\s]+)$/);

    if (simpleRepoMatch) {
      repoFullName = simpleRepoMatch[1];
      platform = 'github';
    } else if (/^git@/i.test(value)) {
      const match = value.match(/^git@([^:]+):(.+?)(?:\.git)?$/i);

      if (!match) return null;

      customDomain = match[1];
      repoFullName = match[2].replace(/\.git$/i, '');

      platform = this.detectRemotePlatform(customDomain);
    } else {
      let url: URL;

      try {
        url = new URL(value);
      } catch {
        return null;
      }

      customDomain = url.hostname;
      repoFullName = url.pathname.replace(/^\/+/, '').replace(/\.git$/i, '');

      platform = this.detectRemotePlatform(customDomain);
    }

    if (!repoFullName || !repoFullName.includes('/')) {
      return null;
    }

    const authority = customDomain || platform || 'github';
    const targetUriStr = `vscode-vfs://${authority}/${repoFullName}`;

    return {
      repoFullName,
      targetUriStr,
      platform,
      customDomain,
    };
  }

  public async syncAllBranches(): Promise<void> {
    const projects = this.getRecentProjects();

    const nextProjects = await Promise.all(
      projects.map(async project => {
        if (project.platform && project.platform !== 'local') {
          return project;
        }

        const uri = this.toUri(project.fsPath);

        if (!uri || uri.scheme !== 'file') {
          return project;
        }

        const branch = await this.getGitBranch(uri.fsPath);

        return {
          ...project,
          branch: branch || project.branch,
        };
      }),
    );

    await this.saveRecentProjects(this.sortProjects(nextProjects));
  }

  public selectForCompare(uri: string): void {
    this.compareSelection = {
      uri,
      selectedAt: Date.now(),
    };

    vscode.window.showInformationMessage('已选择比较源，请再选择一个文件进行比较');
  }

  public async compareWithSelected(targetUri: string): Promise<void> {
    if (!this.compareSelection) {
      vscode.window.showWarningMessage('请先选择一个文件作为比较源');
      return;
    }

    const sourceUri = this.toUri(this.compareSelection.uri);
    const target = this.toUri(targetUri);

    if (!sourceUri || !target) {
      vscode.window.showWarningMessage('比较失败：文件路径无效');
      return;
    }

    await vscode.commands.executeCommand(
      'vscode.diff',
      sourceUri,
      target,
      `${path.basename(sourceUri.path)} ↔ ${path.basename(target.path)}`,
    );

    this.compareSelection = undefined;
  }

  public toUri(value: string): vscode.Uri | undefined {
    if (!value) return undefined;

    try {
      if (value.includes('://')) {
        return vscode.Uri.parse(value);
      }

      return vscode.Uri.file(value);
    } catch {
      return undefined;
    }
  }

  public normalizeProjectPath(value: string): string {
    return value.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  }

  public isRemoteProject(project: RecentProjectItem): boolean {
    if (project.platform && project.platform !== 'local') return true;

    return !project.fsPath.startsWith('file:') && project.fsPath.includes('://');
  }

  private detectRemotePlatform(domain: string): RecentProjectPlatform {
    const lower = domain.toLowerCase();

    if (lower.includes('github.com')) return 'github';
    if (lower.includes('gitlab.com')) return 'gitlab';
    if (lower.includes('gitee.com')) return 'gitee';

    return 'remote';
  }

  private sortProjects(projects: RecentProjectItem[]): RecentProjectItem[] {
    return [...projects].sort((a, b) => {
      return b.lastOpenedAt - a.lastOpenedAt;
    });
  }

  private async getGitBranch(cwd: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['branch', '--show-current'],
        {
          cwd,
        },
      );

      return stdout.trim();
    } catch {
      return '';
    }
  }

  private createId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}