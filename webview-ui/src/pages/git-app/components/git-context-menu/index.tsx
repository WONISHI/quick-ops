import BaseContextMenu from '@components/BaseContextMenu';
import { vscode } from '@utils/vscode';
import type { BaseContextMenuItem } from '@components/BaseContextMenu';
import type { GitContextMenuProps, ContextMenuState } from '@pages/git-app/components/git-context-menu/src/type';

function createIcon(icon: string) {
  return <i className={`codicon ${icon}`} />;
}

function copyFileName(filePath: string): void {
  const fileName = filePath.split(/[\\/]/).pop() || filePath;

  vscode.postMessage({
    command: 'copy',
    text: fileName,
  });
}

function createCommitItems(contextMenu: ContextMenuState): BaseContextMenuItem[] {
  const commit = contextMenu.commit;

  if (!commit) {
    return [];
  }

  return [
    {
      key: 'copy-commit-message',
      label: '复制提交信息',
      icon: createIcon('codicon-copy'),
      onSelect: () => {
        vscode.postMessage({
          command: 'copy',
          text: commit.message,
        });
      },
    },
    {
      key: 'open-commit-changes',
      label: '打开更改',
      icon: createIcon('codicon-git-compare'),
      onSelect: () => {
        vscode.postMessage({
          command: 'openCommitMultiDiff',
          hash: commit.hash,
        });
      },
    },
  ];
}

function createUnstagedItems(contextMenu: ContextMenuState): BaseContextMenuItem[] {
  const file = contextMenu.file;

  if (!file) {
    return [];
  }

  return [
    {
      key: 'open-working-change',
      label: '打开更改',
      icon: createIcon('codicon-git-compare'),
      onSelect: () => {
        vscode.postMessage({
          command: 'diff',
          file: file.file,
          status: file.status,
        });
      },
    },
    {
      key: 'open-working-file',
      label: '打开文件',
      icon: createIcon('codicon-go-to-file'),
      onSelect: () => {
        vscode.postMessage({
          command: 'open',
          file: file.file,
        });
      },
    },
    {
      key: 'copy-working-file-name',
      label: '复制文件名称',
      icon: createIcon('codicon-copy'),
      onSelect: () => {
        copyFileName(file.file);
      },
    },
    {
      type: 'separator',
      key: 'working-file-separator-1',
    },
    {
      key: 'delete-working-file',
      label: '删除文件',
      icon: createIcon('codicon-trash'),
      danger: true,
      onSelect: () => {
        vscode.postMessage({
          command: 'deleteWorkingFile',
          file: file.file,
          status: file.status,
        });
      },
    },
    {
      key: 'discard-working-change',
      label: '放弃更改',
      icon: createIcon('codicon-discard'),
      danger: true,
      onSelect: () => {
        vscode.postMessage({
          command: 'discard',
          file: file.file,
          status: file.status,
        });
      },
    },
    {
      key: 'stage-working-change',
      label: '暂存更改',
      icon: createIcon('codicon-plus'),
      onSelect: () => {
        vscode.postMessage({
          command: 'stage',
          file: file.file,
          status: file.status,
        });
      },
    },
    {
      type: 'separator',
      key: 'working-file-separator-2',
    },
    {
      key: 'ignore-working-file',
      label: '添加到 .gitignore',
      icon: createIcon('codicon-eye-closed'),
      onSelect: () => {
        vscode.postMessage({
          command: 'ignore',
          file: file.file,
        });
      },
    },
    {
      key: 'reveal-working-file',
      label: '在访达/资源管理器中显示',
      icon: createIcon('codicon-folder-opened'),
      onSelect: () => {
        vscode.postMessage({
          command: 'reveal',
          file: file.file,
        });
      },
    },
  ];
}

