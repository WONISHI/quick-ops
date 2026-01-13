import * as path from 'path';
import * as fs from 'fs';

export class PathHelper {
  /**
   * 获取绝对路径
   */
  static getAbsolutePath(baseAbsolutePath: string, relativePath: string): string {
    return path.resolve(baseAbsolutePath, relativePath);
  }

  /**
   * 拼接路径，自动处理多余的 /
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

  /**
   * 解析导入目录，返回文件和文件夹列表
   */
  static async resolveImportDir(currentFilePath: string, relativeImportPath: string): Promise<any[]> {
    const currentDir = path.dirname(currentFilePath);
    let cleanImportPath = this.removeSurroundingQuotes(relativeImportPath);

    if (!['./', '../'].includes(cleanImportPath) && !/\/$/.test(cleanImportPath)) {
      const statPath = this.getAbsolutePath(currentDir, cleanImportPath);
      if (fs.existsSync(statPath) && fs.statSync(statPath).isDirectory()) {
        cleanImportPath += '/';
      }
    }

    const targetPath = path.isAbsolute(cleanImportPath) ? cleanImportPath : this.getAbsolutePath(currentDir, cleanImportPath);

    return new Promise<any[]>((resolve, reject) => {
      fs.readdir(targetPath, { withFileTypes: true }, (err, entries) => {
        if (err) {
          // console.log('Directory read error', err);
          resolve([]); // 失败返回空，不崩溃
        } else {
          const files = entries.filter((e) => e.isFile());
          const dirs = entries.filter((e) => e.isDirectory());
          resolve([...files, ...dirs]);
        }
      });
    });
  }
}
