// 平行读取该文件夹下素有json
import * as fs from 'fs/promises';
import * as path from 'path';
<<<<<<< HEAD:src/module/mixin-config.ts
import * as vscode from "vscode"
=======
import * as vscode from "vscode";
>>>>>>> 34177ba5e92c4b57e5c1ac3ecccd17a49959f546:src/module/mixin/mixin-config.ts

/**
 * 读取指定文件夹下的所有 JSON 文件
 * @param dir 文件夹路径
 * @returns 返回数组，每个元素包含文件名和解析后的 JSON 对象
 */
export async function readAllJson(dir: string): Promise<Record<string, any>[]> {
  // 读取目录
  const files = await fs.readdir(dir);
  // 过滤 JSON 文件
  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  // 并行读取和解析
  const results = await Promise.all(
    jsonFiles.map(async (file) => {
      const filePath = path.join(dir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      try {
        const data = JSON.parse(content);
        return data;
      } catch (err) {
        console.error(`解析 JSON 文件失败: ${file}`, err);
        return { file, data: null };
      }
    }),
  );

  return results;
}

// 使用示例
export async function MixinReadSnippets(): Promise<Record<string, any>[]> {
<<<<<<< HEAD:src/module/mixin-config.ts
  const folderPath = path.resolve(__dirname, '../', '../', 'resources', 'snippets'); // 当前文件夹
=======
  const folderPath = path.resolve(__dirname,'..','..', 'resources', 'snippets'); // 当前文件夹
>>>>>>> 34177ba5e92c4b57e5c1ac3ecccd17a49959f546:src/module/mixin/mixin-config.ts
  const jsonList = await readAllJson(folderPath);
  return jsonList.flat(Infinity);
}

export async function MixinReadShells(): Promise<Record<string, any>[]> {
  const folderPath = path.resolve(__dirname, 'resources', 'shell'); // 当前文件夹
  const jsonList = await readAllJson(folderPath);
  return jsonList.flat(Infinity);
}

<<<<<<< HEAD:src/module/mixin-config.ts
/**
 * 从指定路径开始向上递归查找包含 package.json 的目录
 * @param startPath 起始路径（如当前文件路径、工作区文件夹路径）
 * @returns package.json 所在目录（未找到返回 undefined）
 */
=======
>>>>>>> 34177ba5e92c4b57e5c1ac3ecccd17a49959f546:src/module/mixin/mixin-config.ts
export async function findPackageJsonFolder(): Promise<string | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;
  const rootPath = folder.uri.fsPath;
  const rootPkg = path.join(rootPath, 'package.json');
<<<<<<< HEAD:src/module/mixin-config.ts
  // 1. 先检查根目录
=======
>>>>>>> 34177ba5e92c4b57e5c1ac3ecccd17a49959f546:src/module/mixin/mixin-config.ts
  try {
    await fs.access(rootPkg);
    return rootPath;
  } catch {}
  try {
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const pkgPath = path.join(rootPath, entry.name, 'package.json');
        try {
          await fs.access(pkgPath);
          return path.join(rootPath, entry.name);
        } catch {}
      }
    }
  } catch (err) {
    console.error(err);
  }
  return undefined;
<<<<<<< HEAD:src/module/mixin-config.ts
}
=======
}
>>>>>>> 34177ba5e92c4b57e5c1ac3ecccd17a49959f546:src/module/mixin/mixin-config.ts
