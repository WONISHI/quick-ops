export type CommitType = 'feat' | 'fix' | 'docs' | 'style' | 'refactor' | 'perf' | 'test' | 'chore' | 'revert' | 'build';

export interface CommitTypeOption {
  value: CommitType;
  label: string;
  description: string;
}

