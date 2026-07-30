import * as vscode from 'vscode';
import * as path from 'path';
import * as https from 'https';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import type { CompareSelection, RecentProjectItem, RecentProjectPlatform, RemoteProjectParseResult, RemoteProjectInfo } from '@modules/recent-projects/recent-projects.type';

const execFileAsync = promisify(execFile);

export class RecentProjectsService {
  public static inject = [ExtensionContextProvider];

  private readonly storageKey = 'quickOps.recentProjects';

  /**
   * @description 兼容重构前使用过的历史 key。
   */
  private readonly legacyStorageKeys = [
    'quickOps.recentProjectsHistory',
    'recentProjects',
    'quickOps.recentProjectList',
    'quickOps.recent-projects',
    'quickOps.recentProjects.list',
  ];

  private compareSelection: CompareSelection | undefined;

  constructor(private readonly extensionContextProvider: ExtensionContextProvider) {}

  public getRecentProjects(): RecentProjectItem[] {
    const context = this.extensionContextProvider.getContext();
    const currentProjects = context.globalState.get<RecentProjectItem[]>(this.storageKey, []);

    if (Array.isArray(currentProjects) && currentProjects.length > 0) {
      return this.sortProjects(currentProjects.map((project) => this.normalizeProject(project)));
    }

    for (const legacyKey of this.legacyStorageKeys) {
      const legacyProjects = context.globalState.get<RecentProjectItem[]>(legacyKey, []);

      if (!Array.isArray(legacyProjects) || legacyProjects.length === 0) {
        continue;
      }

      const normalizedProjects = legacyProjects.map((project) => {
        return this.normalizeProject(project);
      });

      void context.globalState.update(this.storageKey, normalizedProjects);

      return this.sortProjects(normalizedProjects);
    }

    return [];
  }

  public async saveRecentProjects(projects: RecentProjectItem[]): Promise<void> {
    const context = this.extensionContextProvider.getContext();
    const normalizedProjects = projects.map((project) => {
      return this.normalizeProject(project);
    });

    await context.globalState.update(this.storageKey, this.sortProjects(normalizedProjects));
  }

