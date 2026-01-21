import * as path from 'path';
import Mocha = require('mocha'); // 1. 修复 Mocha 构造函数报错
import { glob } from 'glob'; // 2. 修复 glob 调用报错 (适配 v10+)

export async function run(): Promise<void> {
  // 创建 mocha 实例
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
  });

  const testsRoot = path.resolve(__dirname, '..');

  // 3. 使用新版 glob 的 Promise API，不再使用回调
  // 并且显式处理文件路径
  const files = await glob('**/**.test.js', { cwd: testsRoot });

  // 添加文件到 mocha
  files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

  // 运行测试
  return new Promise((resolve, reject) => {
    try {
      mocha.run((failures: number) => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      console.error(err);
      reject(err);
    }
  });
}
