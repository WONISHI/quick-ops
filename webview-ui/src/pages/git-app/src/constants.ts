import type { CommitType } from '@/pages/git-app/components/commit-type-tag/src/type';
import type { RemoteSyncState } from '@pages/git-app/src/type';

export const EMPTY_REMOTE_SYNC: RemoteSyncState = {
  hasRemote: false,
  hasUpstream: false,
  branch: '',
  upstream: '',
  ahead: 0,
  behind: 0,
  needsPull: false,
  needsPush: false,
  checkedAt: 0,
};

export const COMMIT_TYPE_ALIAS_MAP: Record<string, CommitType> = {
  feat: 'feat' as CommitType,
  feature: 'feat' as CommitType,
  fix: 'fix' as CommitType,
  bugfix: 'fix' as CommitType,
  docs: 'docs' as CommitType,
  doc: 'docs' as CommitType,
  style: 'style' as CommitType,
  refactor: 'refactor' as CommitType,
  perf: 'perf' as CommitType,
  performance: 'perf' as CommitType,
  test: 'test' as CommitType,
  tests: 'test' as CommitType,
  chore: 'chore' as CommitType,
  build: 'build' as CommitType,
  ci: 'ci' as CommitType,
  revert: 'revert' as CommitType,
};
