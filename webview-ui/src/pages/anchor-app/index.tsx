import '@xyflow/react/dist/style.css';

import dagre from 'dagre';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from '@pages/anchor-app/index.module.css';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { vscode } from '@utils/vscode';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCompress, faExpand, faMinus, faPenToSquare, faPlus, faRotateRight, faTag, faTrash, faLink } from '@fortawesome/free-solid-svg-icons';
import { faFileCode as faFileCodeReg, faFolderOpen as faFolderOpenReg } from '@fortawesome/free-regular-svg-icons';
import type { NodeProps, NodeTypes } from '@xyflow/react';
import type { AnchorData, AnchorFlowEdge, AnchorFlowNode, AnchorFlowNodeData, TooltipState, TreeNodeData } from '@pages/anchor-app/src/type';

const NODE_WIDTH = 230;
const NODE_HEIGHT = 48;

const colorList = ['#4FC3F7', '#81C784', '#FFB74D', '#BA68C8', '#4DB6AC', '#E57373', '#7986CB', '#A1887F'];

/**
 * @description 获取节点绑定的锚点数据
 */
function getNodeRawData(node: TreeNodeData): AnchorData | undefined {
  return node.data;
}

/**
 * @description 生成 React Flow 节点 ID
 */
function getNodeId(node: TreeNodeData, path: string[]): string {
  const raw = getNodeRawData(node);

  if (raw?.id) {
    return `anchor:${raw.id}`;
  }

  return `group:${path.join('/') || 'root'}`;
}

/**
 * @description 获取节点显示名称
 */
function getNodeLabel(node: TreeNodeData): string {
  const raw = getNodeRawData(node);

  if (raw) {
    return raw.description || node.name || 'Anchor';
  }

  return node.name || 'Group';
}

/**
 * @description 根据一级分组生成颜色索引
 */
function getColorIndex(path: string[]): number {
  if (path.length <= 1) return 0;
  const key = path[1] || path[0] || 'root';
  let hash = 0;
  for (let index = 0; index < key.length; index++) {
    hash = (hash << 5) - hash + key.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash) % colorList.length;
}

/**
 * @description 将树形锚点数据转换成 React Flow nodes / edges
 */
function createFlowData(
  root: TreeNodeData | null,
  collapsedMap: Record<string, boolean>,
  handlers: Pick<AnchorFlowNodeData, 'onToggle' | 'onJump'>,
): {
  nodes: AnchorFlowNode[];
  edges: AnchorFlowEdge[];
} {
  if (!root) {
    return {
      nodes: [],
      edges: [],
    };
  }

  const nodes: AnchorFlowNode[] = [];
  const edges: AnchorFlowEdge[] = [];

  const walk = (node: TreeNodeData, path: string[], parentId?: string): void => {
    const nodeId = getNodeId(node, path);
    const children = node.children || [];
    const hasChildren = children.length > 0;
    const collapsed = !!collapsedMap[nodeId];
    const colorIndex = getColorIndex(path);

    nodes.push({
      id: nodeId,
      type: 'anchorNode',
      position: {
        x: 0,
        y: 0,
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        treeData: node,
        label: getNodeLabel(node),
        hasChildren,
        childCount: children.length,
        collapsed,
        colorIndex,
        ...handlers,
      },
    });

    if (parentId) {
      edges.push({
        id: `${parentId}->${nodeId}`,
        source: parentId,
        target: nodeId,
        type: 'smoothstep',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
        },
        style: {
          strokeWidth: 1.5,
          stroke: colorList[colorIndex],
        },
      });
    }

    if (!collapsed) {
      children.forEach((child, index) => {
        walk(child, [...path, `${child.name || 'node'}-${index}`], nodeId);
      });
    }
  };

  walk(root, [root.name || 'root']);

  return layoutFlow(nodes, edges);
}

/**
 * @description 使用 dagre 自动计算思维导图布局
 */
