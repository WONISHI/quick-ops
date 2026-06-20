export const GIT_VIEW_IDS = {
  main: 'quickOps.gitView',
  detailPanel: 'quickOps.gitDetailPanel',
} as const;

export const GIT_COMMANDS = {
  openGitDetail: 'quickOps.openGitDetail',
  refreshGit: 'quickOps.refreshGit',
  cloneGitProject: 'quickOps.cloneGitProject',
  openProject: 'quickOps.openProject',
  editRemoteUrl: 'quickOps.editRemoteUrl',
  returnToWorkspace: 'quickOps.returnToWorkspace',
  commit: 'quickOps.git.commit',
  push: 'quickOps.git.push',
  pull: 'quickOps.git.pull',
  fetch: 'quickOps.git.fetch',
  checkoutBranch: 'quickOps.git.checkoutBranch',
  stageFile: 'quickOps.git.stageFile',
  unstageFile: 'quickOps.git.unstageFile',
  discardFile: 'quickOps.git.discardFile',
  openFile: 'quickOps.git.openFile',
  openDiff: 'quickOps.git.openDiff',
} as const;

export const GIT_STATE_KEYS = {
  recentProjects: 'quickOps.recentProjectsHistory',
  gitProjects: 'quickOps.gitProjectsHistory',
  lastClonePath: 'quickOps.lastClonePath',
} as const;

export const GIT_WEBVIEW_ROUTES = {
  main: '/git',
  detail: '/git-detail',
} as const;