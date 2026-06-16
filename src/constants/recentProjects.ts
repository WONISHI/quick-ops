export const RECENT_PROJECTS_STATE_KEY = 'quickOps.recentProjectsHistory';
export const PENDING_OPEN_FILE_STATE_KEY = 'quickOps.pendingOpenFile';

export const GIT_VIRTUAL_SCHEME = 'quickops-git-virtual';
export const READONLY_SCHEME = 'quickops-ro';

export const LOCAL_DIR_CACHE_TTL = 3000;
export const FILE_INDEX_CACHE_TTL = 15000;

export const SYSTEM_IGNORE_FILES = new Set(['.DS_Store', 'Thumbs.db']);

export const IGNORE_DIRS = new Set([
  'node_modules',
  'bower_components',
  'vendor',
  '.git',
  '.svn',
  '.hg',
  'CVS',
  '.vscode',
  '.idea',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.cache',
  '.turbo',
]);

export const GIT_STATUS_KEYS = [
  'U',
  '?',
  'M',
  'A',
  'D',
  'R',
  'C',
  'I',
  '!',
  'X',
  'T',
];

export const GIT_STATUS_PRIORITY = [
  'UU',
  'AA',
  'DD',
  'UD',
  'DU',
  'U',
  '?',
  'A',
  'D',
  'R',
  'C',
  'M',
];