function layoutFlow(
  nodes: AnchorFlowNode[],
  edges: AnchorFlowEdge[],
): {
  nodes: AnchorFlowNode[];
  edges: AnchorFlowEdge[];
} {
  const graph = new dagre.graphlib.Graph();

  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: 'LR',
    nodesep: 34,
    ranksep: 110,
    marginx: 40,
    marginy: 40,
  });

  nodes.forEach((node) => {
    graph.setNode(node.id, {
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  });

  edges.forEach((edge) => {
    graph.setEdge(edge.source, edge.target);
  });

  dagre.layout(graph);

  return {
    nodes: nodes.map((node) => {
      const layoutNode = graph.node(node.id);

      return {
        ...node,
        position: {
          x: layoutNode.x - NODE_WIDTH / 2,
          y: layoutNode.y - NODE_HEIGHT / 2,
        },
      };
    }),
    edges,
  };
}

/**
 * @description 自定义锚点节点
 */
const AnchorNode = ({ id, data }: NodeProps<AnchorFlowNode>) => {
  const raw = getNodeRawData(data.treeData);
  const color = colorList[data.colorIndex];
  const isAnchor = !!raw;

  const handleMainClick = (event: React.MouseEvent): void => {
    event.stopPropagation();
    if (isAnchor && raw) {
      data.onJump(raw);
      return;
    }
    if (data.hasChildren) {
      data.onToggle(id);
    }
  };
  const handleToggleClick = (event: React.MouseEvent): void => {
    event.stopPropagation();
    if (data.hasChildren) {
      data.onToggle(id);
    }
  };
  const handleLinkClick = (event: React.MouseEvent): void => {
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
        } as React.CSSProperties
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
};

const nodeTypes = {
  anchorNode: AnchorNode,
} as NodeTypes;

function AnchorAppInner() {
  const { fitView, zoomIn, zoomOut } = useReactFlow<AnchorFlowNode, AnchorFlowEdge>();

  const [mindMapData, setMindMapData] = useState<TreeNodeData | null>(null);
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    data: null,
  });

  const tooltipTimerRef = useRef<number | undefined>(undefined);

  const clearTooltipTimer = useCallback((): void => {
    if (tooltipTimerRef.current) {
      window.clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = undefined;
    }
  }, []);

  const handleToggle = useCallback((nodeId: string): void => {
    setCollapsedMap((prev) => ({
      ...prev,
      [nodeId]: !prev[nodeId],
    }));
  }, []);

  const handleJump = useCallback((data: AnchorData): void => {
    vscode?.postMessage({
      command: 'jump',
      data,
    });
  }, []);

  const handleHideTooltip = useCallback((): void => {
    clearTooltipTimer();

    tooltipTimerRef.current = window.setTimeout(() => {
      setTooltip((prev) => ({
        ...prev,
        visible: false,
      }));
    }, 220);
  }, [clearTooltipTimer]);

  const flowData = useMemo(() => {
    return createFlowData(mindMapData, collapsedMap, {
      onToggle: handleToggle,
      onJump: handleJump,
    });
  }, [mindMapData, collapsedMap, handleToggle, handleJump]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent): void => {
      const message = event.data;

      if (message.command === 'refresh' && message.data) {
        setTooltip((prev) => ({
          ...prev,
          visible: false,
        }));
        setMindMapData(message.data);
      }
    };

    window.addEventListener('message', handleMessage);

    vscode?.postMessage({
      command: 'ready',
    });

    return () => {
      window.removeEventListener('message', handleMessage);
      clearTooltipTimer();
    };
  }, [clearTooltipTimer]);

  useEffect(() => {
    if (flowData.nodes.length === 0) return;

    const timer = window.setTimeout(() => {
      fitView({
        padding: 0.18,
        duration: 350,
      });
    }, 60);

    return () => {
      window.clearTimeout(timer);
    };
  }, [flowData.nodes.length, fitView]);

  const handleRefresh = (): void => {
    vscode?.postMessage({
      command: 'refresh',
    });
  };

  const handleFullscreen = (): void => {
    vscode?.postMessage({
      command: 'toggleFullscreen',
    });

    setIsFullscreen((prev) => !prev);
  };

  const handleFitView = (): void => {
    fitView({
      padding: 0.18,
      duration: 350,
    });
  };

  const handleAnchorAction = (action: 'edit' | 'delete'): void => {
    if (!tooltip.data?.id) return;

    vscode?.postMessage({
      command: 'anchorAction',
      action,
      anchorId: tooltip.data.id,
    });

    setTooltip((prev) => ({
      ...prev,
      visible: false,
    }));
  };

  const handleNodeMouseEnter = useCallback(
    (event: React.MouseEvent, node: AnchorFlowNode): void => {
      const raw = getNodeRawData(node.data.treeData);

      if (!raw) return;

      clearTooltipTimer();

      setTooltip({
        visible: true,
        x: event.clientX + 18,
        y: event.clientY + 12,
        data: raw,
      });
    },
    [clearTooltipTimer],
  );

  const handleNodeMouseMove = useCallback(
    (event: React.MouseEvent, node: AnchorFlowNode): void => {
      const raw = getNodeRawData(node.data.treeData);

      if (!raw) return;

      clearTooltipTimer();

      setTooltip({
        visible: true,
        x: event.clientX + 18,
        y: event.clientY + 12,
        data: raw,
      });
    },
    [clearTooltipTimer],
  );

  const handleNodeMouseLeave = useCallback((): void => {
    handleHideTooltip();
  }, [handleHideTooltip]);

  const handleTooltipMouseEnter = (): void => {
    clearTooltipTimer();
  };

  const handleTooltipMouseLeave = (): void => {
    handleHideTooltip();
  };

  const fileName = tooltip.data?.filePath ? tooltip.data.filePath.split(/[\\/]/).pop() || tooltip.data.filePath : 'Unknown File';

  return (
    <div className={styles.appWrapper}>
      <div className={styles.topControls}>
        <button className={styles.iconBtn} onClick={handleFullscreen} title={isFullscreen ? '恢复默认布局' : '切换编辑器最大化'}>
          <FontAwesomeIcon icon={isFullscreen ? faCompress : faExpand} />
        </button>

        <button className={styles.iconBtn} onClick={handleRefresh} title="刷新导图">
          <FontAwesomeIcon icon={faRotateRight} />
        </button>
      </div>

      <div className={styles.bottomControls}>
        <button className={styles.iconBtn} onClick={() => zoomOut({ duration: 200 })} title="缩小">
          <FontAwesomeIcon icon={faMinus} />
        </button>

        <button className={styles.iconBtn} onClick={handleFitView} title="适应视口">
          <FontAwesomeIcon icon={faExpand} />
        </button>

        <button className={styles.iconBtn} onClick={() => zoomIn({ duration: 200 })} title="放大">
          <FontAwesomeIcon icon={faPlus} />
        </button>
      </div>

      <ReactFlow<AnchorFlowNode, AnchorFlowEdge>
        className={styles.treeContainer}
        nodes={flowData.nodes}
        edges={flowData.edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        maxZoom={4}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseMove={handleNodeMouseMove}
        onNodeMouseLeave={handleNodeMouseLeave}
        proOptions={{
          hideAttribution: true,
        }}
      >
        <Background gap={18} size={1} />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>

      {flowData.nodes.length === 0 && <div className={styles.empty}>暂无锚点数据</div>}

      {tooltip.visible && tooltip.data && (
        <div
          className={styles.tooltip}
          style={{
            left: tooltip.x,
            top: tooltip.y,
          }}
          onMouseEnter={handleTooltipMouseEnter}
          onMouseLeave={handleTooltipMouseLeave}
        >
          <div className={styles.tooltipHeader}>
            <FontAwesomeIcon icon={faTag} />
            <span>{tooltip.data.description || 'Anchor Point'}</span>
          </div>

          <div className={styles.tooltipBody}>
            <div className={styles.tooltipRow}>
              <FontAwesomeIcon icon={faFolderOpenReg} />
              <span className={styles.tooltipVal}>{tooltip.data.group || 'Default'}</span>
            </div>

            <div className={styles.tooltipRow}>
              <FontAwesomeIcon icon={faFileCodeReg} />
              <span className={styles.tooltipVal}>
                {fileName} : {tooltip.data.line || '?'}
              </span>
            </div>

            {tooltip.data.content && <pre className={styles.codeBlock}>{tooltip.data.content.trim()}</pre>}
          </div>

          <div className={styles.tooltipActions}>
            <button className={styles.tooltipBtn} onClick={() => handleAnchorAction('edit')}>
              <FontAwesomeIcon icon={faPenToSquare} />
              编辑
            </button>

            <button className={`${styles.tooltipBtn} ${styles.danger}`} onClick={() => handleAnchorAction('delete')}>
              <FontAwesomeIcon icon={faTrash} />
              删除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AnchorApp() {
  return (
    <ReactFlowProvider>
      <AnchorAppInner />
    </ReactFlowProvider>
  );
}
