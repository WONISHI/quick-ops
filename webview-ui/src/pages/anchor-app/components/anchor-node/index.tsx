import styles from '@pages/anchor-app/ccomponents/anchor-node/index.module.css';
import { Handle, Position } from '@xyflow/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLink } from '@fortawesome/free-solid-svg-icons';
import { colorList } from '@pages/anchor-app/src/constants';
import { getNodeRawData } from '@pages/anchor-app/src/flow';
import type { CSSProperties, MouseEvent } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { AnchorFlowNode } from '@pages/anchor-app/src/type';

/**
 * @description 自定义锚点节点
 */
export default function AnchorNode({ id, data }: NodeProps<AnchorFlowNode>) {
  const raw = getNodeRawData(data.treeData);
  const color = colorList[data.colorIndex];
  const isAnchor = !!raw;

  const handleMainClick = (event: MouseEvent): void => {
    event.stopPropagation();

    if (isAnchor && raw) {
      data.onJump(raw);
      return;
    }

    if (data.hasChildren) {
      data.onToggle(id);
    }
  };

  const handleToggleClick = (event: MouseEvent): void => {
    event.stopPropagation();

    if (data.hasChildren) {
      data.onToggle(id);
    }
  };

  const handleLinkClick = (event: MouseEvent): void => {
    event.stopPropagation();

    if (raw) {
      data.onJump(raw);
    }
  };

  return (
    <div
      className={`${styles.nodeCard} ${isAnchor ? styles.anchorNode : styles.groupNode}`}
      style={
        {
          '--node-color': color,
        } as CSSProperties
      }
    >
      <Handle type="target" position={Position.Left} className={styles.nodeHandle} />

      <button
        className={`${styles.nodeDot} ${data.hasChildren ? styles.expandableDot : ''}`}
        onClick={handleToggleClick}
        title={data.hasChildren ? (data.collapsed ? '展开' : '收起') : ''}
      >
        {data.hasChildren && <span className={styles.nodeBadge}>{data.collapsed ? data.childCount : ''}</span>}
      </button>

      <button className={styles.nodeLabel} onClick={handleMainClick} title={data.label}>
        {isAnchor && (
          <span className={styles.linkIcon}>
            <FontAwesomeIcon icon={faLink} />
          </span>
        )}

        <span className={styles.nodeText}>{data.label}</span>
      </button>

      {isAnchor && (
        <button className={styles.jumpBtn} onClick={handleLinkClick} title="跳转到代码">
          <FontAwesomeIcon icon={faLink} />
        </button>
      )}

      <Handle type="source" position={Position.Right} className={styles.nodeHandle} />
    </div>
  );
}
