import React from 'react';
import { vscode } from '../../utils/vscode';
import styles from './index.module.css';

const GitNotInstalled: React.FC = () => {
  return (
    <div className={styles.container}>
      <i className={`codicon codicon-git-merge ${styles.icon}`} />
      <div className={styles.title}>
        未检测到 Git 环境
      </div>
      <div className={styles.description}>
        当前系统未安装 Git，或环境变量未配置。
        <br />
        请安装 Git 后 <span className={styles.highlight}>重启 VS Code</span>。
      </div>
      <button
        className={styles['download-btn']}
        onClick={() => vscode.postMessage({ command: 'openExternal', url: 'https://git-scm.com/downloads' })}
      >
        <i className={`codicon codicon-cloud-download ${styles['btn-icon']}`} />
        前往官网下载 Git
      </button>
    </div>
  );
};

export default GitNotInstalled;