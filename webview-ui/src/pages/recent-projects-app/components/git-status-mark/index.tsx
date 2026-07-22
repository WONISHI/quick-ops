import React from 'react';

import styles from '@pages/recent-projects-app/components/git-status-mark/index.module.css';
import { getGitStatusClassName, getGitStatusText } from './src/uitls';

interface GitStatusMarkProps {
  status?: string;
}

/**
 * @description 文件夹 Git 状态圆点
 */
export const FolderGitStatusDot: React.FC<GitStatusMarkProps> = ({ status }) => {
  const text = getGitStatusText(status);

  if (!text) {
    return null;
  }

  return <span className={`${styles['folder-status-dot']} ${getGitStatusClassName(status)}`} title={`状态: ${text}`} />;
};

/**
 * @description 文件 Git 状态标记
 */
export const FileGitStatusBadge: React.FC<GitStatusMarkProps> = ({ status }) => {
  const text = getGitStatusText(status);

  if (!text) {
    return null;
  }

  return (
    <span className={`${styles['file-status-badge']} ${getGitStatusClassName(status)}`} title={`状态: ${text}`}>
      {text}
    </span>
  );
};
