export type CommitType = 'feat' | 'fix' | 'docs' | 'style' | 'refactor' | 'perf' | 'test' | 'chore' | 'revert' | 'build';

export interface CommitTypeOption {
  value: CommitType;
  label: string;
  description: string;
}

export interface CommitTypeTagProps {
  value: CommitType;
  disabled?: boolean;
  onChange: (value: CommitType) => void;
  onOpenChange?: (open: boolean) => void;
}