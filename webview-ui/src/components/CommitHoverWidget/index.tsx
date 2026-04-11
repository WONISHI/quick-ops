import React from 'react';
import { vscode } from '../../utils/vscode';
import styles from './index.module.css';
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

export function parseRemoteInfo(url: string, hash: string) {
    if (!url) return null;
    let cleanUrl = url.replace(/\.git$/, '').trim();
    if (cleanUrl.startsWith('git@')) {
        cleanUrl = cleanUrl.replace(/^git@([^:]+):/, 'https://$1/');
    }
    let platform = 'GitLab';
    let icon = 'codicon-repo';
    if (cleanUrl.includes('github.com')) { platform = 'GitHub'; icon = 'codicon-github'; }
    else if (cleanUrl.includes('gitee.com')) { platform = 'Gitee'; }
    return { platform, icon, url: `${cleanUrl}/commit/${hash}` };
}

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
    onMouseLeave
}) => {
    return (
        <div
            className={styles['commit-hover-widget']}
            style={{
                left: '50%',
                transform: 'translateX(-50%)',
                ...(position === 'top' ? { bottom: window.innerHeight - y } : { top: y })
            }}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <div className={styles['hover-header']}>
                <div className={styles['hover-avatar']}>{commit.author ? commit.author[0].toUpperCase() : 'U'}</div>
                <div className={styles['hover-detail']}>
                    <span className={styles['hover-author']}>{commit.author}</span>
                    {commit.timestamp && (
                        <span className={styles['hover-time']} style={{ display: 'flex', alignItems: 'center' }}>
                            <i className="codicon codicon-clock" style={{ marginRight: '4px', fontSize: '13px' }} />
                            {formatRelativeTime(commit.timestamp)} ({formatAbsoluteTime(commit.timestamp)})
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
                        return <span key={i} className={`${styles['ref-tag']} ${isHead ? styles['ref-head'] : ''}`}>{name}</span>;
                    })
                ) : (
                    branch ? <span className={`${styles['ref-tag']} ${styles['ref-head']}`}>{branch}</span> : null
                )}
            </div>

            <div className={styles['hover-message']}>{commit.message}</div>
            <div className={styles['hover-divider']}></div>

            <div className={styles['hover-footer']}>
                {/* 🌟 核心修改：移除 <Tooltip> 包装，直接在 span 上使用原生的 title 属性 */}
                <span
                    className={styles['hover-action-btn']}
                    title="复制 Hash"
                    onClick={() => vscode.postMessage({ command: 'copy', text: commit.hash })}
                >
                    <i className="codicon codicon-copy" style={{ marginRight: '4px' }} /> {commit.hash.substring(0, 7)}
                </span>

                {remoteUrl && parseRemoteInfo(remoteUrl, commit.hash) && (
                    <>
                        <span className={styles['hover-separator']}>|</span>
                        {/* 🌟 核心修改：移除 <Tooltip> 包装，直接在 span 上使用原生的 title 属性 */}
                        <span
                            className={styles['hover-action-btn']}
                            title="查看记录"
                            onClick={() => vscode.postMessage({ command: 'openExternal', url: parseRemoteInfo(remoteUrl, commit.hash)!.url })}
                        >
                            <i className={`codicon ${parseRemoteInfo(remoteUrl, commit.hash)!.icon}`} style={{ marginRight: '4px' }} /> 在 {parseRemoteInfo(remoteUrl, commit.hash)!.platform} 上打开
                        </span>
                    </>
                )}
            </div>
        </div>
    );
};

export default CommitHoverWidget;