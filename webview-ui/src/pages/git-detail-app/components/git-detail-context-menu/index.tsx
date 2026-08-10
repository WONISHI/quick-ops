import React from 'react';
import BaseContextMenu from '@components/BaseContextMenu';
import { vscode } from '@utils/vscode';
import { parseRemoteInfo } from '@utils/index';
import type { BaseContextMenuItem } from '@components/BaseContextMenu/src/type';
import type { GitFileItem, GraphCommit } from '@pages/git-detail-app/src/type';

interface GitDetailContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  commit: GraphCommit;
  file?: GitFileItem;
  parentHash?: string;
}

interface GitDetailContextMenuProps {
  contextMenu: GitDetailContextMenuState | null;
  remoteUrl: string;
  onClose: () => void;
}

const GitDetailContextMenu: React.FC<GitDetailContextMenuProps> = ({ contextMenu, remoteUrl, onClose }) => {
  if (!contextMenu) {
    return null;
  }

  const { commit, file, parentHash } = contextMenu;

  if (file) {
    const fileItems: BaseContextMenuItem[] = [
      {
        key: 'open-commit-file-change',
        label: '打开更改',
        icon: <i className="codicon codicon-git-compare" />,
        onSelect: () => {
          vscode.postMessage({
            command: 'openGitDetailCommitFileDiff',
            hash: commit.hash,
            parentHash,
            file: file.file,
            status: file.status,
          });
        },
      },
    ];

    if (commit.type !== 'stash' && commit.type !== 'uncommitted') {
      fileItems.push(
        {
          type: 'separator',
          key: 'restore-file-from-commit-separator',
        },
        {
          key: 'restore-file-from-commit',
          label: '恢复此文件',
          icon: <i className="codicon codicon-history" />,
          onSelect: () => {
            vscode.postMessage({
              command: 'restoreFileFromCommit',
              hash: commit.hash,
              file: file.file,
            });
          },
        },
      );
    }

    return (
      <BaseContextMenu
        open={contextMenu.visible}
        showArrow
        position={{ x: contextMenu.x, y: contextMenu.y }}
        items={fileItems}
        minWidth={168}
        density="compact"
        onClose={onClose}
      />
    );
  }

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
  ];

  if (commit.type !== 'stash' && commit.type !== 'uncommitted') {
    items.push(
      {
        type: 'separator',
        key: 'cherry-pick-commit-separator',
      },
      {
        key: 'cherry-pick-commit',
        label: '摘取此提交',
        icon: <i className="codicon codicon-git-commit" />,
        onSelect: () => {
          vscode.postMessage({ command: 'cherryPickCommit', hash: commit.hash });
        },
      },
    );

    items.push(
      {
        type: 'separator',
        key: 'revert-commit-separator',
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
    );

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
    <BaseContextMenu open={contextMenu.visible} showArrow position={{ x: contextMenu.x, y: contextMenu.y }} items={items} minWidth={168} density="compact" onClose={onClose} />
  );
};

export default GitDetailContextMenu;
