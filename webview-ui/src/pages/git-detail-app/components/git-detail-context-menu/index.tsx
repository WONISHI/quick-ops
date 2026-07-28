import React from 'react';
import BaseContextMenu from '@components/BaseContextMenu';
import { vscode } from '@utils/vscode';
import { parseRemoteInfo } from '@utils/index';
import type { BaseContextMenuItem } from '@components/BaseContextMenu/src/type';
import type { GitDetailContextMenuProps } from '@pages/git-detail-app/components/git-detail-context-menu/src/type';

const GitDetailContextMenu: React.FC<GitDetailContextMenuProps> = ({ contextMenu, remoteUrl, onClose }) => {
  if (!contextMenu) {
    return null;
  }

  const { commit } = contextMenu;

  const items: BaseContextMenuItem[] = [
    {
      key: 'copy-commit-message',
      label: '复制提交信息',
      icon: <i className="codicon codicon-copy" />,
      onSelect: () => {
        vscode.postMessage({ command: 'copy', text: commit.message });
      },
    },
    {
      key: 'open-commit-changes',
      label: '打开更改',
      icon: <i className="codicon codicon-git-compare" />,
      onSelect: () => {
        vscode.postMessage({ command: 'openCommitMultiDiff', hash: commit.hash });
      },
    },
    {
      key: 'revert-commit',
      label: '回滚提交',
      icon: <i className="codicon codicon-discard" />,
      danger: true,
      onSelect: () => {
        vscode.postMessage({ command: 'revertCommit', hash: commit.hash });
      },
    },
  ];

  if (commit.type !== 'stash' && commit.type !== 'uncommitted') {
    const remoteInfo = parseRemoteInfo(remoteUrl, commit.hash);

    if (remoteInfo) {
      items.push({
        key: 'open-remote-commit',
        label: `在 ${remoteInfo.platform} 上打开`,
        icon: <i className="codicon codicon-globe" />,
        onSelect: () => {
          vscode.postMessage({ command: 'openExternal', url: remoteInfo.url });
        },
      });
    }
  }

  return (
    <BaseContextMenu
      open={contextMenu.visible}
      position={{ x: contextMenu.x, y: contextMenu.y }}
      showArrow
      items={items}
      minWidth={168}
      density="compact"
      onClose={onClose}
    />
  );
};

export default GitDetailContextMenu;
