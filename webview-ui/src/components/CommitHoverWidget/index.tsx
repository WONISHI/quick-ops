import React from 'react';
import { vscode } from '../../utils/vscode';
import styles from './index.module.css';
import { type GraphCommit } from '../GitGraph';
import { formatRelativeTime, formatAbsoluteTime, parseRemoteInfo } from '../../utils/index';

interface CommitHoverWidgetProps {
  commit: GraphCommit;
  x: number;
  y: number;
  position: 'top' | 'bottom';
  branch?: string;
  remoteUrl?: string;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

const CommitHoverWidget: React.FC<CommitHoverWidgetProps> = ({ commit, y, position, branch, remoteUrl, onMouseEnter, onMouseLeave }) => {
  return (
    <div
      className={styles['commit-hover-widget']}
      style={{
        left: '50%',
        transform: 'translateX(-50%)',
        ...(position === 'top' ? { bottom: window.innerHeight - y } : { top: y }),
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className={styles['hover-header']}>
        <div className={styles['hover-avatar']}>{commit.author ? commit.author[0].toUpperCase() : 'U'}</div>
        <div className={styles['hover-detail']}>
          <span className={styles['hover-author']}>{commit.author}</span>
          {commit.timestamp && (
            <span
              className={styles['hover-time']}
              title={`${formatRelativeTime(commit.timestamp)} (${formatAbsoluteTime(commit.timestamp)})`}
            >
              <i className="codicon codicon-clock" style={{ marginRight: '4px', fontSize: '13px', flexShrink: 0 }} />
              <span className={styles['hover-time-text']}>
                {formatRelativeTime(commit.timestamp)} ({formatAbsoluteTime(commit.timestamp)})
              </span>
            </span>
          )}
        </div>
      </div>

      <div className={styles['hover-refs']}>
        {commit.refs ? (
          commit.refs.split(',').map((r: string, i: number) => {
            const trimmed = r.trim();
            if (!trimmed) return null;
            const isHead = trimmed.startsWith('HEAD -> ');
            const name = isHead ? trimmed.replace('HEAD -> ', '') : trimmed;
            return (
              <span key={i} className={`${styles['ref-tag']} ${isHead ? styles['ref-head'] : ''}`}>
                {name}
              </span>
            );
          })
        ) : branch ? (
          <span className={`${styles['ref-tag']} ${styles['ref-head']}`}>{branch}</span>
        ) : null}
      </div>

      <div className={styles['hover-message']}>{commit.message}</div>
      <div className={styles['hover-divider']}></div>

      <div
        className={styles['hover-footer']}
        style={{
          display: 'flex',
          alignItems: 'center',
          overflow: 'hidden',
          width: '100%' // 🌟 确保父容器有明确的宽度边界
        }}
      >
        <span
          className={styles['hover-action-btn']}
          title="复制 Hash"
          style={{
            flexShrink: 0,
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center'
          }}
          onClick={() => vscode.postMessage({ command: 'copy', text: commit.hash })}
        >
          <i className="codicon codicon-copy" style={{ marginRight: '4px' }} /> {commit.hash.substring(0, 7)}
        </span>

        {remoteUrl && parseRemoteInfo(remoteUrl, commit.hash) && (
          <>
            <span className={styles['hover-separator']} style={{ flexShrink: 0, margin: '0 6px' }}>|</span>
            <span
              className={styles['hover-action-btn']}
              title="查看记录"
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'block'
              }}
              onClick={() => vscode.postMessage({ command: 'openExternal', url: parseRemoteInfo(remoteUrl, commit.hash)!.url })}
            >
              <i className={`codicon ${parseRemoteInfo(remoteUrl, commit.hash)!.icon}`} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
              在 {parseRemoteInfo(remoteUrl, commit.hash)!.platform} 上打开
            </span>
          </>
        )}
      </div>
    </div>
  );
};

export default CommitHoverWidget;
