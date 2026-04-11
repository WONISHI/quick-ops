import React from 'react';
import { vscode } from '../../utils/vscode';
import styles from './index.module.css';
import Tooltip from '../Tooltip';
import { type GraphCommit } from '../GitGraph';

export function formatRelativeTime(ms: number) {
    const diff = Date.now() - ms;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days > 0) return `${days} 天前`;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours > 0) return `${hours} 小时前`;
    const mins = Math.floor(diff / (1000 * 60));
    if (mins > 0) return `${mins} 分钟前`;
    return '刚刚';
}

export function formatAbsoluteTime(ms: number) {
    const d = new Date(ms);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

interface CommitHoverWidgetProps {
    commit: GraphCommit;
    x: number;
    y: number;
    position: 'top' | 'bottom';
    branch?: string;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
}

const CommitHoverWidget: React.FC<CommitHoverWidgetProps> = ({
    commit,
    x,
    y,
    position,
    branch,
    onMouseEnter,
    onMouseLeave
}) => {
    return (
        <div
            className={styles['commit-hover-widget']}
            style={{
                left: x,
                ...(position === 'top' ? { bottom: window.innerHeight - y } : { top: y })
            }}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <div className={styles['hover-header']}>
                <div className={styles['hover-avatar']}>{commit.author ? commit.author[0].toUpperCase() : 'U'}</div>
                <span className={styles['hover-author']}>{commit.author}</span>
                {commit.timestamp && (
                    <span className={styles['hover-time']}>
                        , {formatRelativeTime(commit.timestamp)} ({formatAbsoluteTime(commit.timestamp)})
                    </span>
                )}
            </div>

            <div className={styles['hover-refs']}>
                {commit.refs ? (
                    commit.refs.split(',').map((r: string, i: number) => {
                        const trimmed = r.trim();
                        if (!trimmed) return null;
                        const isHead = trimmed.startsWith('HEAD -> ');
                        const name = isHead ? trimmed.replace('HEAD -> ', '') : trimmed;
                        return <span key={i} className={`${styles['ref-tag']} ${isHead ? styles['ref-head'] : ''}`}>{name}</span>;
                    })
                ) : (
                    branch ? <span className={`${styles['ref-tag']} ${styles['ref-head']}`}>{branch}</span> : null
                )}
            </div>

            <div className={styles['hover-message']}>{commit.message}</div>
            <div className={styles['hover-divider']}></div>
            <div className={styles['hover-footer']}>
                <Tooltip content="复制 Hash">
                    <span className={styles['hover-action-btn']} onClick={() => vscode.postMessage({ command: 'copy', text: commit.hash })}>
                        <i className="codicon codicon-copy" style={{ marginRight: '4px' }} /> {commit.hash.substring(0, 7)}
                    </span>
                </Tooltip>
            </div>
        </div>
    );
};

export default CommitHoverWidget;