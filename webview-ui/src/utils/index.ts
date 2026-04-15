export function formatRelativeTime(ms: number) {
  const diff = Date.now() - ms;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days > 0) return `${days} 天前`;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours > 0) return `${hours} 小时前`;
  const mins = Math.floor(diff / (1000 * 60));
  if (mins > 0) return `${mins} 分钟前`;
  return '刚刚';
}

export function formatAbsoluteTime(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function parseRemoteInfo(url: string, hash: string) {
  if (!url) return null;
  let cleanUrl = url.replace(/\.git$/, '').trim();
  if (cleanUrl.startsWith('git@')) {
    cleanUrl = cleanUrl.replace(/^git@([^:]+):/, 'https://$1/');
  }
  let platform = 'GitLab';
  let icon = 'codicon-repo';
  if (cleanUrl.includes('github.com')) {
    platform = 'GitHub';
    icon = 'codicon-github';
  } else if (cleanUrl.includes('gitee.com')) {
    platform = 'Gitee';
  }
  return { platform, icon, url: `${cleanUrl}/commit/${hash}` };
}
