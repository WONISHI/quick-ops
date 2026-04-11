import React from 'react';
import styles from './index.module.css';
import { type GraphCommit } from '../GitGraph';

interface GitCompareListProps {
    commits: GraphCommit[];
    activeCommitHash: string | null;
    loadedCommitHash: string | null;
    commitFilesLoading: boolean;
    commitFiles: any[];
    onCommitClick: (hash: string) => void;
    renderCommitFiles: (files: any[]) => React.ReactNode;
}

const GitCompareList: React.FC<GitCompareListProps> = ({
    commits,
    activeCommitHash,
    loadedCommitHash,
    commitFilesLoading,
    commitFiles,
    onCommitClick,
    renderCommitFiles
}) => {
    if (commits.length === 0) {
        return <div className={styles['empty-message']}>没有记录</div>;
    }

    return (
        <ul className={styles['file-list']} style={{ padding: 0, margin: 0 }}>
            {commits.map(c => (
                <li key={c.hash} style={{ borderBottom: '1px solid var(--vscode-panel-border)', padding: 0 }}>
                    <div
                        className={styles['file-item']}
                        style={{ height: 'auto', padding: '4px 8px', display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer' }}
                        onClick={() => onCommitClick(c.hash)}
                    >
                        {/* 🌟 修改：移除首字母头像，替换为 git-commit 图标 */}
                        <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0, marginTop: '2px', color: 'var(--vscode-icon-foreground)'
                        }}>
                            <i className="codicon codicon-git-commit" style={{ fontSize: '14px' }} />
                        </div>

                        {/* 🌟 提交信息摘要 */}
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                            <div style={{ fontSize: '12px', color: 'var(--vscode-foreground)', lineHeight: '1.4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {c.message}
                            </div>
                        </div>
                    </div>

                    {/* 🌟 展开后的变动文件列表 */}
                    {activeCommitHash === c.hash && (
                        <div className={styles['commit-files-wrapper']} style={{ marginLeft: '28px', marginRight: '8px', marginBottom: '4px' }}>
                            {(commitFilesLoading || loadedCommitHash !== c.hash) ? (
                                <div style={{ height: '24px', display: 'flex', alignItems: 'center', opacity: 0.6, fontSize: '11px' }}>
                                    <i className="codicon codicon-loading codicon-modifier-spin" style={{ marginRight: '6px' }} /> 加载变动文件...
                                </div>
                            ) : renderCommitFiles(commitFiles)}
                        </div>
                    )}
                </li>
            ))}
        </ul>
    );
};

export default GitCompareList;