  public async insertProjectToHistory(name: string, fsPath: string, platform: RecentProjectPlatform = 'local', customDomain?: string): Promise<RecentProjectItem> {
    const projects = this.getRecentProjects();
    const normalizedPath = this.normalizeProjectPath(fsPath);
    const now = Date.now();

    const existed = projects.find((project) => {
      return this.normalizeProjectPath(project.fsPath) === normalizedPath;
    });

    if (existed) {
      const updatedProject: RecentProjectItem = this.normalizeProject({
        ...existed,
        name: name || existed.name,
        fsPath,
        platform,
        customDomain,
        updatedAt: now,
        lastOpenedAt: now,
        timestamp: now,
      });

      const nextProjects = projects.map((project) => {
        return this.normalizeProjectPath(project.fsPath) === normalizedPath ? updatedProject : project;
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
      timestamp: now,
      createdAt: now,
      lastOpenedAt: now,
    };

    await this.saveRecentProjects([project, ...projects]);

    return project;
  }

  public async updateProject(fsPath: string, patch: Partial<RecentProjectItem>): Promise<RecentProjectItem | undefined> {
    const normalizedPath = this.normalizeProjectPath(fsPath);
    let updatedProject: RecentProjectItem | undefined;

    const projects = this.getRecentProjects().map((project) => {
      if (this.normalizeProjectPath(project.fsPath) !== normalizedPath) {
        return project;
      }

      const now = Date.now();

      updatedProject = this.normalizeProject({
        ...project,
        ...patch,
        id: patch.id || project.id,
        createdAt: patch.createdAt || project.createdAt,
        updatedAt: patch.updatedAt || now,
        lastOpenedAt: patch.lastOpenedAt || project.lastOpenedAt || now,
        timestamp: patch.timestamp || project.timestamp || now,
      });

      return updatedProject;
    });

    await this.saveRecentProjects(projects);

    return updatedProject;
  }

  public async removeProject(fsPath: string): Promise<void> {
    const normalizedPath = this.normalizeProjectPath(fsPath);
    const projects = this.getRecentProjects().filter((project) => {
      return this.normalizeProjectPath(project.fsPath) !== normalizedPath;
    });

    await this.saveRecentProjects(projects);
  }

  public async touchProject(fsPath: string): Promise<void> {
    const now = Date.now();

    await this.updateProject(fsPath, {
      timestamp: now,
      lastOpenedAt: now,
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
    const existed = this.getRecentProjects().some((project) => {
      return this.normalizeProjectPath(project.fsPath) === this.normalizeProjectPath(uriStr);
    });

    if (existed) {
      vscode.window.showWarningMessage('⚠️ 该本地项目已存在于列表中！');
      return undefined;
    }

    const folderName = path.basename(uri.fsPath) || '本地项目';
    const project = await this.insertProjectToHistory(folderName, uriStr, 'local');

    vscode.window.showInformationMessage(`✅ 已添加本地项目: ${folderName}`);

    return project;
  }

  public async addRemoteProject(): Promise<RecentProjectItem | undefined> {
    const input = await vscode.window.showInputBox({
      title: '添加远程仓库',
      placeHolder: 'GitHub/GitLab/Gitee 地址，例如 owner/repo 或 https://github.com/owner/repo',
      prompt: '输入远程仓库地址',
      ignoreFocusOut: true,
      validateInput: (value) => {
        return value.trim() ? null : '远程仓库地址不能为空';
      },
    });

    if (!input) return undefined;

    const parsed = this.parseRemoteUrlInput(input);

    if (!parsed) {
      vscode.window.showErrorMessage('❌ 无效的远程地址格式，请检查。');
      return undefined;
    }

    const existed = this.getRecentProjects().some((project) => {
      return this.normalizeProjectPath(project.fsPath) === this.normalizeProjectPath(parsed.targetUriStr);
    });

    if (existed) {
      vscode.window.showWarningMessage('⚠️ 该远程项目已存在于列表中！');
      return undefined;
    }

    const projectName = await vscode.window.showInputBox({
      title: '确认远程项目名称',
      value: parsed.repoFullName.split('/').pop() || parsed.repoFullName,
      ignoreFocusOut: true,
      validateInput: (value) => {
        return value.trim() ? null : '项目名称不能为空';
      },
    });

    if (!projectName) return undefined;

    const project = await this.insertProjectToHistory(projectName.trim(), parsed.targetUriStr, parsed.platform, parsed.customDomain);

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
      customDomain = 'github';
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
    const nextProjects: RecentProjectItem[] = [];

    for (const project of projects) {
      const branch = await this.resolveProjectBranch(project);

      nextProjects.push({
        ...project,
        branch: branch || project.branch,
      });
    }

    await this.saveRecentProjects(nextProjects);
  }

  public async updateSingleBranch(fsPath: string): Promise<string | undefined> {
    const project = this.getRecentProjects().find((item) => {
      return this.normalizeProjectPath(item.fsPath) === this.normalizeProjectPath(fsPath);
    });

    if (!project) return undefined;

    const branch = await this.resolveProjectBranch(project);

    await this.updateProject(fsPath, {
      branch,
    });

    return branch;
  }

  public async getRemoteBranches(project: RecentProjectItem): Promise<string[]> {
    const info = this.parseRemoteProject(project);

    if (!info) return [];

    const token = vscode.workspace.getConfiguration('quickOps.git').get<string>('githubToken');

    const headers: Record<string, string> = {
      'User-Agent': 'VSCode-QuickOps-Extension',
    };

    if (token && info.platform !== 'gitlab') {
      headers.Authorization = `token ${token}`;
    }

    if (info.platform === 'gitlab') {
      const hostname = this.resolveGitLabApiHostname(info.domain);
      const projectPath = encodeURIComponent(info.repoFullName);
      const result = await this.requestJson<any[]>({
        hostname,
        path: `/api/v4/projects/${projectPath}/repository/branches?per_page=100`,
        headers,
      });

      return Array.isArray(result) ? result.map((item) => String(item?.name || '')).filter(Boolean) : [];
    }

    if (info.platform === 'github') {
      const hostname = this.resolveGitHubApiHostname(info.domain);
      const result = await this.requestJson<any[]>({
        hostname,
        path: `/repos/${info.repoFullName}/branches?per_page=100`,
        headers,
      });

      return Array.isArray(result) ? result.map((item) => String(item?.name || '')).filter(Boolean) : [];
    }

    return [];
  }

  public withRemoteBranch(fsPath: string, branch: string): string {
    try {
      const uri = vscode.Uri.parse(fsPath);
      const params = new URLSearchParams(uri.query);

      params.set('ref', branch);

      return uri.with({ query: params.toString() }).toString();
    } catch {
      return fsPath;
    }
  }

  public selectForCompare(uri: string, displayName?: string): void {
    this.compareSelection = {
      uri,
      displayName,
      selectedAt: Date.now(),
    };

    vscode.window.showInformationMessage(displayName ? `已选择 “${displayName}” 进行比较` : '已选择比较源，请再选择一个文件进行比较');
  }

  public async compareWithSelected(targetUri: string, targetDisplayName?: string): Promise<void> {
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

    const sourceName = this.compareSelection.displayName || path.basename(sourceUri.path);
    const targetName = targetDisplayName || path.basename(target.path);

    await vscode.commands.executeCommand('vscode.diff', sourceUri, target, `${sourceName} ↔ ${targetName}`);
  }

  public toUri(value: string): vscode.Uri | undefined {
    if (!value) return undefined;

    try {
      if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value)) {
        return vscode.Uri.parse(value);
      }

      return vscode.Uri.file(value);
    } catch {
      return undefined;
    }
  }

  public normalizeProjectPath(value: string): string {
    return value.trim().split('?')[0].replace(/\\/g, '/').replace(/\/+$/, '');
  }

  public isRemoteProject(project: RecentProjectItem): boolean {
    if (project.platform && project.platform !== 'local') return true;

    return !project.fsPath.startsWith('file:') && project.fsPath.includes('://');
  }

  private async resolveProjectBranch(project: RecentProjectItem): Promise<string | undefined> {
    if (this.isRemoteProject(project)) {
      const refMatch = project.fsPath.match(/[?&]ref=([^&]+)/);

      if (refMatch) {
        return decodeURIComponent(refMatch[1]);
      }

      return this.fetchDefaultBranch(project);
    }

    const uri = this.toUri(project.fsPath);

    if (!uri || uri.scheme !== 'file') return undefined;

    return this.getGitBranch(uri.fsPath);
  }

  private async fetchDefaultBranch(project: RecentProjectItem): Promise<string | undefined> {
    const info = this.parseRemoteProject(project);

    if (!info) return undefined;

    const token = vscode.workspace.getConfiguration('quickOps.git').get<string>('githubToken');

    const headers: Record<string, string> = {
      'User-Agent': 'VSCode-QuickOps-Extension',
    };

    if (token && info.platform !== 'gitlab') {
      headers.Authorization = `token ${token}`;
    }

    if (info.platform === 'gitlab') {
      const hostname = this.resolveGitLabApiHostname(info.domain);
      const projectPath = encodeURIComponent(info.repoFullName);
      const result = await this.requestJson<any>({
        hostname,
        path: `/api/v4/projects/${projectPath}`,
        headers,
      });

      return String(result?.default_branch || '') || undefined;
    }

    if (info.platform === 'github') {
      const hostname = this.resolveGitHubApiHostname(info.domain);
      const result = await this.requestJson<any>({
        hostname,
        path: `/repos/${info.repoFullName}`,
        headers,
      });

      return String(result?.default_branch || '') || undefined;
    }

    return undefined;
  }

  private parseRemoteProject(project: RecentProjectItem): RemoteProjectInfo | undefined {
    const fsPath = String(project.fsPath || '').trim();

    if (!fsPath) return undefined;

    try {
      const uri = vscode.Uri.parse(fsPath);
      const platform = project.platform || this.detectRemotePlatform(uri.authority);
      const domain = project.customDomain || uri.authority;
      const repoFullName = uri.path.replace(/^\/+/, '').replace(/\.git$/i, '');

      if (!repoFullName || !repoFullName.includes('/')) return undefined;

      return {
        platform,
        domain,
        repoFullName,
      };
    } catch {
      return undefined;
    }
  }

  private resolveGitHubApiHostname(domain: string): string {
    const value = String(domain || '').toLowerCase();

    if (!value || value === 'github' || value === 'github.com') {
      return 'api.github.com';
    }

    return domain;
  }

  private resolveGitLabApiHostname(domain: string): string {
    const value = String(domain || '').toLowerCase();

    if (!value || value === 'gitlab' || value === 'gitlab.com') {
      return 'gitlab.com';
    }

    return domain;
  }

  private requestJson<T>(options: https.RequestOptions): Promise<T | undefined> {
    return new Promise((resolve) => {
      const request = https.get(options, (response) => {
        let data = '';

        response.on('data', (chunk) => {
          data += chunk;
        });

        response.on('end', () => {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            resolve(undefined);
            return;
          }

          try {
            resolve(JSON.parse(data) as T);
          } catch {
            resolve(undefined);
          }
        });
      });

      request.on('error', () => resolve(undefined));
      request.setTimeout(10_000, () => {
        request.destroy();
        resolve(undefined);
      });
    });
  }

  private normalizeProject(project: RecentProjectItem): RecentProjectItem {
    const now = Date.now();
    const legacyTimestamp = Number(project.timestamp || 0);
    const createdAt = Number(project.createdAt || legacyTimestamp || now);
    const lastOpenedAt = Number(project.lastOpenedAt || project.updatedAt || legacyTimestamp || createdAt);

    return {
      ...project,
      id: project.id || this.createId(),
      name: project.name || this.getNameFromPath(project.fsPath),
      fsPath: project.fsPath,
      platform: project.platform || this.resolvePlatformByPath(project.fsPath),
      timestamp: legacyTimestamp || lastOpenedAt,
      createdAt,
      lastOpenedAt,
    };
  }

  private resolvePlatformByPath(fsPath: string): RecentProjectPlatform {
    if (fsPath.startsWith('file:') || !fsPath.includes('://')) {
      return 'local';
    }

    const value = fsPath.toLowerCase();

    if (value.includes('github')) return 'github';
    if (value.includes('gitlab')) return 'gitlab';
    if (value.includes('gitee')) return 'gitee';

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
    const lower = String(domain || '').toLowerCase();

    if (lower === 'github' || lower.includes('github.com')) return 'github';
    if (lower === 'gitlab' || lower.includes('gitlab.com')) return 'gitlab';
    if (lower === 'gitee' || lower.includes('gitee.com')) return 'gitee';

    return 'remote';
  }

  private sortProjects(projects: RecentProjectItem[]): RecentProjectItem[] {
    return [...projects].sort((a, b) => {
      return (b.lastOpenedAt || b.timestamp || 0) - (a.lastOpenedAt || a.timestamp || 0);
    });
  }

  private async getGitBranch(cwd: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', ['branch', '--show-current'], {
        cwd,
      });

      const branch = String(stdout).trim();

      if (branch) return branch;

      const { stdout: commit } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd,
      });

      return String(commit).trim();
    } catch {
      return '';
    }
  }

  private createId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
