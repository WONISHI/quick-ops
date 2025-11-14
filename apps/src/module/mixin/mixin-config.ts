// 平行读取该文件夹下素有json
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { properties } from '../../global-object/properties';

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
        return {
          data,
          name: file.lastIndexOf('.') > 0 ? file.slice(0, file.lastIndexOf('.')) : file,
        };
      } catch (err) {
        console.error(`解析 JSON 文件失败: ${file}`, err);
        return { file, data: null };
      }
    }),
  );

  return results;
}

// 使用示例
export async function MixinResolveFile(context: vscode.ExtensionContext): Promise<any> {
  const configSnippets: any[] = [];
  for (let i = 0; i < properties.configDir.length; i++) {
    const type = properties.configDir[i];
    const folderPath = path.join(context.extensionPath, 'resources', type); // 当前文件夹
    const jsonList = await readAllJson(folderPath);
    configSnippets.push(...jsonList);
  }
  return configSnippets;
}

// 查找根目录
export async function findPackageJsonFolder(): Promise<string | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;
  const rootPath = folder.uri.fsPath;
  const rootPkg = path.join(rootPath, 'package.json');
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
}
