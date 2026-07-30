import type React from 'react';

export type FileGitStatus = 'u' | 'a' | 'm' | 'd' | 'r' | 'c' | string;

export interface FileIconProps {
  fileName: string;
  isFolder?: boolean;
  isExpanded?: boolean;
  className?: string;
  style?: React.CSSProperties;
  status?: FileGitStatus;
}

export type IconMatchRule = {
  pattern: RegExp;
  icon: string;
};