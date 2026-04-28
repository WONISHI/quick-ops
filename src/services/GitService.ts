import simpleGit, { SimpleGit } from 'simple-git';
import { execFile } from 'child_process';
import { IService } from '../core/interfaces/IService';

export class GitService implements IService {
  public readonly serviceId = 'GitService';
  private git!: SimpleGit;

  public async init(): Promise<void> {
    this.git = simpleGit();
  }

  /**
   * @description 检查系统是否已安装并配置好 Git 环境
   */
  public checkGitInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      execFile('git', ['--version'], (error) => {
        resolve(!error);
      });
    });
  }

  /**
   * @description 获取 Git 全局配置中的用户名和邮箱
   */
  public async getGlobalGitUser(): Promise<{ name: string; email: string }> {
    let name = '';
    let email = '';

    try {
      name = (await this.git.raw(['config', '--global', 'user.name'])).trim();
    } catch {}

    try {
      email = (await this.git.raw(['config', '--global', 'user.email'])).trim();
    } catch {}

    return { name, email };
  }

  /**
   * @description 设置 Git 全局用户名和邮箱
   * 如果传入空字符串，则会清除对应的全局配置
   * @param name Git 用户名
   * @param email Git 邮箱
   */
  public async setGlobalGitUser(name: string, email: string): Promise<void> {
    // 处理 user.name
    if (!name) {
      // 如果为空，则取消设置该配置（忽略可能因为原本就不存在而抛出的错误）
      await this.git.raw(['config', '--global', '--unset', 'user.name']).catch(() => {});
    } else {
      await this.git.raw(['config', '--global', 'user.name', name]);
    }

    // 处理 user.email
    if (!email) {
      // 如果为空，则取消设置该配置
      await this.git.raw(['config', '--global', '--unset', 'user.email']).catch(() => {});
    } else {
      await this.git.raw(['config', '--global', 'user.email', email]);
    }
  }
}
