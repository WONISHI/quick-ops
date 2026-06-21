export const RECENT_PROJECTS_VIEW_ID = 'quickOps.recentProjectsView';

export const RECENT_PROJECTS_COMMANDS = {
  addRecentProject: 'quickOps.addRecentProject',
  refreshRecentProjects: 'quickOps.refreshRecentProjects',
  clearRecentProjects: 'quickOps.clearRecentProjects',
  syncBranches: 'quickOps.syncBranches',
  revealInRecentProjects: 'quickOps.revealInRecentProjects',
  selectForCompare: 'quickOps.selectForCompare',
  compareWithSelected: 'quickOps.compareWithSelected',
  refreshGitProjects: 'quickOps.refreshGitProjects',
} as const;

export const RECENT_PROJECTS_STORAGE_KEYS = {
  recentProjects: 'quickOps.recentProjects',
  gitProjectsHistory: 'quickOps.gitProjectsHistory',
  pendingOpenFile: 'quickOps.pendingOpenFile',
} as const;

export const RECENT_PROJECTS_WEBVIEW_MESSAGES = {
  ready: 'ready',
  webviewLoaded: 'webviewLoaded',

  updateProjects: 'updateProjects',
  recentProjects: 'recentProjects',

  refreshExpandedDirs: 'refreshExpandedDirs',
  readDirResult: 'readDirResult',
  dirData: 'dirData',
  updateDirChildren: 'updateDirChildren',

  searchFileNameResult: 'searchFileNameResult',
  searchFolderResult: 'searchFolderResult',

  activePathChanged: 'activePathChanged',
  revealActivePath: 'revealActivePath',

  metadataSyncRequested: 'metadataSyncRequested',
  refreshVisibleMetadata: 'refreshVisibleMetadata',

  error: 'error',
} as const;