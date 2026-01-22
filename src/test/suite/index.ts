import * as path from 'path';
import Mocha = require('mocha'); // 1. 修复 Mocha 构造函数报错
import { glob } from 'glob'; // 2. 修复 glob 调用报错 (适配 v10+)

export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
  });

  const testsRoot = path.resolve(__dirname, '..');

  const files = await glob('**/**.test.js', { cwd: testsRoot });

  files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

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
