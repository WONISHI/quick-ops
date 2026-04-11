import React, { useState, useRef } from 'react';
import styles from './index.module.css'; // 请确保这个路径正确指向你的 css
import { type GraphCommit } from '../GitGraph';
import CommitHoverWidget from '../CommitHoverWidget'; // 🌟 引入刚改好的弹窗组件

interface GitCompareListProps {
    commits: GraphCommit[];
    activeCommitHash: string | null;
    loadedCommitHash: string | null;
    commitFilesLoading: boolean;
    commitFiles: any[];
    remoteUrl?: string; // 🌟 新增：接收 remoteUrl，为了弹窗能跳转
    onCommitClick: (hash: string) => void;
    renderCommitFiles: (files: any[]) => React.ReactNode;
}

const GitCompareList: React.FC<GitCompareListProps> = ({
    commits,
    activeCommitHash,
    loadedCommitHash,
    commitFilesLoading,
    commitFiles,
    remoteUrl,
    onCommitClick,
    renderCommitFiles
}) => {
    // 🌟 核心：管理 Hover 卡片状态和坐标
    const [hoverInfo, setHoverInfo] = useState<{ commit: GraphCommit, x: number, y: number, position: 'top' | 'bottom' } | null>(null);
    const hoverTimeoutRef = useRef<any>(null);

    // 🌟 鼠标移入时触发，计算坐标并延迟显示
    const handleMouseEnter = (e: React.MouseEvent, commit: GraphCommit) => {
        const rect = e.currentTarget.getBoundingClientRect();
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = setTimeout(() => {
            const showAbove = rect.top > window.innerHeight / 2;
            setHoverInfo({
                commit,
                x: rect.left, // 虽然我们现在子组件里用的是 50%，但为了接口统一依然传个值
                y: showAbove ? rect.top - 8 : rect.bottom + 4,
                position: showAbove ? 'top' : 'bottom'
            });
        }, 500); // 500ms 延迟，避免快速滑动时闪烁
    };

    // 🌟 鼠标移出时触发，延迟关闭
    const handleMouseLeave = () => {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = setTimeout(() => { setHoverInfo(null); }, 250);
    };

    // 🌟 点击项目时，不仅展开文件，还要强制关闭弹窗，以免遮挡
    const handleItemClick = (hash: string) => {
        clearTimeout(hoverTimeoutRef.current);
        setHoverInfo(null);
        onCommitClick(hash);
    };

    if (commits.length === 0) {
        return <div className={styles['empty-message']}>没有记录</div>;
    }

    return (
        <>
            {/* 🌟 核心：渲染刚刚完美封装的悬浮卡片 */}
            {hoverInfo && (
                <CommitHoverWidget
                    commit={hoverInfo.commit}
                    x={hoverInfo.x}
                    y={hoverInfo.y}
                    position={hoverInfo.position}
                    remoteUrl={remoteUrl} 
                    onMouseEnter={() => clearTimeout(hoverTimeoutRef.current)} // 鼠标移入弹窗本身时保持开启
                    onMouseLeave={handleMouseLeave}
                />
            )}

            <ul className={styles['file-list']} style={{ padding: 0, margin: 0 }}>
                {commits.map(c => (
                    <li key={c.hash} style={{ borderBottom: '1px solid var(--vscode-panel-border)', padding: 0 }}>
                        <div
                            className={styles['file-item']}
                            style={{ height: 'auto', padding: '4px 8px', display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer' }}
                            onClick={() => handleItemClick(c.hash)}
                            onMouseEnter={(e) => handleMouseEnter(e, c)} // 🌟 挂载鼠标事件
                            onMouseLeave={handleMouseLeave}              // 🌟 挂载鼠标事件
                        >
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flexShrink: 0, marginTop: '2px', color: 'var(--vscode-icon-foreground)'
                            }}>
                                <i className="codicon codicon-git-commit" style={{ fontSize: '14px' }} />
                            </div>

                            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                                <div style={{ fontSize: '12px', color: 'var(--vscode-foreground)', lineHeight: '1.4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {c.message}
                                </div>
                            </div>
                        </div>

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
        </>
    );
};

export default GitCompareList;