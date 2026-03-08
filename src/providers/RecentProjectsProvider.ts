import * as vscode from 'vscode';

// 数据结构
export interface RecentProject {
  name: string;
  fsPath: string;
  timestamp: number;
}

// 树形节点
export class RecentProjectItem extends vscode.TreeItem {
  constructor(public readonly project: RecentProject, isCurrent: boolean) {
    super(project.name, vscode.TreeItemCollapsibleState.None);
    
    // 🌟 强制分配唯一 ID，彻底解决同名项目产生的异常缩进Bug
    this.id = project.fsPath; 
    
    this.tooltip = project.fsPath;
    this.description = isCurrent ? '当前项目' : project.fsPath;
    this.iconPath = new vscode.ThemeIcon(isCurrent ? 'folder-opened' : 'folder');
    this.contextValue = 'recentProjectItem';

    this.command = {
      title: '打开项目',
      command: 'quickOps.openRecentProject',
      arguments: [this.project.fsPath]
    };
  }
}

export class RecentProjectsProvider implements vscode.TreeDataProvider<RecentProjectItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<RecentProjectItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private stateKey = 'quickOps.recentProjectsHistory';

  // ================= 🌟 双击判定状态变量 =================
  private lastClickTime: number = 0;
  private lastClickedPath: string = '';

  constructor(private context: vscode.ExtensionContext) {
    // 实例化时，自动记录当前打开的项目
    this.recordCurrentProject();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  private getRecentProjects(): RecentProject[] {
    return this.context.globalState.get<RecentProject[]>(this.stateKey) || [];
  }

  private async recordCurrentProject() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return;

    const currentFolder = folders[0];
    let projects = this.getRecentProjects();

    projects = projects.filter(p => p.fsPath !== currentFolder.uri.fsPath);

    projects.unshift({
      name: currentFolder.name,
      fsPath: currentFolder.uri.fsPath,
      timestamp: Date.now()
    });

    if (projects.length > 50) {
      projects = projects.slice(0, 50);
    }

    await this.context.globalState.update(this.stateKey, projects);
    this.refresh();
  }

  getTreeItem(element: RecentProjectItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: RecentProjectItem): Thenable<RecentProjectItem[]> {
    if (element) return Promise.resolve([]); 
    
    const projects = this.getRecentProjects();
    if (projects.length === 0) {
      const empty = new vscode.TreeItem('暂无项目记录', vscode.TreeItemCollapsibleState.None);
      return Promise.resolve([empty as RecentProjectItem]);
    }

    const currentPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;

    const items = projects.map(p => new RecentProjectItem(p, p.fsPath === currentPath));
    return Promise.resolve(items);
  }

  private async insertProjectToHistory(name: string, pathOrUri: string) {
    let projects = this.getRecentProjects();
    projects = projects.filter(p => p.fsPath !== pathOrUri);
    projects.unshift({ name, fsPath: pathOrUri, timestamp: Date.now() });
    
    if (projects.length > 50) projects = projects.slice(0, 50);
    await this.context.globalState.update(this.stateKey, projects);
    this.refresh();
  }

  // ================= 🌟 手动添加项目逻辑 =================

  public async addLocalProject() {
    const uri = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: '添加到资源管理器'
    });

    if (uri && uri[0]) {
      const folderUri = uri[0];
      const folderName = folderUri.path.split(/[\\/]/).pop() || '本地项目';
      await this.insertProjectToHistory(folderName, folderUri.fsPath);
      vscode.window.showInformationMessage(`✅ 已添加本地项目: ${folderName}`);
    }
  }

  // 🌟 智能版：自动解析 Git 链接并支持 VFS 秒开远程仓库
  public async addRemoteProject() {
    const remoteUrl = await vscode.window.showInputBox({
      prompt: '请输入远程项目地址 (支持 GitHub 网址, vscode-remote:// 或 ssh://)',
      placeHolder: '例如: https://github.com/vuejs/core 或 vscode-remote://...'
    });

    if (!remoteUrl) return;

    let targetUri = remoteUrl.trim();
    let projectName = '';

    // 核心魔法：解析 GitHub 网址为虚拟文件系统(VFS)
    const githubMatch = targetUri.match(/github\.com\/([^/]+\/[^/.]+)/);
    
    if (githubMatch) {
      // 提取 "用户名/仓库名"，例如 "vuejs/core"
      const repoPath = githubMatch[1].replace(/\.git$/, ''); 
      projectName = repoPath.split('/').pop() || 'GitHub Repo';
      
      // 构建 VS Code 专属的虚拟文件系统 URI (前提是用户安装了 GitHub Repositories 插件)
      targetUri = `vscode-vfs://github/${repoPath}`;
      
    } else {
      // 如果不是普通的 GitHub 网址，按通用逻辑提取项目名
      projectName = targetUri
        .replace(/\/+$/, '')         
        .replace(/\.git$/, '')       
        .split(/[/\\]/)              
        .pop() || '';                

      if (projectName.includes(':')) {
        projectName = projectName.split(':').pop() || projectName;
      }
    }

    projectName = projectName || '未命名远程项目';

    // 允许用户确认或修改提取出来的名字
    const finalName = await vscode.window.showInputBox({
      prompt: '请确认项目名称',
      value: projectName
    });

    if (finalName) {
      await this.insertProjectToHistory(finalName, targetUri);
      vscode.window.showInformationMessage(`✅ 已添加远程项目: ${finalName}`);
    }
  }

  // ================= 🌟 交互操作逻辑 =================

  // 升级版打开逻辑：双击判断、窗口询问、切回资源管理器
  public async openProject(fsPath: string) {
    const now = Date.now();
    const timeDiff = now - this.lastClickTime;
    const isSamePath = this.lastClickedPath === fsPath;

    // 更新点击记录
    this.lastClickTime = now;
    this.lastClickedPath = fsPath;

    // 🌟 如果两次点击间隔大于 500ms，或者点的不是同一个项目，则视为【单击】（仅选中不打开）
    if (!isSamePath || timeDiff > 500) {
      return; 
    }

    // --- 仅【双击】时执行打开询问逻辑 ---
    try {
      const uri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);

      const choice = await vscode.window.showInformationMessage(
        '准备打开历史项目，请选择打开方式：',
        { modal: false }, 
        '在当前窗口打开',
        '在新窗口打开'
      );

      if (!choice) {
        return;
      }

      // 🌟 在打开项目前，将左侧边栏强制切换回 VS Code 自带的“资源管理器”
      await vscode.commands.executeCommand('workbench.view.explorer');

      const forceNewWindow = choice === '在新窗口打开';
      vscode.commands.executeCommand('vscode.openFolder', uri, forceNewWindow);

    } catch (e) {
      vscode.window.showErrorMessage('无法打开该项目，格式可能不受支持。如果您尝试打开的是 GitHub 仓库，请确保已安装官方的 "GitHub Repositories" 插件。');
    }
  }

  public async removeProject(item: RecentProjectItem) {
    let projects = this.getRecentProjects();
    projects = projects.filter(p => p.fsPath !== item.project.fsPath);
    await this.context.globalState.update(this.stateKey, projects);
    this.refresh();
  }

  public async clearAll() {
    await this.context.globalState.update(this.stateKey, []);
    this.refresh();
  }
}