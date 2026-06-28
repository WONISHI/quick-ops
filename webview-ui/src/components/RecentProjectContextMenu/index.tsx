import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faMagnifyingGlass,
  faCodeBranch,
  faArrowRightToBracket,
  faArrowUpRightFromSquare,
  faPen,
  faLocationDot,
  faRotateRight,
  faRotateLeft,
  faLink,
  faGlobe,
  faTrash,
  faColumns,
  faCodeCompare,
  faListUl,
  faFolderPlus,
  faBullseye,
  faFolderMinus,
} from '@fortawesome/free-solid-svg-icons';
import { faCopy, faSquareCheck, faClone, faFolderOpen as faFolderOpenReg, faWindowRestore, faFileCode } from '@fortawesome/free-regular-svg-icons';

import styles from './index.module.css';
import type { ContextMenuPayload } from '../../types/RecentProjectsApp';

interface ContextMenuProps {
  visible: boolean;
  x: number;
  y: number;
  type: 'top' | 'sub';
  payload: ContextMenuPayload;
  menuRef: React.RefObject<HTMLDivElement | null>;
  onAction: (action: string, arg?: string) => void;
}

function getStatusKey(status?: string) {
  const raw = String(status || '').trim();

  if (!raw) return '';

  const cleanStatus = raw
    .replace(/[\[\]]/g, '')
    .replace(/^\s*[·•-]?\s*/, '')
    .trim();

  const tokens = cleanStatus
    .split(/[\s,|/]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const matchedToken = tokens.find((item) => {
    const key = item[0]?.toUpperCase();

    return !!key && ['U', '?', 'M', 'A', 'D', 'R', 'C', 'I', '!', 'X', 'T'].includes(key);
  });

  if (matchedToken) {
    return matchedToken[0].toUpperCase();
  }

  const compactStatus = cleanStatus.replace(/\s+/g, '');

  return (
    ['U', '?', 'M', 'A', 'D', 'R', 'C', 'I', '!', 'X', 'T'].find((key) => {
      return key === '?' ? compactStatus.includes('?') : compactStatus.toUpperCase().includes(key);
    }) || ''
  );
}

export default function RecentProjectContextMenu({ visible, x, y, type, payload, menuRef, onAction }: ContextMenuProps) {
  if (!visible) return null;

  const isRemotePath = payload.path.startsWith('vscode-vfs') || payload.path.startsWith('http');
  const isLocalHtmlOrSvg = !isRemotePath && /\.(html|htm|svg|svga)$/i.test(payload.path);

  const statusKey = getStatusKey((payload as any).status);

  /**
   * “与旧代码对比 / 取消变更”只允许当前运行项目展示。
   *
   * 历史项目、远程项目、只读预览项目虽然也可能有 status，
   * 但它们不是当前 VS Code 工作区，右侧无法稳定作为可编辑工作区文件，
   * 所以这里统一不显示这两个操作，保持和 VS Code 原生资源管理器一致。
   */
  const hasFileChangeStatus = type === 'sub' && !payload.isFolder && !isRemotePath && !!payload.isActiveProject && !!statusKey;

  const menuStyle: React.CSSProperties = {};

  const estimatedWidth = 230;
  menuStyle.left = Math.max(4, Math.min(x, window.innerWidth - estimatedWidth));
  if (y > window.innerHeight / 2) {
    menuStyle.bottom = window.innerHeight - y;
    menuStyle.top = 'auto';
  } else {
    menuStyle.top = y;
    menuStyle.bottom = 'auto';
  }

  return (
    <div className={styles['context-menu']} ref={menuRef as any} style={menuStyle}>
      <ul>
        {type === 'top' && (
          <>
            {!payload.isActiveProject && (
              <>
                <li onClick={() => onAction('openProjectCurrent')}>
                  <FontAwesomeIcon icon={faArrowRightToBracket} className={styles['menu-icon']} /> 在当前窗口打开
                </li>
                <li onClick={() => onAction('openInNewWindow')}>
                  <FontAwesomeIcon icon={faArrowUpRightFromSquare} className={styles['menu-icon']} /> 在新窗口打开
                </li>
                <div className={styles['menu-separator']}></div>
              </>
            )}

            <li onClick={() => onAction('searchInFolder')}>
              <FontAwesomeIcon icon={faMagnifyingGlass} className={styles['menu-icon']} /> 查找文件内容...
            </li>

            {payload.isActiveProject && (
              <li onClick={() => onAction('focusMode')}>
                <FontAwesomeIcon icon={faBullseye} className={styles['menu-icon']} /> 专注模式
              </li>
            )}

            <div className={styles['menu-separator']}></div>

            <li onClick={() => onAction('addToGitList')}>
              <FontAwesomeIcon icon={faListUl} className={styles['menu-icon']} /> 添加到 Git 记录列表
            </li>

            <li onClick={() => onAction('edit')}>
              <FontAwesomeIcon icon={faPen} className={styles['menu-icon']} /> 编辑项目名称
            </li>
            <li onClick={() => onAction('changeAddress')}>
              <FontAwesomeIcon icon={faLocationDot} className={styles['menu-icon']} /> 更换地址
            </li>
            {payload.isRemote && (
              <li onClick={() => onAction('switchBranch')}>
                <FontAwesomeIcon icon={faCodeBranch} className={styles['menu-icon']} /> 切换分支
              </li>
            )}
            <div className={styles['menu-separator']}></div>
            <li onClick={() => onAction('copyText', payload.originalName)}>
              <FontAwesomeIcon icon={faCopy} className={styles['menu-icon']} /> 复制文件名
            </li>
            <li onClick={() => onAction('updateBranch')}>
              <FontAwesomeIcon icon={faRotateRight} className={styles['menu-icon']} /> 更新分支
            </li>
            {payload.customName && (
              <li onClick={() => onAction('copyText', payload.customName)}>
                <FontAwesomeIcon icon={faCopy} className={styles['menu-icon']} /> 复制项目名
              </li>
            )}
            <li onClick={() => onAction('copyText', payload.path)}>
              <FontAwesomeIcon icon={faLink} className={styles['menu-icon']} /> 复制地址链接
            </li>
            {payload.isRemote ? (
              <li onClick={() => onAction('openLink')}>
                <FontAwesomeIcon icon={faGlobe} className={styles['menu-icon']} /> 在浏览器中打开
              </li>
            ) : (
              <li onClick={() => onAction('revealInExplorer')}>
                <FontAwesomeIcon icon={faFolderOpenReg} className={styles['menu-icon']} /> 在访达/资源管理器中显示
              </li>
            )}

            <div className={styles['menu-separator']}></div>
            {payload.isActiveProject ? (
              !(payload as any).inHistory ? (
                <li onClick={() => onAction('addToHistory')}>
                  <FontAwesomeIcon icon={faFolderPlus} className={styles['menu-icon']} /> 添加到资源管理器记录
                </li>
              ) : (
                <li onClick={() => onAction('delete')} style={{ color: 'var(--vscode-errorForeground)' }}>
                  <FontAwesomeIcon icon={faTrash} className={styles['menu-icon']} /> 从资源管理器记录中移除
                </li>
              )
            ) : (
              <li onClick={() => onAction('delete')} style={{ color: 'var(--vscode-errorForeground)' }}>
                <FontAwesomeIcon icon={faTrash} className={styles['menu-icon']} /> 移除该项目
              </li>
            )}
          </>
        )}

        {type === 'sub' && (
          <>
            {!payload.isFolder && (
              <>
                {isLocalHtmlOrSvg && (
                  <>
                    <li onClick={() => onAction('openWith')}>
                      <FontAwesomeIcon icon={faFileCode} className={styles['menu-icon']} /> 打开方式...
                    </li>
                    <div className={styles['menu-separator']}></div>
                  </>
                )}

                <li onClick={() => onAction('openFileToSide')}>
                  <FontAwesomeIcon icon={faColumns} className={styles['menu-icon']} /> 向右拆分
                </li>
                <li onClick={() => onAction('openFileInNewTab')}>
                  <FontAwesomeIcon icon={faWindowRestore} className={styles['menu-icon']} /> 在新标签页打开
                </li>

                {hasFileChangeStatus && (
                  <>
                    <li onClick={() => onAction('compareWithOldCode')}>
                      <FontAwesomeIcon icon={faCodeCompare} className={styles['menu-icon']} /> 与旧代码对比
                    </li>
                    <div className={styles['menu-separator']}></div>
                  </>
                )}

                <li onClick={() => onAction('copyFile')}>
                  <FontAwesomeIcon icon={faCopy} className={styles['menu-icon']} /> 复制文件
                </li>
                <div className={styles['menu-separator']}></div>
                <li onClick={() => onAction('selectForCompare')}>
                  <FontAwesomeIcon icon={faSquareCheck} className={styles['menu-icon']} /> 选择以进行比较
                </li>
                <li onClick={() => onAction('compareWithSelected')}>
                  <FontAwesomeIcon icon={faCodeCompare} className={styles['menu-icon']} /> 与已选项目进行比较
                </li>
                <div className={styles['menu-separator']}></div>
              </>
            )}

            {payload.isFolder && (
              <>
                <li onClick={() => onAction('searchInFolder')}>
                  <FontAwesomeIcon icon={faMagnifyingGlass} className={styles['menu-icon']} /> 查找文件内容...
                </li>
                <li onClick={() => onAction('collapseFolderChildren')}>
                  <FontAwesomeIcon icon={faFolderMinus} className={styles['menu-icon']} /> 折叠
                </li>
                {!payload.isRemote && (
                  <>
                    <div className={styles['menu-separator']}></div>
                    <li onClick={() => onAction('createFile')}>
                      <FontAwesomeIcon icon={faFileCode} className={styles['menu-icon']} /> 新建文件
                    </li>
                    <li onClick={() => onAction('createFolder')}>
                      <FontAwesomeIcon icon={faFolderPlus} className={styles['menu-icon']} /> 新建文件夹
                    </li>
                  </>
                )}
                <div className={styles['menu-separator']}></div>
              </>
            )}

            <li onClick={() => onAction('copyText', payload.name)}>
              <FontAwesomeIcon icon={faClone} className={styles['menu-icon']} /> 复制名称
            </li>
            <li onClick={() => onAction('copyText', payload.path)}>
              <FontAwesomeIcon icon={faLink} className={styles['menu-icon']} /> 复制路径
            </li>
            {!isRemotePath && (
              <>
                <div className={styles['menu-separator']}></div>
                <li onClick={() => onAction('revealInExplorer', payload.path)}>
                  <FontAwesomeIcon icon={faFolderOpenReg} className={styles['menu-icon']} /> 在访达/资源管理器中显示
                </li>
              </>
            )}

            {!payload.isFolder && !payload.isActiveProject && (
              <>
                <div className={styles['menu-separator']}></div>
                <li onClick={() => onAction('openInVsCode')}>
                  <FontAwesomeIcon icon={faFileCode} className={styles['menu-icon']} /> 在 VS Code 中打开...
                </li>
              </>
            )}

            {payload.isActiveProject && !payload.isRemote && (
              <>
                <div className={styles['menu-separator']}></div>
                <li onClick={() => onAction('renameFileEntity')}>
                  <FontAwesomeIcon icon={faPen} className={styles['menu-icon']} /> 重命名
                </li>
                {hasFileChangeStatus && (
                  <li onClick={() => onAction('discardFileChanges')} style={{ color: 'var(--vscode-errorForeground)' }}>
                    <FontAwesomeIcon icon={faRotateLeft} className={styles['menu-icon']} /> 取消变更
                  </li>
                )}
                <li onClick={() => onAction('deleteFileEntity')} style={{ color: 'var(--vscode-errorForeground)' }}>
                  <FontAwesomeIcon icon={faTrash} className={styles['menu-icon']} /> 删除
                </li>
              </>
            )}
          </>
        )}
      </ul>
    </div>
  );
}
