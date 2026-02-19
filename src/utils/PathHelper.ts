import * as vscode from 'vscode';
import * as path from 'path';
import * as url from 'url';

export class PathHelper {
  /**
   * 获取绝对路径 (建议改用 Uri.joinPath)
   * 这里的实现仅针对本地文件系统路径字符串
   */
  static getAbsolutePath(baseAbsolutePath: string, relativePath: string): string {
    return path.resolve(baseAbsolutePath, relativePath);
  }

  /**
   * 拼接路径，自动处理多余的 / (纯字符串操作，安全)
   */
  static joinPaths(...paths: string[]): string {
    return paths
      .filter(Boolean)
      .map((p, index) => {
        let segment = p;
        if (index > 0) segment = segment.replace(/^\/+/, '');
        segment = segment.replace(/\/+$/, '');
        return segment;
      })
      .join('/');
  }

  /**
   * 去除首尾引号
   */
  static removeSurroundingQuotes(str: string): string {
    return str.replace(/^['"]|['"]$/g, '');
  }

  static isValidAddress(input: string): boolean {
    try {
      const parsedUrl = new url.URL(input);
      if (parsedUrl.protocol && parsedUrl.protocol.match(/^https?:|file:|ftp:|ws:|wss:/)) {
        return true;
      }
    } catch (e) {
      return false;
    }
    if (path.isAbsolute(input)) {
      return true;
    }

    // 相对路径：检查是否包含路径分隔符（注意跨平台，所以用path.sep）
    if (input.includes(path.sep) || input.includes('/') || input.includes('\\')) {
      return true;
    }

    return false; // 或者根据需求调整
  }

  /**
   * 解析导入目录，返回文件和文件夹列表
   * 优化：使用 vscode.workspace.fs (支持远程)
   * * @param currentFilePathStr 当前文件的完整路径 (fsPath)
   * @param relativeImportPath 用户输入的相对导入路径 (如 "./comp")
   */
  static async resolveImportDir(currentFilePathStr: string, relativeImportPath: string): Promise<Array<{ name: string; isDirectory: () => boolean }>> {
    // 将路径转为 Uri，以便处理远程场景
    const currentFileUri = vscode.Uri.file(currentFilePathStr);
    const currentDirUri = vscode.Uri.joinPath(currentFileUri, '..');

    let cleanImportPath = this.removeSurroundingQuotes(relativeImportPath);
    let targetUri: vscode.Uri;

    // 1. 计算目标 Uri
    if (path.isAbsolute(cleanImportPath)) {
      // 如果是绝对路径，直接转换
      targetUri = vscode.Uri.file(cleanImportPath);
    } else {
      // 相对路径：使用 Uri.joinPath 拼接
      targetUri = vscode.Uri.joinPath(currentDirUri, cleanImportPath);
    }

    // 2. 智能判断：如果路径不以 / 结尾，尝试判断它是不是一个已存在的目录
    // 比如用户输入 "./utils"，如果 utils 是个目录，我们应当读取 utils 内部
    if (!['./', '../'].includes(cleanImportPath) && !cleanImportPath.endsWith('/')) {
      try {
        const stat = await vscode.workspace.fs.stat(targetUri);
        // 如果它确实是个目录，且用户没输 trailing slash，我们逻辑上把它当作目录处理
        // (不需要像旧代码那样修改 cleanImportPath 字符串，直接用 targetUri 读取即可)
      } catch {
        // 如果 stat 失败，说明可能是正在输入一半的文件名，或者路径不存在
        // 这时通常应该回退到读取父目录
        targetUri = vscode.Uri.joinPath(targetUri, '..');
      }
    }

    // 3. 读取目录内容
    try {
      const entries = await vscode.workspace.fs.readDirectory(targetUri);

      // 转换格式以匹配原有接口 (name, isDirectory)
      // readDirectory 返回 [name, FileType]
      const result = entries.map(([name, type]) => ({
        name,
        isDirectory: () => (type & vscode.FileType.Directory) !== 0,
        isFile: () => (type & vscode.FileType.File) !== 0,
      }));

      // 排序：目录在前，文件在后
      return result.sort((a, b) => {
        if (a.isDirectory() === b.isDirectory()) return a.name.localeCompare(b.name);
        return a.isDirectory() ? -1 : 1;
      });
    } catch (err) {
      // 目录不存在或读取失败，返回空数组
      return [];
    }
  }
}
