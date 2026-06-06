import { execFile } from 'child_process';

export type GitFileStatus = 'u' | 'a' | 'm' | 'd' | 'r' | 'c';

export class RecentProjectsGitStatusService {
  public execGit(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve) => {
      execFile('git', args, { cwd }, (error, stdout) => {
        if (error) {
          resolve('');
          return;
        }

        resolve(stdout || '');
      });
    });
  }

  public async getGitRoot(nativePath: string): Promise<string> {
    if (!nativePath) return '';

    const result = await this.execGit(['rev-parse', '--show-toplevel'], nativePath);
    return result.trim();
  }

  public normalizeGitStatus(rawStatus: string): GitFileStatus | undefined {
    const s = rawStatus.trim().toUpperCase();

    if (!s) return undefined;

    if (s === '??') return 'u';
    if (s.includes('D')) return 'd';
    if (s.includes('M')) return 'm';
    if (s.includes('A')) return 'a';
    if (s.includes('R')) return 'r';
    if (s.includes('C')) return 'c';

    return undefined;
  }

  public normalizeRelativePath(value: string) {
    return value.replace(/\\/g, '/').replace(/^\/+/, '');
  }

  public async getGitStatusMap(nativePath: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();

    try {
      const gitRoot = await this.getGitRoot(nativePath);
      if (!gitRoot) return map;

      /**
       * -uall 很关键：
       * 默认 git status 对未跟踪文件夹可能只返回：
       * ?? src/foo/
       *
       * 加上 -uall 后会返回：
       * ?? src/foo/a.ts
       * ?? src/foo/b.ts
       *
       * 这样才能做到和 VSCode 原生一样，新增文件夹下的文件也显示 U。
       */
      const output = await this.execGit(['status', '--porcelain=v1', '-z', '-uall'], gitRoot);
      if (!output) return map;

      const parts = output.split('\0').filter(Boolean);

      for (let i = 0; i < parts.length; i++) {
        const item = parts[i];
        const rawStatus = item.slice(0, 2);
        const rawPath = item.slice(3);

        if (!rawPath) continue;

        const status = this.normalizeGitStatus(rawStatus);
        if (!status) continue;

        const normalizedPath = this.normalizeRelativePath(rawPath);
        map.set(normalizedPath, status);

        if (rawStatus.toUpperCase().includes('R') && parts[i + 1]) {
          i++;
        }
      }
    } catch {
      return map;
    }

    return map;
  }

  public getGitStatusPriority(status?: string) {
    switch ((status || '').toLowerCase()) {
      case 'd':
        return 60;
      case 'm':
        return 50;
      case 'a':
        return 40;
      case 'u':
        return 30;
      case 'r':
        return 20;
      case 'c':
        return 10;
      default:
        return 0;
    }
  }

  public getChildGitStatus(
    childRelativePath: string,
    isFolder: boolean,
    statusMap: Map<string, string>
  ) {
    const normalizedChildPath = this.normalizeRelativePath(childRelativePath);
    const normalizedChildPathWithSlash = normalizedChildPath.endsWith('/')
      ? normalizedChildPath
      : `${normalizedChildPath}/`;

    if (!isFolder) {
      const exactStatus = statusMap.get(normalizedChildPath);

      if (exactStatus) {
        return exactStatus;
      }

      /**
       * 兼容 Git 只返回未跟踪目录的情况：
       * ?? src/foo/
       *
       * 当当前文件是 src/foo/a.ts 时，需要继承 src/foo/ 的 U 状态。
       */
      let finalStatus: string | undefined;
      let finalMatchedLength = 0;

      for (const [changedPath, status] of statusMap.entries()) {
        if (!changedPath.endsWith('/')) continue;

        if (normalizedChildPath.startsWith(changedPath) && changedPath.length > finalMatchedLength) {
          finalStatus = status;
          finalMatchedLength = changedPath.length;
        }
      }

      return finalStatus;
    }

    const exactFolderStatus = statusMap.get(normalizedChildPath) || statusMap.get(normalizedChildPathWithSlash);

    let finalStatus = exactFolderStatus;
    let finalPriority = this.getGitStatusPriority(exactFolderStatus);

    for (const [changedPath, status] of statusMap.entries()) {
      if (!changedPath.startsWith(normalizedChildPathWithSlash)) continue;

      const priority = this.getGitStatusPriority(status);

      if (priority > finalPriority) {
        finalStatus = status;
        finalPriority = priority;
      }
    }

    return finalStatus;
  }
}
