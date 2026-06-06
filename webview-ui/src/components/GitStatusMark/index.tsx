import React from 'react';
import styles from './index.module.css';

export type GitStatus = string | undefined;

export const getGitStatusText = (status?: string) => {
  if (!status) return '';

  const normalizedStatus = status.toLowerCase();

  if (normalizedStatus === 'u') return 'U';
  if (normalizedStatus === 'a') return 'A';
  if (normalizedStatus === 'm') return 'M';
  if (normalizedStatus === 'd') return 'D';
  if (normalizedStatus === 'r') return 'R';
  if (normalizedStatus === 'c') return 'C';

  return '';
};

export const getGitStatusClassName = (status?: string) => {
  if (!status) return '';

  const safeStatus = status.toLowerCase().replace(/[^a-z0-9_-]/g, '-');

  return styles[`file-status-${safeStatus}`] || '';
};

export const getGitStatusTitle = (name: string, status?: string) => {
  const text = getGitStatusText(status);

  return text ? `${name} [${text}]` : name;
};

interface GitStatusMarkProps {
  status?: string;
}

export const FolderGitStatusDot: React.FC<GitStatusMarkProps> = ({ status }) => {
  const text = getGitStatusText(status);

  if (!text) return null;

  return (
    <span
      className={`${styles['folder-status-dot']} ${getGitStatusClassName(status)}`}
      title={`状态: ${text}`}
    />
  );
};

export const FileGitStatusBadge: React.FC<GitStatusMarkProps> = ({ status }) => {
  const text = getGitStatusText(status);

  if (!text) return null;

  return (
    <span
      className={`${styles['file-status-badge']} ${getGitStatusClassName(status)}`}
      title={`状态: ${text}`}
    >
      {text}
    </span>
  );
};
