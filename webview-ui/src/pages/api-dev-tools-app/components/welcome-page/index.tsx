import React from 'react';
import styles from './index.module.css';

export default function WelcomePage() {
  return (
    <div className={styles['welcome']}>
      <div className={styles['welcome-icon']}>
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
          <rect width="64" height="64" rx="16" fill="var(--vscode-button-background)" opacity="0.12" />
          <path d="M20 22h16l8 10-8 10H20V22z" stroke="var(--vscode-button-background)" strokeWidth="2.5" fill="none" strokeLinejoin="round" />
          <path d="M36 32H20M28 26v12" stroke="var(--vscode-button-background)" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>
      <h2 className={styles['welcome-title']}>Q-ops Api</h2>
      <p className={styles['welcome-desc']}>API 调试工具已在悬浮窗口中打开</p>
    </div>
  );
}
