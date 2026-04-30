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
  faLink,
  faGlobe,
  faTrash,
  faColumns,
  faCodeCompare,
} from '@fortawesome/free-solid-svg-icons';
import {
  faCopy,
  faSquareCheck,
  faClone,
  faFolderOpen as faFolderOpenReg,
  faWindowRestore,
  faFileCode,
} from '@fortawesome/free-regular-svg-icons';

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

export default function RecentProjectContextMenu({
  visible,
  x,
  y,
  type,
  payload,
  menuRef,
  onAction,
}: ContextMenuProps) {
  if (!visible) return null;

  const isLocalHtmlOrSvg = 
    !payload.path.startsWith('vscode-vfs') && 
    !payload.path.startsWith('http') && 
    /\.(html|htm|svg|svga)$/i.test(payload.path);

  return (
    <div className={styles['context-menu']} ref={menuRef as any} style={{ left: x, top: y }}>
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
            <div className={styles['menu-separator']}></div>

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
            {!payload.isActiveProject && (
              <>
                <div className={styles['menu-separator']}></div>
                <li onClick={() => onAction('delete')} style={{ color: 'var(--vscode-errorForeground)' }}>
                  <FontAwesomeIcon icon={faTrash} className={styles['menu-icon']} /> 移除该项目
                </li>
              </>
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
                <div className={styles['menu-separator']}></div>
              </>
            )}

            <li onClick={() => onAction('copyText', payload.name)}>
              <FontAwesomeIcon icon={faClone} className={styles['menu-icon']} /> 复制名称
            </li>
            <li onClick={() => onAction('copyText', payload.path)}>
              <FontAwesomeIcon icon={faLink} className={styles['menu-icon']} /> 复制路径
            </li>
            {!payload.path.startsWith('vscode-vfs') && !payload.path.startsWith('http') && (
              <>
                <div className={styles['menu-separator']}></div>
                <li onClick={() => onAction('revealInExplorer', payload.path)}>
                  <FontAwesomeIcon icon={faFolderOpenReg} className={styles['menu-icon']} /> 在访达/资源管理器中显示
                </li>
              </>
            )}
          </>
        )}
      </ul>
    </div>
  );
}