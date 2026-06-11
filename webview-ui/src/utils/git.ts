import type { GitFile, TreeNode } from '../types/GitApp';

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

export type RemotePlatform = 'GitHub' | 'Gitee' | 'GitLab';

export interface RemoteInfo {
  platform: RemotePlatform;
  iconType: 'codicon' | 'image';
  icon: string;
  url: string;
}

export function parseRemoteInfo(url: string, hash: string) {
  if (!url) return null;

  let cleanUrl = url.replace(/\.git$/, "").trim();

  if (cleanUrl.startsWith("git@")) {
    cleanUrl = cleanUrl.replace(/^git@([^:]+):/, "https://$1/");
  }

  const lowerUrl = cleanUrl.toLowerCase();

  if (lowerUrl.includes("github.com")) {
    return {
      platform: "GitHub",
      iconType: "codicon",
      icon: "codicon-github",
      url: `${cleanUrl}/commit/${hash}`
    };
  }

  if (lowerUrl.includes("gitee.com")) {
    return {
      platform: "Gitee",
      iconType: "svg",
      icon: "gitee",
      url: `${cleanUrl}/commit/${hash}`
    };
  }

  return {
    platform: "GitLab",
    iconType: "svg",
    icon: "gitlab",
    url: `${cleanUrl}/-/commit/${hash}`
  };
}

export function getStatusText(status: string) {
  if (status.includes('M')) return 'M';
  if (status.includes('D')) return 'D';
  if (status.includes('A')) return 'A';
  if (status.includes('C')) return 'C';
  return 'U';
}

export function getStatusFullText(status: string) {
  if (status.includes('M')) return '已修改 (Modified)';
  if (status.includes('D')) return '已删除 (Deleted)';
  if (status.includes('A')) return '新增 (Added)';
  if (status.includes('C')) return '冲突 (Conflicted)';
  return '未跟踪 (Untracked)';
}

export function buildTree(files: GitFile[]): TreeNode[] {
  const root: TreeNode[] = [];

  files.forEach((f) => {
    const parts = f.file.split('/');
    let currentLevel = root;
    let currentPath = '';

    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      let existingNode = currentLevel.find((n) => n.name === part);

      if (!existingNode) {
        existingNode = {
          name: part,
          fullPath: currentPath,
          isDirectory: !isFile,
          children: [],
          file: isFile ? f : undefined,
        };
        currentLevel.push(existingNode);
      }

      currentLevel = existingNode.children;
    });
  });

  const compressTree = (nodes: TreeNode[]) => {
    nodes.forEach((node) => {
      if (node.isDirectory) {
        while (node.children.length === 1 && node.children[0].isDirectory) {
          const child = node.children[0];
          node.name = `${node.name}/${child.name}`;
          node.children = child.children;
        }

        compressTree(node.children);
      }
    });
  };

  const sortTree = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    nodes.forEach((n) => {
      if (n.isDirectory) sortTree(n.children);
    });
  };

  compressTree(root);
  sortTree(root);

  return root;
}