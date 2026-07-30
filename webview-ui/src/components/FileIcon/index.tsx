import React, { useMemo } from 'react';

import { getFileIconUrl } from '@components/FileIcon/src/file-icon';
import { getFolderIconUrl } from '@components/FileIcon/src/folder-icon';
import type { FileIconProps } from '@components/FileIcon/src/type';

export const FileIcon: React.FC<FileIconProps> = ({ fileName, isFolder = false, isExpanded = false, className, style, status }) => {
  const finalUrl = useMemo(() => {
    return isFolder ? getFolderIconUrl(fileName, isExpanded) : getFileIconUrl(fileName);
  }, [fileName, isFolder, isExpanded]);

  return (
    <img
      src={finalUrl}
      alt={isFolder ? 'folder icon' : 'file icon'}
      className={className}
      data-status={status || undefined}
      title={status ? `状态: ${status}` : undefined}
      style={{
        width: '16px',
        height: '16px',
        objectFit: 'contain',
        display: 'inline-block',
        verticalAlign: 'middle',
        ...style,
      }}
    />
  );
};

export default FileIcon;