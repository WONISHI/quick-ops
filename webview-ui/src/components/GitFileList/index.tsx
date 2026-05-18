import React from 'react';
import { vscode } from '../../utils/vscode';
import styles from './index.module.css';
import Tooltip from '../Tooltip';
import FileIcon from '../FileIcon';
import type { GitFile, TreeNode } from '../../types/GitApp';
import type { ContextMenuState } from '../GitContextMenu';
import { getStatusText, getStatusFullText, buildTree } from '../../utils/index';

const getStatusClass = (status: string) => {
  if (status.includes('M')) return styles['status-M'];
  if (status.includes('D')) return styles['status-D'];
  return styles['status-A'];
};

interface GitFileListProps {
  files: GitFile[];
  listType: 'staged' | 'unstaged' | 'history' | 'compare' | 'stash-file';
  historyHash?: string;
  viewMode: 'list' | 'tree';
  activeFile: string | null;
  setActiveFile: (file: string | null) => void;
  expandedDirs: Record<string, boolean>;
  toggleDir: (path: string, e: React.MouseEvent) => void;
  openHistoryDiff: (item: GitFile, historyHash?: string) => void;
  openCompareDiff: (item: GitFile) => void;
  setContextMenu: (state: ContextMenuState) => void;
}

const GitFileList: React.FC<GitFileListProps> = ({ files, listType, historyHash, viewMode, activeFile, setActiveFile, expandedDirs, toggleDir, openHistoryDiff, openCompareDiff, setContextMenu }) => {
  const renderTreeNodes = (nodes: TreeNode[], depth = 0): React.ReactNode => {
    return nodes.map((node) => {
      if (node.isDirectory) {
        const isOpen = expandedDirs[node.fullPath] !== false;
        return (
          <React.Fragment key={node.fullPath}>
            <li className={styles['file-item']} style={{ paddingLeft: `${depth * 12 + 4}px`, cursor: 'pointer' }} onClick={(e) => toggleDir(node.fullPath, e)}>
              <i className={`codicon ${isOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} style={{ fontSize: '14px', width: '16px', opacity: 0.8, marginRight: '2px' }} />
              <i className="codicon codicon-folder" style={{ marginRight: '6px', color: 'var(--vscode-icon-foreground)' }} />
              <div className={styles['file-name']} style={{ opacity: 0.9 }}>
                {node.name}
              </div>
            </li>
            {isOpen && renderTreeNodes(node.children, depth + 1)}
          </React.Fragment>
        );
      }

      const item = node.file!;
      const parts = item.file.split('/');
      const fileName = parts.pop();
      const isDeleted = item.status.includes('D') && ['staged', 'unstaged'].includes(listType);

      return (
        <li
          key={item.file}
          className={`${styles['file-item']} ${activeFile === item.file ? styles['active'] : ''}`}
          style={{ paddingLeft: `${depth * 12 + 24}px` }}
          title={item.file}
          onClick={() => {
            setActiveFile(item.file);
            if (listType === 'history') {
              openHistoryDiff(item, historyHash);
            } else if (listType === 'compare') {
              openCompareDiff(item);
            } else if (listType === 'stash-file') {
              vscode.postMessage({ command: 'open', file: item.file });
            } else {
              vscode.postMessage({ command: 'diff', file: item.file, status: item.status });
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setActiveFile(item.file);
            setContextMenu({ visible: true, x: e.clientX, y: e.clientY, type: 'file', file: item, listType: listType as any });
          }}
        >
          <FileIcon fileName={fileName || ''} className={styles['file-icon']} style={{ marginRight: '6px' }} />
          <div className={styles['file-name']} style={isDeleted ? { textDecoration: 'line-through', opacity: 0.6 } : {}}>
            {fileName}
          </div>
          <div style={{ flex: 1 }}></div>

          <div className={styles['file-actions']} onClick={(e) => e.stopPropagation()}>
            <Tooltip content="打开文件">
              <button className={styles['action-btn']} onClick={() => vscode.postMessage({ command: 'open', file: item.file })}>
                <i className="codicon codicon-go-to-file" />
              </button>
            </Tooltip>

            {listType === 'unstaged' && (
              <Tooltip content="放弃更改">
                <button className={styles['action-btn']} onClick={() => vscode.postMessage({ command: 'discard', file: item.file, status: item.status })}>
                  <i className="codicon codicon-discard" />
                </button>
              </Tooltip>
            )}

            {listType !== 'history' && listType !== 'compare' && listType !== 'stash-file' && (
              <>
                {listType === 'staged' ? (
                  <Tooltip content="取消暂存更改">
                    <button className={styles['action-btn']} onClick={() => vscode.postMessage({ command: 'unstage', file: item.file })}>
                      <i className="codicon codicon-remove" />
                    </button>
                  </Tooltip>
                ) : (
                  <Tooltip content="暂存更改">
                    <button className={styles['action-btn']} onClick={() => vscode.postMessage({ command: 'stage', file: item.file, status: item.status })}>
                      <i className="codicon codicon-plus" />
                    </button>
                  </Tooltip>
                )}
              </>
            )}
          </div>

          <Tooltip content={getStatusFullText(item.status)}>
            <div className={`${styles['status-badge']} ${getStatusClass(item.status)}`} style={item.status === 'C' ? { color: '#f14c4c', fontWeight: 'bold' } : {}}>
              {getStatusText(item.status)}
            </div>
          </Tooltip>
        </li>
      );
    });
  };

  if (viewMode === 'tree') {
    const treeNodes = buildTree(files);
    return <ul className={styles['file-list']}>{renderTreeNodes(treeNodes, 0)}</ul>;
  }

  return (
    <ul className={styles['file-list']}>
      {files.map((item, idx) => {
        const parts = item.file.split('/');
        const fileName = parts.pop();
        const dirPath = parts.length > 0 ? parts.join('/') : '';
        const isDeleted = item.status.includes('D') && ['staged', 'unstaged'].includes(listType);

        return (
          <Tooltip key={item.file} content={item.file} placement="bottom" delay={1000}>
            <li
              key={idx}
              className={`${styles['file-item']} ${activeFile === item.file ? styles['active'] : ''}`}
              title={item.file}
              onClick={() => {
                setActiveFile(item.file);
                if (listType === 'history') {
                  openHistoryDiff(item, historyHash);
                } else if (listType === 'compare') {
                  openCompareDiff(item);
                } else if (listType === 'stash-file') {
                  vscode.postMessage({ command: 'open', file: item.file });
                } else {
                  vscode.postMessage({ command: 'diff', file: item.file, status: item.status });
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setActiveFile(item.file);
                setContextMenu({ visible: true, x: e.clientX, y: e.clientY, type: 'file', file: item, listType: listType as any });
              }}
            >
              <FileIcon fileName={fileName || ''} className={styles['file-icon']} style={{ marginRight: '6px' }} />
              <div className={styles['file-name']} style={isDeleted ? { textDecoration: 'line-through', opacity: 0.6 } : {}}>
                {fileName}
              </div>
              {dirPath && <div className={styles['file-dir']}>{dirPath}</div>}
              <div style={{ flex: 1 }}></div>

              <div className={styles['file-actions']} onClick={(e) => e.stopPropagation()}>
                <Tooltip content="打开文件">
                  <button className={styles['action-btn']} onClick={() => vscode.postMessage({ command: 'open', file: item.file })}>
                    <i className="codicon codicon-go-to-file" />
                  </button>
                </Tooltip>

                {listType === 'unstaged' && (
                  <Tooltip content="放弃更改">
                    <button className={styles['action-btn']} onClick={() => vscode.postMessage({ command: 'discard', file: item.file, status: item.status })}>
                      <i className="codicon codicon-discard" />
                    </button>
                  </Tooltip>
                )}

                {listType !== 'history' && listType !== 'compare' && listType !== 'stash-file' && (
                  <>
                    {listType === 'staged' ? (
                      <Tooltip content="取消暂存更改">
                        <button className={styles['action-btn']} onClick={() => vscode.postMessage({ command: 'unstage', file: item.file })}>
                          <i className="codicon codicon-remove" />
                        </button>
                      </Tooltip>
                    ) : (
                      <Tooltip content="暂存更改">
                        <button className={styles['action-btn']} onClick={() => vscode.postMessage({ command: 'stage', file: item.file, status: item.status })}>
                          <i className="codicon codicon-plus" />
                        </button>
                      </Tooltip>
                    )}
                  </>
                )}
              </div>

              <Tooltip content={getStatusFullText(item.status)}>
                <div className={`${styles['status-badge']} ${getStatusClass(item.status)}`} style={item.status === 'C' ? { color: '#f14c4c', fontWeight: 'bold' } : {}}>
                  {getStatusText(item.status)}
                </div>
              </Tooltip>
            </li>
          </Tooltip>
        );
      })}
    </ul>
  );
};

export default GitFileList;
