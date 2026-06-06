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

const CommitHoverWidget: React.FC<CommitHoverWidgetProps> = ({
  commit,
  y,
  position,
  branch,
  remoteUrl,
  onMouseEnter,
  onMouseLeave,
}) => {
  const remoteInfo = remoteUrl ? parseRemoteInfo(remoteUrl, commit.hash) : null;

  const getRefTagClassName = (name: string, isHead: boolean) => {
    const isRemote = name.startsWith('origin/');

    return [
      styles['ref-tag'],
      isRemote ? styles['ref-remote'] : '',
      !isRemote ? styles['ref-local'] : '',
      isHead ? styles['ref-head'] : '',
    ]
      .filter(Boolean)
      .join(' ');
  };

  return (
    <div
      className={`${styles['commit-hover-widget']} ${
        position === 'top' ? styles['hover-top'] : styles['hover-bottom']
      }`}
      style={{
        left: '50%',
        transform: 'translateX(-50%)',
        ...(position === 'top' ? { bottom: window.innerHeight - y } : { top: y }),
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className={styles['commit-hover-content']}>
        <div className={styles['hover-header']}>
          <div className={styles['hover-avatar']}>
            {commit.author ? commit.author[0].toUpperCase() : 'U'}
          </div>

          <div className={styles['hover-detail']}>
            <span className={styles['hover-author']}>{commit.author}</span>

            {commit.timestamp && (
              <span
                className={styles['hover-time']}
                title={`${formatRelativeTime(commit.timestamp)} (${formatAbsoluteTime(commit.timestamp)})`}
              >
                <i
                  className="codicon codicon-clock"
                  style={{
                    marginRight: '4px',
                    fontSize: '13px',
                    flexShrink: 0,
                  }}
                />
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
                <span
                  key={i}
                  className={getRefTagClassName(name, isHead)}
                  title={name}
                >
                  {name}
                </span>
              );
            })
          ) : branch ? (
            <span
              className={`${styles['ref-tag']} ${styles['ref-local']} ${styles['ref-head']}`}
              title={branch}
            >
              {branch}
            </span>
          ) : null}
        </div>

        <div className={styles['hover-message']}>{commit.message}</div>

        <div className={styles['hover-divider']}></div>

        <div className={styles['hover-footer']}>
          <span
            className={styles['hover-action-btn']}
            title="复制 Hash"
            onClick={() => vscode.postMessage({ command: 'copy', text: commit.hash })}
          >
            <i className="codicon codicon-copy" style={{ marginRight: '4px' }} />
            {commit.hash.substring(0, 7)}
          </span>

          {remoteInfo && (
            <>
              <span className={styles['hover-separator']}>|</span>

              <span
                className={`${styles['hover-action-btn']} ${styles['hover-open-remote']}`}
                title="查看提交记录"
                onClick={() => {
                  vscode.postMessage({
                    command: 'openExternal',
                    url: remoteInfo.url,
                  });
                }}
              >
                <i
                  className={`codicon ${remoteInfo.icon}`}
                  style={{
                    marginRight: '4px',
                    verticalAlign: 'middle',
                  }}
                />
                在 {remoteInfo.platform} 上打开
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CommitHoverWidget;