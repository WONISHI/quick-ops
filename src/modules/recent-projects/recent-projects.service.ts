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

  /**
   * @description 兼容重构前可能使用过的历史 key。
   *
   * 如果新 key 读取不到数据，会尝试从旧 key 中恢复，
   * 并自动迁移到 quickOps.recentProjects。
   */
  private readonly legacyStorageKeys = [
    'recentProjects',
    'quickOps.recentProjectList',
    'quickOps.recent-projects',
    'quickOps.recentProjects.list',
  ];

  private compareSelection: CompareSelection | undefined;

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
  ) {}

  public getRecentProjects(): RecentProjectItem[] {
    const context = this.extensionContextProvider.getContext();

    const currentProjects = context.globalState.get<RecentProjectItem[]>(
      this.storageKey,
      [],
    );

    if (Array.isArray(currentProjects) && currentProjects.length > 0) {
      return this.sortProjects(currentProjects);
    }

    for (const legacyKey of this.legacyStorageKeys) {
      const legacyProjects = context.globalState.get<RecentProjectItem[]>(
        legacyKey,
        [],
      );

      if (Array.isArray(legacyProjects) && legacyProjects.length > 0) {
        const normalizedProjects = legacyProjects.map(project => {
          return this.normalizeProject(project);
        });

        void context.globalState.update(this.storageKey, normalizedProjects);

        return this.sortProjects(normalizedProjects);
      }
    }

    return [];
  }

  public async saveRecentProjects(projects: RecentProjectItem[]): Promise<void> {
    const context = this.extensionContextProvider.getContext();

    const normalizedProjects = projects.map(project => {
      return this.normalizeProject(project);
    });

    await context.globalState.update(
      this.storageKey,
      this.sortProjects(normalizedProjects),
    );
  }

  public async insertProjectToHistory(
    name: string,
    fsPath: string,
    platform: RecentProjectPlatform = 'local',
    customDomain?: string,
  ): Promise<RecentProjectItem> {
    const projects = this.getRecentProjects();
    const normalizedPath = this.normalizeProjectPath(fsPath);
    const now = Date.now();

    const existed = projects.find(project => {
      return this.normalizeProjectPath(project.fsPath) === normalizedPath;
    });

    if (existed) {
      const updatedProject: RecentProjectItem = {
        ...existed,
        name: name || existed.name,
        fsPath,
        platform,
        customDomain,
        lastOpenedAt: now,
      };

      const nextProjects = projects.map(project => {
        if (this.normalizeProjectPath(project.fsPath) !== normalizedPath) {
          return project;
        }

        return updatedProject;
      });

      await this.saveRecentProjects(nextProjects);

      return updatedProject;
    }

    const project: RecentProjectItem = {
      id: this.createId(),
      name,
      fsPath,
      platform,
      customDomain,
      createdAt: now,
      lastOpenedAt: now,
    };

    await this.saveRecentProjects([project, ...projects]);

    return project;
  }

  public async updateProject(
    fsPath: string,
    patch: Partial<RecentProjectItem>,
  ): Promise<RecentProjectItem | undefined> {
    const normalizedPath = this.normalizeProjectPath(fsPath);
    let updatedProject: RecentProjectItem | undefined;

    const projects = this.getRecentProjects().map(project => {
      if (this.normalizeProjectPath(project.fsPath) !== normalizedPath) {
        return project;
      }

      updatedProject = this.normalizeProject({
        ...project,
        ...patch,
        id: patch.id || project.id,
        createdAt: patch.createdAt || project.createdAt,
        lastOpenedAt: patch.lastOpenedAt || Date.now(),
      });

      return updatedProject;
    });

    await this.saveRecentProjects(projects);

    return updatedProject;
  }

  public async removeProject(fsPath: string): Promise<void> {
    const normalizedPath = this.normalizeProjectPath(fsPath);

    const projects = this.getRecentProjects().filter(project => {
      return this.normalizeProjectPath(project.fsPath) !== normalizedPath;
    });

    await this.saveRecentProjects(projects);
  }

  public async touchProject(fsPath: string): Promise<void> {
    await this.updateProject(fsPath, {
      lastOpenedAt: Date.now(),
    });
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

    const existed = this.getRecentProjects().some(project => {
      return (
        this.normalizeProjectPath(project.fsPath) ===
        this.normalizeProjectPath(uriStr)
      );
    });

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
      placeHolder:
        'GitHub/GitLab/Gitee 地址，例如 owner/repo 或 https://github.com/owner/repo',
      prompt: '输入远程仓库地址',
      ignoreFocusOut: true,
      validateInput: value => {
        return value.trim() ? null : '远程仓库地址不能为空';
      },
    });

    if (!input) return undefined;

    const parsed = this.parseRemoteUrlInput(input);

    if (!parsed) {
      vscode.window.showErrorMessage('❌ 无效的远程地址格式，请检查。');
      return undefined;
    }

    const existed = this.getRecentProjects().some(project => {
      return (
        this.normalizeProjectPath(project.fsPath) ===
        this.normalizeProjectPath(parsed.targetUriStr)
      );
    });

    if (existed) {
      vscode.window.showWarningMessage('⚠️ 该远程项目已存在于列表中！');
      return undefined;
    }

    const projectName = await vscode.window.showInputBox({
      title: '确认远程项目名称',
      value: parsed.repoFullName.split('/').pop() || parsed.repoFullName,
      ignoreFocusOut: true,
      validateInput: value => {
        return value.trim() ? null : '项目名称不能为空';
      },
    });

    if (!projectName) return undefined;

    const project = await this.insertProjectToHistory(
      projectName.trim(),
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
    } else if (/^vscode-vfs:\/\//i.test(value)) {
      const uri = vscode.Uri.parse(value);

      customDomain = uri.authority;
      repoFullName = uri.path.replace(/^\/+/, '');
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
        if (this.isRemoteProject(project)) {
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

    await this.saveRecentProjects(nextProjects);
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

  private normalizeProject(project: RecentProjectItem): RecentProjectItem {
    const now = Date.now();

    return {
      ...project,
      id: project.id || this.createId(),
      name: project.name || this.getNameFromPath(project.fsPath),
      fsPath: project.fsPath,
      platform: project.platform || this.resolvePlatformByPath(project.fsPath),
      createdAt: project.createdAt || now,
      lastOpenedAt: project.lastOpenedAt || now,
    };
  }

  private resolvePlatformByPath(fsPath: string): RecentProjectPlatform {
    if (fsPath.startsWith('file:') || !fsPath.includes('://')) {
      return 'local';
    }

    if (fsPath.includes('github.com')) return 'github';
    if (fsPath.includes('gitlab.com')) return 'gitlab';
    if (fsPath.includes('gitee.com')) return 'gitee';

    return 'remote';
  }

  private getNameFromPath(fsPath: string): string {
    try {
      const uri = this.toUri(fsPath);

      if (!uri) return '项目';

      if (uri.scheme === 'file') {
        return path.basename(uri.fsPath) || '本地项目';
      }

      return path.basename(uri.path) || uri.authority || '远程项目';
    } catch {
      return '项目';
    }
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
      return (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0);
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