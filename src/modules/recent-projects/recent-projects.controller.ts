import * as vscode from 'vscode';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { RecentProjectsProvider } from '@modules/recent-projects/providers/recent-projects.provider';
import { ReadOnlyFileSystemProvider } from '@modules/recent-projects/providers/read-only-file-system.provider';
import { GitVirtualContentProvider } from '@modules/git/providers/git-virtual-content.provider';
import { RECENT_PROJECTS_COMMANDS, RECENT_PROJECTS_CONTEXT_KEYS, RECENT_PROJECTS_VIEW_ID } from '@/modules/recent-projects/constants/recent-projects.constant';
import type { OnModuleInit } from '@core/lifecycle/lifecycle.interface';

export class RecentProjectsController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, RecentProjectsProvider, ReadOnlyFileSystemProvider, GitVirtualContentProvider];

  private readonly id = 'RecentProjectsModule';

  private refreshTimer: NodeJS.Timeout | undefined;
  private activeEditorRevealTimer: NodeJS.Timeout | undefined;
  private lastRevealedActiveEditorUri = '';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly recentProjectsProvider: RecentProjectsProvider,
    private readonly readOnlyFileSystemProvider: ReadOnlyFileSystemProvider,
    private readonly gitVirtualContentProvider: GitVirtualContentProvider,
  ) {}

  public onModuleInit(): void {
    this.registerProviders();
    this.registerCommands();
    this.registerListeners();
    this.registerGitStateWatcher();
    this.updateRevealContext();
    void vscode.commands.executeCommand('setContext', RECENT_PROJECTS_CONTEXT_KEYS.focusMode, false);
  }

  public dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    if (this.activeEditorRevealTimer) {
      clearTimeout(this.activeEditorRevealTimer);
      this.activeEditorRevealTimer = undefined;
    }

    this.recentProjectsProvider.dispose();
    this.readOnlyFileSystemProvider.dispose();
    this.gitVirtualContentProvider.dispose();

    void vscode.commands.executeCommand('setContext', RECENT_PROJECTS_CONTEXT_KEYS.canRevealInRecent, false);
    void vscode.commands.executeCommand('setContext', RECENT_PROJECTS_CONTEXT_KEYS.focusMode, false);
  }

  private registerProviders(): void {
    this.extensionContextProvider.register(
      vscode.window.registerWebviewViewProvider(RECENT_PROJECTS_VIEW_ID, this.recentProjectsProvider, {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }),

      vscode.workspace.registerFileSystemProvider('quickops-ro', this.readOnlyFileSystemProvider, {
        isReadonly: true,
      }),

      vscode.workspace.registerTextDocumentContentProvider('quickops-git-virtual', this.gitVirtualContentProvider),
    );
  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand(RECENT_PROJECTS_COMMANDS.addRecentProject, async () => {
        await this.recentProjectsProvider.showAddProjectQuickPick();
        this.recentProjectsProvider.requestVisibleMetadataSync();
      }),

      vscode.commands.registerCommand(RECENT_PROJECTS_COMMANDS.showOtherRecentProjects, () => {
        this.recentProjectsProvider.showOtherProjectsQuickPick();
      }),

      vscode.commands.registerCommand(RECENT_PROJECTS_COMMANDS.createFileInFocusMode, () => {
        this.recentProjectsProvider.beginCreateFileInFocusMode();
      }),

      vscode.commands.registerCommand(RECENT_PROJECTS_COMMANDS.createFolderInFocusMode, () => {
        this.recentProjectsProvider.beginCreateFolderInFocusMode();
      }),

      vscode.commands.registerCommand(RECENT_PROJECTS_COMMANDS.refreshRecentProjects, async () => {
        this.recentProjectsProvider.invalidateDirCache();
        this.recentProjectsProvider.refresh(true);
        this.readOnlyFileSystemProvider.refreshAllWatched();
        await this.recentProjectsProvider.syncAllBranches();
        this.recentProjectsProvider.requestVisibleMetadataSync();
      }),

      vscode.commands.registerCommand(RECENT_PROJECTS_COMMANDS.refreshCurrentWorkspaceRecentProject, async (targetPath?: string, options?: { collapseTree?: boolean }) => {
        const projectUri = this.resolveProjectUriString(targetPath);

        if (!projectUri) return;

        this.recentProjectsProvider.invalidateDirCache(projectUri);
        this.readOnlyFileSystemProvider.refreshAllWatched();
        await this.recentProjectsProvider.updateSingleBranch(projectUri, true);

        if (options?.collapseTree === false) {
          this.recentProjectsProvider.refresh(true);
        } else {
          this.recentProjectsProvider.refresh(false);
          this.recentProjectsProvider.collapseAllFolders(true);
        }

        this.recentProjectsProvider.requestVisibleMetadataSync();

        if (this.recentProjectsProvider.currentActivePath) {
          this.recentProjectsProvider.setActivePath(this.recentProjectsProvider.currentActivePath);
        }
      }),

      vscode.commands.registerCommand(RECENT_PROJECTS_COMMANDS.clearRecentProjects, async () => {
        await this.recentProjectsProvider.clearAll();
      }),

      vscode.commands.registerCommand(RECENT_PROJECTS_COMMANDS.syncBranches, async () => {
        await this.recentProjectsProvider.syncAllBranches();
        this.recentProjectsProvider.requestVisibleMetadataSync();
      }),

      vscode.commands.registerCommand(RECENT_PROJECTS_COMMANDS.revealInRecentProjects, () => {
        this.updateRevealContext();
        this.recentProjectsProvider.revealCurrentActive();
      }),

      vscode.commands.registerCommand(RECENT_PROJECTS_COMMANDS.selectForCompare, (uri?: vscode.Uri) => {
        if (!uri) return;

        this.recentProjectsProvider.selectForCompare(uri.toString());
      }),

      vscode.commands.registerCommand(RECENT_PROJECTS_COMMANDS.compareWithSelected, async (uri?: vscode.Uri) => {
        if (!uri) return;

        await this.recentProjectsProvider.compareWithSelected(uri.toString());
      }),
    );
  }

  private registerListeners(): void {
    this.extensionContextProvider.register(
      this.readOnlyFileSystemProvider.onDidRefreshReadonlyTarget((event) => {
        this.recentProjectsProvider.requestPathMetadataSync(event.targetUri, 120);
      }),

      vscode.workspace.onDidChangeTextDocument((event) => {
        const realUri = this.getRealDocumentUri(event.document.uri);

        if (!realUri) return;

        this.recentProjectsProvider.notifySearchContentChanged(realUri, 280);

        if (event.document.isDirty) {
          this.recentProjectsProvider.requestDirtyDocumentMetadataSync(event.document, 90);
          return;
        }

        this.recentProjectsProvider.requestPathMetadataSync(realUri, 120);
      }),

      vscode.workspace.onDidSaveTextDocument((document) => {
        const realUri = this.getRealDocumentUri(document.uri);

        if (!realUri) return;

        this.readOnlyFileSystemProvider.refreshByTargetUri(realUri);
        this.recentProjectsProvider.requestSavedDocumentMetadataSync(document, 80);
      }),

      vscode.workspace.onDidCreateFiles(() => {
        this.requestStructuralRefresh(true);
      }),

      vscode.workspace.onDidDeleteFiles(() => {
        this.requestStructuralRefresh(true);
      }),

      vscode.workspace.onDidRenameFiles(() => {
        this.requestStructuralRefresh(true);
      }),

      vscode.languages.onDidChangeDiagnostics((event) => {
        const changedUris = event.uris.filter((uri) => uri.scheme === 'file');

        if (changedUris.length === 0) return;

        const activeUri = this.getActiveFileUri();

        if (activeUri && changedUris.some((uri) => this.isSameUri(uri, activeUri))) {
          this.recentProjectsProvider.requestPathMetadataSync(activeUri, 180);
          return;
        }

        this.recentProjectsProvider.requestPathMetadataSync(changedUris, 180);
      }),

      vscode.window.onDidChangeWindowState((event) => {
        if (!event.focused) return;

        const activeUri = this.getActiveFileUri();

        if (activeUri) {
          this.recentProjectsProvider.requestPathMetadataSync(activeUri, 320);
        }
      }),

      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.updateRevealContext();

        if (!editor) return;

        const realUri = this.getRealDocumentUri(editor.document.uri);

        if (!realUri) return;

        const uriStr = realUri.toString();

        if (uriStr === this.lastRevealedActiveEditorUri) return;

        this.lastRevealedActiveEditorUri = uriStr;

        if (this.activeEditorRevealTimer) {
          clearTimeout(this.activeEditorRevealTimer);
        }

        this.activeEditorRevealTimer = setTimeout(() => {
          this.activeEditorRevealTimer = undefined;

          this.recentProjectsProvider.setActivePath(uriStr);
          this.recentProjectsProvider.requestPathMetadataSync(realUri, 0);
          this.recentProjectsProvider.revealCurrentActive();
        }, 120);
      }),

      vscode.workspace.onDidOpenTextDocument(() => {
        this.updateRevealContext();
      }),

      vscode.workspace.onDidCloseTextDocument(() => {
        this.updateRevealContext();
      }),
    );
  }

  private registerGitStateWatcher(): void {
    const repositoryDisposables = new Map<any, vscode.Disposable>();
    const disposables: vscode.Disposable[] = [];
    let gitStateRefreshTimer: NodeJS.Timeout | undefined;

    const requestGitStateMetadataSync = (delay = 260) => {
      if (gitStateRefreshTimer) {
        clearTimeout(gitStateRefreshTimer);
      }

      gitStateRefreshTimer = setTimeout(() => {
        gitStateRefreshTimer = undefined;
        this.recentProjectsProvider.requestVisibleMetadataSync();

        const activeUri = this.getActiveFileUri();

        if (activeUri) {
          this.recentProjectsProvider.requestPathMetadataSync(activeUri, 0);
        }
      }, delay);
    };

    const watchRepository = (repository: any) => {
      if (!repository || repositoryDisposables.has(repository)) return;

      const disposable = repository.state.onDidChange(() => {
        requestGitStateMetadataSync(260);
      });

      repositoryDisposables.set(repository, disposable);
      disposables.push(disposable);
    };

    const setup = async () => {
      try {
        const extension = vscode.extensions.getExtension('vscode.git');

        if (!extension) return;

        const exports = extension.isActive ? extension.exports : await extension.activate();
        const api = exports?.getAPI?.(1);

        if (!api) return;

        api.repositories.forEach((repository: any) => {
          watchRepository(repository);
        });

        disposables.push(
          api.onDidOpenRepository((repository: any) => {
            watchRepository(repository);
            requestGitStateMetadataSync(120);
          }),
          api.onDidCloseRepository((repository: any) => {
            const disposable = repositoryDisposables.get(repository);

            if (disposable) {
              disposable.dispose();
              repositoryDisposables.delete(repository);
            }

            requestGitStateMetadataSync(120);
          }),
        );
      } catch (error) {
        console.warn('[RecentProjectsController] Git state watcher init failed:', error);
      }
    };

    void setup();

    this.extensionContextProvider.register(
      new vscode.Disposable(() => {
        if (gitStateRefreshTimer) {
          clearTimeout(gitStateRefreshTimer);
          gitStateRefreshTimer = undefined;
        }

        repositoryDisposables.forEach((disposable) => {
          disposable.dispose();
        });
        repositoryDisposables.clear();

        disposables.forEach((disposable) => {
          disposable.dispose();
        });
        disposables.length = 0;
      }),
    );
  }

  private updateRevealContext(): void {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const realUri = activeUri ? this.getRealDocumentUri(activeUri) : undefined;

    this.recentProjectsProvider.updateRevealContext(realUri?.toString() || '');
  }

  private requestStructuralRefresh(refreshExpandedTree = true): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;

      this.recentProjectsProvider.invalidateDirCache();
      this.recentProjectsProvider.refresh(refreshExpandedTree);
      this.readOnlyFileSystemProvider.refreshAllWatched();

      if (this.recentProjectsProvider.currentActivePath) {
        this.recentProjectsProvider.setActivePath(this.recentProjectsProvider.currentActivePath);
      }

      this.recentProjectsProvider.requestVisibleMetadataSync();
    }, 260);
  }

  private getRealDocumentUri(uri: vscode.Uri): vscode.Uri | undefined {
    if (uri.scheme === 'file') return uri;

    if (uri.scheme !== 'quickops-ro') return undefined;

    const target = new URLSearchParams(uri.query).get('target');

    if (!target) return undefined;

    try {
      const targetUri = vscode.Uri.parse(target);

      return targetUri.scheme === 'file' ? targetUri : undefined;
    } catch {
      return undefined;
    }
  }

  private getActiveFileUri(): vscode.Uri | undefined {
    const uri = vscode.window.activeTextEditor?.document.uri;

    return uri ? this.getRealDocumentUri(uri) : undefined;
  }

  private isSameUri(a: vscode.Uri, b: vscode.Uri): boolean {
    return a.toString() === b.toString() || a.fsPath === b.fsPath;
  }

  private resolveProjectUriString(value?: string): string {
    const rawValue = String(value || '').trim();

    if (!rawValue) {
      return vscode.workspace.workspaceFolders?.[0]?.uri.toString() || '';
    }

    if (rawValue.includes('://')) {
      try {
        return vscode.Uri.parse(rawValue).toString();
      } catch {
        return rawValue;
      }
    }

    return vscode.Uri.file(rawValue).toString();
  }
}
