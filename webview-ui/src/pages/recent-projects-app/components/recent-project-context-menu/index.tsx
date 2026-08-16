import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
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
  faFolderOpen,
  faTerminal,
  faPaste,
} from '@fortawesome/free-solid-svg-icons';
import { faCopy, faSquareCheck, faClone, faFolderOpen as faFolderOpenReg, faWindowRestore, faFileCode } from '@fortawesome/free-regular-svg-icons';

import BaseContextMenu from '@components/BaseContextMenu';
import type { BaseContextMenuItem } from '@components/BaseContextMenu/src/type';
import type { ContextMenuPayload } from '@/pages/recent-projects-app/src/type';
import type {RecentProjectContextMenuProps} from "@pages/recent-projects-app/components/recent-project-context-menu/src/type"



function createIcon(icon: IconDefinition) {
  return <FontAwesomeIcon icon={icon} />;
}

function createSeparator(key: string): BaseContextMenuItem {
  return {
    type: 'separator',
    key,
  };
}

function getStatusKey(status?: string): string {
  const raw = String(status || '').trim();

  if (!raw) {
    return '';
  }

  const cleanStatus = raw
    .replace(/\[|\]/g, '')
    .replace(/^\s*[·•-]?\s*/, '')
    .trim();

  const tokens = cleanStatus
    .split(/[\s,|/]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const matchedToken = tokens.find((item) => {
    const key = item[0]?.toUpperCase();

    return Boolean(key) && ['U', '?', 'M', 'A', 'D', 'R', 'C', 'I', '!', 'X', 'T'].includes(key);
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

function canPasteFile(payload: ContextMenuPayload): boolean {
  return Boolean((payload as ContextMenuPayload & { canPasteFile?: boolean }).canPasteFile);
}

function createTopMenuItems(payload: ContextMenuPayload, onAction: (action: string, arg?: string) => void): BaseContextMenuItem[] {
  const items: BaseContextMenuItem[] = [];

  if (!payload.isActiveProject) {
    items.push(
      {
        key: 'open-project-current',
        label: '在当前窗口打开',
        icon: createIcon(faArrowRightToBracket),
        onSelect: () => {
          onAction('openProjectCurrent');
        },
      },
      {
        key: 'open-project-new-window',
        label: '在新窗口打开',
        icon: createIcon(faArrowUpRightFromSquare),
        onSelect: () => {
          onAction('openInNewWindow');
        },
      },
      createSeparator('top-open-separator'),
    );
  }

  items.push({
    key: 'search-in-project',
    label: '查找文件内容...',
    icon: createIcon(faMagnifyingGlass),
    onSelect: () => {
      onAction('searchInFolder');
    },
  });

  if (payload.isActiveProject) {
    items.push({
      key: 'focus-mode',
      label: '专注模式',
      icon: createIcon(faBullseye),
      onSelect: () => {
        onAction('focusMode');
      },
    });
  }

  if (!payload.isRemote && canPasteFile(payload)) {
    items.push(
      createSeparator('top-paste-separator'),
      {
        key: 'paste-file-to-project',
        label: '粘贴',
        icon: createIcon(faPaste),
        onSelect: () => {
          onAction('pasteFile');
        },
      },
    );
  }

  items.push(
    createSeparator('top-search-separator'),
    {
      key: 'add-to-git-list',
      label: '添加到 Git 记录列表',
      icon: createIcon(faListUl),
      onSelect: () => {
        onAction('addToGitList');
      },
    },
    {
      key: 'edit-project-name',
      label: '编辑项目名称',
      icon: createIcon(faPen),
      onSelect: () => {
        onAction('edit');
      },
    },
    {
      key: 'change-project-address',
      label: '更换地址',
      icon: createIcon(faLocationDot),
      onSelect: () => {
        onAction('changeAddress');
      },
    },
  );

  if (payload.isRemote) {
    items.push({
      key: 'switch-branch',
      label: '切换分支',
      icon: createIcon(faCodeBranch),
      onSelect: () => {
        onAction('switchBranch');
      },
    });
  }

  items.push(
    createSeparator('top-edit-separator'),
    {
      key: 'copy-original-name',
      label: '复制文件名',
      icon: createIcon(faCopy),
      onSelect: () => {
        onAction('copyText', payload.originalName);
      },
    },
    {
      key: 'update-branch',
      label: '更新分支',
      icon: createIcon(faRotateRight),
      onSelect: () => {
        onAction('updateBranch');
      },
    },
  );

  if (payload.customName) {
    items.push({
      key: 'copy-custom-name',
      label: '复制项目名',
      icon: createIcon(faCopy),
      onSelect: () => {
        onAction('copyText', payload.customName);
      },
    });
  }

  items.push({
    key: 'copy-project-path',
    label: '复制地址链接',
    icon: createIcon(faLink),
    onSelect: () => {
      onAction('copyText', payload.path);
    },
  });

  if (payload.isRemote) {
    items.push({
      key: 'open-project-in-browser',
      label: '在浏览器中打开',
      icon: createIcon(faGlobe),
      onSelect: () => {
        onAction('openLink');
      },
    });
  } else {
    items.push({
      key: 'reveal-project-in-explorer',
      label: '在访达/资源管理器中显示',
      icon: createIcon(faFolderOpenReg),
      onSelect: () => {
        onAction('revealInExplorer');
      },
    });
  }

  items.push(createSeparator('top-remove-separator'));

  if (payload.isActiveProject) {
    if (
      !(
        payload as {
          inHistory?: boolean;
        }
      ).inHistory
    ) {
      items.push({
        key: 'add-active-project-history',
        label: '添加到资源管理器记录',
        icon: createIcon(faFolderPlus),
        onSelect: () => {
          onAction('addToHistory');
        },
      });
    } else {
      items.push({
        key: 'remove-active-project-history',
        label: '从资源管理器记录中移除',
        icon: createIcon(faTrash),
        danger: true,
        onSelect: () => {
          onAction('delete');
        },
      });
    }
  } else {
    items.push({
      key: 'remove-project',
      label: '移除该项目',
      icon: createIcon(faTrash),
      danger: true,
      onSelect: () => {
        onAction('delete');
      },
    });
  }

  return items;
}

function createSubMenuItems(payload: ContextMenuPayload, onAction: (action: string, arg?: string) => void): BaseContextMenuItem[] {
  const items: BaseContextMenuItem[] = [];

  const isRemotePath = payload.path.startsWith('vscode-vfs') || payload.path.startsWith('http');

  const isLocalHtmlOrSvg = !isRemotePath && /\.(html|htm|svg|svga)$/i.test(payload.path);

  const statusKey = getStatusKey(
    (
      payload as {
        status?: string;
      }
    ).status,
  );

  /**
   * “与旧代码对比 / 取消变更”只允许当前运行项目展示。
   */
  const hasFileChangeStatus = !payload.isFolder && !isRemotePath && Boolean(payload.isActiveProject) && Boolean(statusKey);

  if (!payload.isFolder) {
    if (isLocalHtmlOrSvg) {
      items.push(
        {
          key: 'open-with',
          label: '打开方式...',
          icon: createIcon(faFileCode),
          onSelect: () => {
            onAction('openWith');
          },
        },
        createSeparator('sub-open-with-separator'),
      );
    }

    items.push(
      {
        key: 'open-file-to-side',
        label: '向右拆分',
        icon: createIcon(faColumns),
        onSelect: () => {
          onAction('openFileToSide');
        },
      },
      {
        key: 'open-file-in-new-tab',
        label: '在新标签页打开',
        icon: createIcon(faWindowRestore),
        onSelect: () => {
          onAction('openFileInNewTab');
        },
      },
    );

    /**
     * 只有当前运行项目中的本地文件才允许在集成终端中打开。
     * 终端工作目录使用该文件所在文件夹。
     */
    if (payload.isActiveProject && !isRemotePath) {
      items.push({
        key: 'open-file-in-integrated-terminal',
        label: '在集成终端中打开',
        icon: createIcon(faTerminal),
        onSelect: () => {
          onAction('openInIntegratedTerminal');
        },
      });
    }

    if (hasFileChangeStatus) {
      items.push(
        {
          key: 'compare-with-old-code',
          label: '与旧代码对比',
          icon: createIcon(faCodeCompare),
          onSelect: () => {
            onAction('compareWithOldCode');
          },
        },
        createSeparator('sub-change-separator'),
      );
    }

    items.push(
      {
        key: 'copy-file',
        label: '复制文件',
        icon: createIcon(faCopy),
        onSelect: () => {
          onAction('copyFile');
        },
      },
      createSeparator('sub-copy-file-separator'),
      {
        key: 'select-for-compare',
        label: '选择以进行比较',
        icon: createIcon(faSquareCheck),
        onSelect: () => {
          onAction('selectForCompare');
        },
      },
      {
        key: 'compare-with-selected',
        label: '与已选项目进行比较',
        icon: createIcon(faCodeCompare),
        onSelect: () => {
          onAction('compareWithSelected');
        },
      },
      createSeparator('sub-compare-separator'),
    );
  } else {
    items.push({
      key: 'search-in-sub-folder',
      label: '查找文件内容...',
      icon: createIcon(faMagnifyingGlass),
      onSelect: () => {
        onAction('searchInFolder');
      },
    });

    const isExpanded = Boolean((payload as ContextMenuPayload & { isExpanded?: boolean }).isExpanded);

    if (isExpanded) {
      items.push({
        key: 'collapse-folder-children',
        label: '折叠',
        icon: createIcon(faFolderMinus),
        onSelect: () => {
          onAction('collapseFolderChildren');
        },
      });
    } else {
      items.push({
        key: 'expand-folder-children',
        label: '展开',
        icon: createIcon(faFolderOpen),
        onSelect: () => {
          onAction('expandFolderChildren');
        },
      });
    }

    if (!payload.isRemote) {
      items.push(
        createSeparator('sub-create-separator'),
        {
          key: 'create-file',
          label: '新建文件',
          icon: createIcon(faFileCode),
          onSelect: () => {
            onAction('createFile');
          },
        },
        {
          key: 'create-folder',
          label: '新建文件夹',
          icon: createIcon(faFolderPlus),
          onSelect: () => {
            onAction('createFolder');
          },
        },
      );

      if (canPasteFile(payload)) {
        items.push(
          createSeparator('sub-paste-separator'),
          {
            key: 'paste-file-to-folder',
            label: '粘贴',
            icon: createIcon(faPaste),
            onSelect: () => {
              onAction('pasteFile');
            },
          },
        );
      }
    }

    items.push(createSeparator('sub-folder-separator'));
  }

  items.push(
    {
      key: 'copy-entity-name',
      label: '复制名称',
      icon: createIcon(faClone),
      onSelect: () => {
        onAction('copyText', payload.name);
      },
    },
    {
      key: 'copy-entity-path',
      label: '复制路径',
      icon: createIcon(faLink),
      children: [
        {
          key: 'copy-entity-absolute-path',
          label: '复制绝对地址',
          icon: createIcon(faCopy),
          onSelect: () => {
            onAction('copyPath', 'absolute');
          },
        },
        {
          key: 'copy-entity-relative-path',
          label: '复制相对地址',
          icon: createIcon(faCopy),
          onSelect: () => {
            onAction('copyPath', 'relative');
          },
        },
        {
          key: 'copy-entity-physical-path',
          label: '复制物理地址',
          icon: createIcon(faCopy),
          onSelect: () => {
            onAction('copyText', payload.path);
          },
        },
      ],
    },
  );

  if (!isRemotePath) {
    items.push(createSeparator('sub-reveal-separator'), {
      key: 'reveal-entity-in-explorer',
      label: '在访达/资源管理器中显示',
      icon: createIcon(faFolderOpenReg),
      onSelect: () => {
        onAction('revealInExplorer', payload.path);
      },
    });
  }

  if (!payload.isFolder && !payload.isActiveProject) {
    items.push(createSeparator('sub-open-vscode-separator'), {
      key: 'open-in-vscode',
      label: '在 VS Code 中打开...',
      icon: createIcon(faFileCode),
      onSelect: () => {
        onAction('openInVsCode');
      },
    });
  }

  if (payload.isActiveProject && !isRemotePath) {
    items.push(createSeparator('sub-edit-entity-separator'));

    if (hasFileChangeStatus) {
      items.push({
        key: 'discard-file-changes',
        label: '取消变更',
        icon: createIcon(faRotateLeft),
        danger: true,
        onSelect: () => {
          onAction('discardFileChanges');
        },
      });
    }

    items.push(
      {
        key: 'rename-file-entity',
        label: '重命名',
        icon: createIcon(faPen),
        onSelect: () => {
          onAction('renameFileEntity');
        },
      },
      {
        key: 'delete-file-entity',
        label: '删除',
        icon: createIcon(faTrash),
        danger: true,
        onSelect: () => {
          onAction('deleteFileEntity');
        },
      },
    );
  }

  return items;
}

/**
 * @description 最近项目右键菜单
 *
 * 定位、视口碰撞、超高滚动、外部点击关闭、
 * 右键切换和键盘操作统一交给 BaseContextMenu。
 */
export default function RecentProjectContextMenu(props: RecentProjectContextMenuProps) {
  const { visible, x, y, type, payload, selectedItems, onClose, onAction } = props;

  if (!visible) {
    return null;
  }

  let items: BaseContextMenuItem[];

  if (selectedItems && selectedItems.length > 1) {
    // Multi-select menu
    const hasFiles = selectedItems.some((item) => !item.isFolder);
    const hasFolders = selectedItems.some((item) => item.isFolder);
    const count = selectedItems.length;

    items = [];

    if (hasFiles && !hasFolders) {
      // Files only
      items.push({
        key: 'multi-open-tabs',
        label: `在新标签页打开 (${count})`,
        icon: createIcon(faWindowRestore),
        onSelect: () => {
          onAction('openSelectedInTabs', JSON.stringify(selectedItems.map((s) => s.path)));
        },
      });
    }

    if (hasFolders && !hasFiles) {
      // Folders only
      items.push({
        key: 'multi-collapse',
        label: `折叠 (${count})`,
        icon: createIcon(faFolderMinus),
        onSelect: () => {
          onAction('collapseSelectedFolders', JSON.stringify(selectedItems.map((s) => s.path)));
        },
      });
    }

    items.push(createSeparator('multi-separator'));

    items.push({
      key: 'multi-delete',
      label: `删除 (${count})`,
      icon: createIcon(faTrash),
      danger: true,
      onSelect: () => {
        onAction('deleteSelectedItems', JSON.stringify(selectedItems.map((s) => ({ path: s.path, isFolder: s.isFolder }))));
      },
    });
  } else {
    items = type === 'top' ? createTopMenuItems(payload, onAction) : createSubMenuItems(payload, onAction);
  }

  if (items.length === 0) {
    return null;
  }

  return <BaseContextMenu open position={{ x, y }} showArrow items={items} minWidth={168} density="compact" onClose={onClose} />;
}
