import styles from '@pages/anchor-app/components/anchor-app-inner/index.module.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyNodeChanges, Background, BezierEdge, Controls, ReactFlow, useReactFlow } from '@xyflow/react';
import { vscode } from '@utils/vscode';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCompress, faExpand, faPenToSquare, faRotateRight, faTag, faTrash } from '@fortawesome/free-solid-svg-icons';
import { faFileCode as faFileCodeReg, faFolderOpen as faFolderOpenReg } from '@fortawesome/free-regular-svg-icons';
import AnchorNode from '@pages/anchor-app/components/anchor-node';
import { createFlowData, getNodeRawData } from '@pages/anchor-app/src/flow';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { NodeChange, NodeTypes, OnNodeDrag } from '@xyflow/react';
import type { AnchorData, AnchorFlowEdge, AnchorFlowNode, TooltipState, TreeNodeData } from '@pages/anchor-app/src/type';

const nodeTypes = {
  anchorNode: AnchorNode,
} as NodeTypes;

type NodePositionMap = Record<string, { x: number; y: number }>;

export default function AnchorAppInner() {
  const { fitView } = useReactFlow<AnchorFlowNode, AnchorFlowEdge>();

  const [mindMapData, setMindMapData] = useState<TreeNodeData | null>(null);
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
  const [nodePositionMap, setNodePositionMap] = useState<NodePositionMap>({});
  const [nodes, setNodes] = useState<AnchorFlowNode[]>([]);
  const [edges, setEdges] = useState<AnchorFlowEdge[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  /**
   * @description 首次加载 / 手动刷新时先隐藏画布
   *
   * 原因：
   * ReactFlow 会先按默认 viewport 渲染一次，
   * 然后 fitView 再把画布移动到中心。
   * 如果不隐藏，就会看到“从顶部掉到中心”的效果。
   */
  const [isFlowReady, setIsFlowReady] = useState(false);

  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    data: null,
  });

  const tooltipTimerRef = useRef<number | undefined>(undefined);
  const fitViewTimerRef = useRef<number | undefined>(undefined);
  const syncFlowRafRef = useRef<number | undefined>(undefined);
  const nodesChangeRafRef = useRef<number | undefined>(undefined);
  const pendingNodeChangesRef = useRef<NodeChange<AnchorFlowNode>[]>([]);
  const nodesRef = useRef<AnchorFlowNode[]>([]);
  const isNodeDraggingRef = useRef(false);

  /**
   * @description 是否需要执行 fitView
   *
   * 只有首次加载 / 手动刷新数据时才需要。
   * 展开 / 收起节点时不要 fitView，
   * 否则会出现画布自动放大 / 缩小。
   */
  const shouldFitViewRef = useRef(true);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const clearTooltipTimer = useCallback((): void => {
    if (tooltipTimerRef.current) {
      window.clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = undefined;
    }
  }, []);

  const clearFitViewTimer = useCallback((): void => {
    if (fitViewTimerRef.current) {
      window.clearTimeout(fitViewTimerRef.current);
      fitViewTimerRef.current = undefined;
    }
  }, []);

  const clearSyncFlowRaf = useCallback((): void => {
    if (syncFlowRafRef.current) {
      window.cancelAnimationFrame(syncFlowRafRef.current);
      syncFlowRafRef.current = undefined;
    }
  }, []);

  const clearNodesChangeRaf = useCallback((): void => {
    if (nodesChangeRafRef.current) {
      window.cancelAnimationFrame(nodesChangeRafRef.current);
      nodesChangeRafRef.current = undefined;
    }

    pendingNodeChangesRef.current = [];
  }, []);

  /**
   * @description 展开 / 收起节点
   *
   * 注意：
   * 这里不要把 shouldFitViewRef.current 改成 true。
   * 否则收起节点时会重新 fitView，画布会自动放大。
   */
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

  /**
   * @description 根据 VSCode 侧传入的数据生成 React Flow 数据
   *
   * createFlowData 内部会使用 dagre 自动布局。
   */
  const flowData = useMemo(() => {
    return createFlowData(mindMapData, collapsedMap, {
      onToggle: handleToggle,
      onJump: handleJump,
    });
  }, [mindMapData, collapsedMap, handleToggle, handleJump]);

  /**
   * @description 合并自动布局位置和用户拖拽位置
   */
  const mergedNodes = useMemo(() => {
    return flowData.nodes.map((node) => {
      const position = nodePositionMap[node.id];

      if (!position) {
        return node;
      }

      return {
        ...node,
        position,
      };
    });
  }, [flowData.nodes, nodePositionMap]);

  /**
   * @description 同步 React Flow nodes / edges
   *
   * 不在 effect 主体里直接 setState，
   * 而是放到 requestAnimationFrame 中，避免 React lint 提示：
   * Calling setState synchronously within an effect can trigger cascading renders
   */
  useEffect(() => {
    clearSyncFlowRaf();

    syncFlowRafRef.current = window.requestAnimationFrame(() => {
      setNodes(mergedNodes);
      setEdges(flowData.edges);
      nodesRef.current = mergedNodes;
      syncFlowRafRef.current = undefined;

      if (mergedNodes.length === 0) {
        setIsFlowReady(true);
        return;
      }

      /**
       * 只有首次加载 / 手动刷新时执行 fitView。
       * 展开 / 收起节点不会触发这里的 fitView。
       */
      if (shouldFitViewRef.current) {
        clearFitViewTimer();

        fitViewTimerRef.current = window.setTimeout(() => {
          fitView({
            padding: 0.18,
            duration: 0,
          });

          shouldFitViewRef.current = false;
          setIsFlowReady(true);
        }, 0);

        return;
      }

      setIsFlowReady(true);
    });

    return () => {
      clearSyncFlowRaf();
    };
  }, [clearFitViewTimer, clearSyncFlowRaf, fitView, flowData.edges, mergedNodes]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent): void => {
      const message = event.data;

      if (message.command === 'refresh' && message.data) {
        clearTooltipTimer();

        setTooltip((prev) => ({
          ...prev,
          visible: false,
        }));

        /**
         * VSCode 侧刷新数据时，重新隐藏画布，
         * 等 fitView 完成后再显示，避免顶部闪一下。
         */
        shouldFitViewRef.current = true;
        setIsFlowReady(false);
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
      clearFitViewTimer();
      clearSyncFlowRaf();
      clearNodesChangeRaf();
    };
  }, [clearFitViewTimer, clearNodesChangeRaf, clearSyncFlowRaf, clearTooltipTimer]);

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

  /**
   * @description 节点变化
   *
   * 拖拽过程中实时更新 nodes，
   * 但是用 requestAnimationFrame 合并高频变化，
   * 避免 Webview 拖动时白屏。
   */
  const handleNodesChange = useCallback((changes: NodeChange<AnchorFlowNode>[]): void => {
    pendingNodeChangesRef.current.push(...changes);

    if (nodesChangeRafRef.current) return;

    nodesChangeRafRef.current = window.requestAnimationFrame(() => {
      const pendingChanges = pendingNodeChangesRef.current;

      pendingNodeChangesRef.current = [];
      nodesChangeRafRef.current = undefined;

      if (pendingChanges.length === 0) return;

      setNodes((currentNodes) => {
        const nextNodes = applyNodeChanges(pendingChanges, currentNodes) as AnchorFlowNode[];

        nodesRef.current = nextNodes;

        return nextNodes;
      });
    });
  }, []);

  const handleNodeMouseEnter = useCallback(
    (event: ReactMouseEvent, node: AnchorFlowNode): void => {
      if (isNodeDraggingRef.current) return;

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
    (event: ReactMouseEvent, node: AnchorFlowNode): void => {
      if (isNodeDraggingRef.current) return;

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
    if (isNodeDraggingRef.current) return;

    handleHideTooltip();
  }, [handleHideTooltip]);

  const handleNodeDragStart = useCallback<OnNodeDrag<AnchorFlowNode>>((): void => {
    isNodeDraggingRef.current = true;

    clearTooltipTimer();

    setTooltip((prev) => ({
      ...prev,
      visible: false,
    }));
  }, [clearTooltipTimer]);

  /**
   * @description 拖拽结束后保存最终位置
   *
   * 拖拽过程中只更新 nodes。
   * 松手后才把最终位置保存到 nodePositionMap，
   * 这样后续展开 / 收起 / 刷新布局时可以保留用户拖过的位置。
   */
  const handleNodeDragStop = useCallback<OnNodeDrag<AnchorFlowNode>>((_event, node): void => {
    isNodeDraggingRef.current = false;

    const latestNode = nodesRef.current.find((item) => item.id === node.id) || node;
    const nextPosition = latestNode.position;

    setNodePositionMap((prev) => {
      const oldPosition = prev[node.id];

      if (oldPosition?.x === nextPosition.x && oldPosition?.y === nextPosition.y) {
        return prev;
      }

      return {
        ...prev,
        [node.id]: {
          x: nextPosition.x,
          y: nextPosition.y,
        },
      };
    });
  }, []);

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

      <div
        style={{
          width: '100%',
          height: '100%',
          opacity: isFlowReady ? 1 : 0,
          transition: isFlowReady ? 'opacity 0.12s ease' : 'none',
        }}
      >
        <ReactFlow<AnchorFlowNode, AnchorFlowEdge>
          className={styles.treeContainer}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          minZoom={0.1}
          maxZoom={4}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          zoomOnDoubleClick={false}
          onNodesChange={handleNodesChange}
          onNodeDragStart={handleNodeDragStart}
          onNodeDragStop={handleNodeDragStop}
          edgeTypes={{
            default: BezierEdge,
          }}
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
      </div>

      {isFlowReady && nodes.length === 0 && <div className={styles.empty}>暂无锚点数据</div>}

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