function createStagedItems(contextMenu: ContextMenuState): BaseContextMenuItem[] {
  const file = contextMenu.file;

  if (!file) {
    return [];
  }

  return [
    {
      key: 'open-staged-change',
      label: '打开更改',
      icon: createIcon('codicon-git-compare'),
      onSelect: () => {
        vscode.postMessage({
          command: 'diff',
          file: file.file,
          status: file.status,
        });
      },
    },
    {
      key: 'open-staged-file',
      label: '打开文件',
      icon: createIcon('codicon-go-to-file'),
      onSelect: () => {
        vscode.postMessage({
          command: 'open',
          file: file.file,
        });
      },
    },
    {
      key: 'copy-staged-file-name',
      label: '复制文件名称',
      icon: createIcon('codicon-copy'),
      onSelect: () => {
        copyFileName(file.file);
      },
    },
    {
      type: 'separator',
      key: 'staged-file-separator-1',
    },
    {
      key: 'unstage-file',
      label: '取消暂存更改',
      icon: createIcon('codicon-remove'),
      onSelect: () => {
        vscode.postMessage({
          command: 'unstage',
          file: file.file,
        });
      },
    },
    {
      type: 'separator',
      key: 'staged-file-separator-2',
    },
    {
      key: 'reveal-staged-file',
      label: '在访达/资源管理器中显示',
      icon: createIcon('codicon-folder-opened'),
      onSelect: () => {
        vscode.postMessage({
          command: 'reveal',
          file: file.file,
        });
      },
    },
  ];
}

function createStashFileItems(contextMenu: ContextMenuState): BaseContextMenuItem[] {
  const file = contextMenu.file;

  if (!file) {
    return [];
  }

  return [
    {
      key: 'open-stash-change',
      label: '打开更改',
      icon: createIcon('codicon-git-compare'),
      onSelect: () => {
        vscode.postMessage({
          command: 'diff',
          file: file.file,
          status: file.status,
        });
      },
    },
    {
      key: 'open-stash-file',
      label: '打开文件',
      icon: createIcon('codicon-go-to-file'),
      onSelect: () => {
        vscode.postMessage({
          command: 'open',
          file: file.file,
        });
      },
    },
    {
      key: 'copy-stash-file-name',
      label: '复制文件名称',
      icon: createIcon('codicon-copy'),
      onSelect: () => {
        copyFileName(file.file);
      },
    },
  ];
}



function createHistoryItems(contextMenu: ContextMenuState): BaseContextMenuItem[] {
  const file = contextMenu.file;

  if (!file) {
    return [];
  }

  const items: BaseContextMenuItem[] = [
    {
      key: 'open-history-file',
      label: '打开文件',
      icon: createIcon('codicon-go-to-file'),
      onSelect: () => {
        vscode.postMessage({
          command: 'open',
          file: file.file,
        });
      },
    },
  ];

  if (contextMenu.listType === 'history' && contextMenu.historyHash) {
    items.push({
      key: 'compare-history-with-local',
      label: '与本地分支比较',
      icon: createIcon('codicon-git-compare'),
      onSelect: () => {
        vscode.postMessage({
          command: 'diffCommitFileWithLocalBranch',
          file: file.file,
          status: file.status,
          hash: contextMenu.historyHash,
        });
      },
    });
  }

  return items;
}

function createContextMenuItems(contextMenu: ContextMenuState): BaseContextMenuItem[] {
  if (contextMenu.type === 'commit') {
    return createCommitItems(contextMenu);
  }

  if (contextMenu.type !== 'file') {
    return [];
  }

  switch (contextMenu.listType) {
    case 'unstaged':
      return createUnstagedItems(contextMenu);

    case 'staged':
      return createStagedItems(contextMenu);

    case 'stash-file':
      return createStashFileItems(contextMenu);

    case 'history':
    case 'compare':
      return createHistoryItems(contextMenu);

    default:
      return [];
  }
}

/**
 * @description Git 专属右键菜单
 *
 * 菜单定位、视口碰撞、遮罩关闭、
 * Escape 关闭、键盘操作及样式统一交给
 * BaseContextMenu 处理。
 */
export const GitContextMenu: React.FC<GitContextMenuProps> = ({ contextMenu, onClose }) => {
  if (!contextMenu || !contextMenu.visible) {
    return null;
  }

  const items = createContextMenuItems(contextMenu);

  if (items.length === 0) {
    return null;
  }

  return (
    <BaseContextMenu
      open
      position={{
        x: contextMenu.x,
        y: contextMenu.y,
      }}
      showArrow
      items={items}
      minWidth={168}
      density="compact"
      onClose={onClose}
    />
  );
};
