export const RECENT_PROJECTS_VIEW_ID = 'quickOps.recentProjectsView';

export const RECENT_PROJECTS_COMMANDS = {
  addRecentProject: 'quickOps.addRecentProject',
  showOtherRecentProjects: 'quickOps.showOtherRecentProjects',
  createFileInFocusMode: 'quickOps.recentProjects.createFileInFocusMode',
  createFolderInFocusMode: 'quickOps.recentProjects.createFolderInFocusMode',
  refreshRecentProjects: 'quickOps.refreshRecentProjects',
  refreshCurrentWorkspaceRecentProject: 'quickOps.refreshCurrentWorkspaceRecentProject',
  clearRecentProjects: 'quickOps.clearRecentProjects',
  syncBranches: 'quickOps.syncBranches',
  revealInRecentProjects: 'quickOps.revealInRecentProjects',
  selectForCompare: 'quickOps.selectForCompare',
  compareWithSelected: 'quickOps.compareWithSelected',
  refreshGitProjects: 'quickOps.refreshGitProjects',
} as const;

export const RECENT_PROJECTS_CONTEXT_KEYS = {
  canRevealInRecent: 'quickOps.canRevealInRecent',
  focusMode: 'quickOps.recentProjects.focusMode',
} as const;

export const RECENT_PROJECTS_STORAGE_KEYS = {
  recentProjects: 'quickOps.recentProjects',
  legacyRecentProjects: 'quickOps.recentProjectsHistory',
  focusLock: 'quickOps.recentProjects.focusLock',
  gitProjectsHistory: 'quickOps.gitProjectsHistory',
  pendingOpenFile: 'quickOps.pendingOpenFile',
} as const;
