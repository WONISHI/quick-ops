import styles from '@pages/recent-projects-app/components/git-status-mark/index.module.css';

/**
 * @description 获取 Git 状态显示文本
 */
export function getGitStatusText(status?: string): string {
  if (!status) {
    return '';
  }

  const normalizedStatus = status.toLowerCase();

  if (normalizedStatus === 'u') {
    return 'U';
  }

  if (normalizedStatus === 'a') {
    return 'A';
  }

  if (normalizedStatus === 'm') {
    return 'M';
  }

  if (normalizedStatus === 'd') {
    return 'D';
  }

  if (normalizedStatus === 'r') {
    return 'R';
  }

  if (normalizedStatus === 'c') {
    return 'C';
  }

  return '';
}

/**
 * @description 获取 Git 状态样式类名
 */
export function getGitStatusClassName(status?: string): string {
  if (!status) {
    return '';
  }

  const safeStatus = status.toLowerCase().replace(/[^a-z0-9_-]/g, '-');

  return styles[`file-status-${safeStatus}`] || '';
}

/**
 * @description 获取包含 Git 状态的标题
 */
export function getGitStatusTitle(name: string, status?: string): string {
  const text = getGitStatusText(status);

  return text ? `${name} [${text}]` : name;
}
