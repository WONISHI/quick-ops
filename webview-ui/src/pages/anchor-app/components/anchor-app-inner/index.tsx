import styles from '@pages/anchor-app/components/anchor-app-inner/index.module.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyNodeChanges, Background, BezierEdge, Controls, ReactFlow, useReactFlow } from '@xyflow/react';
import { vscode } from '@utils/vscode';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPenToSquare, faRotateRight, faTag, faTrash } from '@fortawesome/free-solid-svg-icons';
import { faFileCode as faFileCodeReg, faFolderOpen as faFolderOpenReg } from '@fortawesome/free-regular-svg-icons';
import AnchorNode from '@pages/anchor-app/components/anchor-node';
import Popover from '@components/Popover';
import { createFlowData, getNodeRawData } from '@pages/anchor-app/src/flow';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { NodeChange, NodeTypes, OnNodeDrag } from '@xyflow/react';
import type { AnchorData, AnchorFlowEdge, AnchorFlowNode, TooltipState, TreeNodeData } from '@pages/anchor-app/src/type';

const nodeTypes = {
  anchorNode: AnchorNode,
} as NodeTypes;

type NodePositionMap = Record<
  string,
  {
    x: number;
    y: number;
  }
>;

type AnchorDetailState = Pick<TooltipState, 'visible' | 'data'>;

export default function AnchorAppInner() {
  const { fitView } = useReactFlow<AnchorFlowNode, AnchorFlowEdge>();

  const [mindMapData, setMindMapData] = useState<TreeNodeData | null>(null);

  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});

  const [nodePositionMap, setNodePositionMap] = useState<NodePositionMap>({});

  const [nodes, setNodes] = useState<AnchorFlowNode[]>([]);

  const [edges, setEdges] = useState<AnchorFlowEdge[]>([]);

  /**
   * @description 首次加载 / 手动刷新时先隐藏画布
   *
   * ReactFlow 会先按默认 viewport 渲染一次，
   * 然后 fitView 再把画布移动到中心。
   * 如果不隐藏，就会看到从顶部移动到中心的效果。
   */
  const [isFlowReady, setIsFlowReady] = useState(false);

  /**
   * @description 锚点详情弹层状态
   *
   * Popover 已经根据 anchorEl 自动定位，
   * 因此不再保存 x、y 坐标。
   */
  const [tooltip, setTooltip] = useState<AnchorDetailState>({
    visible: false,
    data: null,
  });

  /**
   * @description 当前 Popover 的定位参考元素
   */
  const [tooltipAnchor, setTooltipAnchor] = useState<HTMLElement | null>(null);

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

  /**
   * @description 清理锚点详情隐藏定时器
   */
  const clearTooltipTimer = useCallback((): void => {
    if (tooltipTimerRef.current !== undefined) {
      window.clearTimeout(tooltipTimerRef.current);

      tooltipTimerRef.current = undefined;
    }
  }, []);

  /**
   * @description 清理 fitView 定时器
   */
  const clearFitViewTimer = useCallback((): void => {
    if (fitViewTimerRef.current !== undefined) {
      window.clearTimeout(fitViewTimerRef.current);

      fitViewTimerRef.current = undefined;
    }
  }, []);

  /**
   * @description 清理同步 Flow 数据的动画帧
   */
  const clearSyncFlowRaf = useCallback((): void => {
    if (syncFlowRafRef.current !== undefined) {
      window.cancelAnimationFrame(syncFlowRafRef.current);

      syncFlowRafRef.current = undefined;
    }
  }, []);

  /**
   * @description 清理节点变化动画帧
   */
  const clearNodesChangeRaf = useCallback((): void => {
    if (nodesChangeRafRef.current !== undefined) {
      window.cancelAnimationFrame(nodesChangeRafRef.current);

      nodesChangeRafRef.current = undefined;
    }

    pendingNodeChangesRef.current = [];
  }, []);

  /**
   * @description 展开 / 收起节点
   *
   * 这里不要把 shouldFitViewRef.current 改成 true。
   * 否则收起节点时会重新 fitView，画布会自动放大。
   */
  const handleToggle = useCallback((nodeId: string): void => {
    setCollapsedMap((prev) => ({
      ...prev,
      [nodeId]: !prev[nodeId],
    }));
  }, []);

  /**
   * @description 跳转到锚点所在文件
   */
  const handleJump = useCallback((data: AnchorData): void => {
    vscode?.postMessage({
      command: 'jump',
      data,
    });
  }, []);

  /**
   * @description 延迟隐藏锚点详情
   *
   * 保留少量延迟，让鼠标可以从节点移动到 Popover。
   */
  const handleHideTooltip = useCallback((): void => {
    clearTooltipTimer();

    tooltipTimerRef.current = window.setTimeout(() => {
      setTooltip((prev) => ({
        ...prev,
        visible: false,
      }));

      setTooltipAnchor(null);
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
  }, [collapsedMap, handleJump, handleToggle, mindMapData]);

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
   * 不在 Effect 主体里直接 setState，
   * 而是放到 requestAnimationFrame 中，避免：
   * Calling setState synchronously within an effect
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

  /**
   * @description 监听 VSCode Webview 消息
   */
  useEffect(() => {
    const handleMessage = (event: MessageEvent): void => {
      const message = event.data;

      if (message.command === 'refresh' && message.data) {
        clearTooltipTimer();

        setTooltip((prev) => ({
          ...prev,
          visible: false,
        }));

        setTooltipAnchor(null);

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

  /**
   * @description 手动刷新导图
   */
  const handleRefresh = (): void => {
    vscode?.postMessage({
      command: 'refresh',
    });
  };

  /**
   * @description 锚点详情操作
   */
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

    setTooltipAnchor(null);
  };

  /**
   * @description 节点变化
   *
   * 拖拽过程中实时更新 nodes，
   * 但是使用 requestAnimationFrame 合并高频变化，
   * 避免 Webview 拖动时白屏。
   */
  const handleNodesChange = useCallback((changes: NodeChange<AnchorFlowNode>[]): void => {
    pendingNodeChangesRef.current.push(...changes);

    if (nodesChangeRafRef.current !== undefined) {
      return;
    }

    nodesChangeRafRef.current = window.requestAnimationFrame(() => {
      const pendingChanges = pendingNodeChangesRef.current;

      pendingNodeChangesRef.current = [];
      nodesChangeRafRef.current = undefined;

      if (pendingChanges.length === 0) {
        return;
      }

      setNodes((currentNodes) => {
        const nextNodes = applyNodeChanges(pendingChanges, currentNodes) as AnchorFlowNode[];

        nodesRef.current = nextNodes;

        return nextNodes;
      });
    });
  }, []);

  /**
   * @description 鼠标进入节点
   */
  const handleNodeMouseEnter = useCallback(
    (event: ReactMouseEvent, node: AnchorFlowNode): void => {
      if (isNodeDraggingRef.current) {
        return;
      }

      const raw = getNodeRawData(node.data.treeData);

      if (!raw) return;

      clearTooltipTimer();

      setTooltipAnchor(event.currentTarget as HTMLElement);

      setTooltip((prev) => ({
        ...prev,
        visible: true,
        data: raw,
      }));
    },
    [clearTooltipTimer],
  );

  /**
   * @description 鼠标在节点上移动
   *
   * 仅当节点发生变化或 Popover 尚未显示时更新状态，
   * 避免 mousemove 高频触发重复渲染。
   */
  const handleNodeMouseMove = useCallback(
    (event: ReactMouseEvent, node: AnchorFlowNode): void => {
      if (isNodeDraggingRef.current) {
        return;
      }

      const raw = getNodeRawData(node.data.treeData);

      if (!raw) return;

      clearTooltipTimer();

      setTooltipAnchor(event.currentTarget as HTMLElement);

      setTooltip((prev) => {
        if (prev.visible && prev.data?.id === raw.id) {
          return prev;
        }

        return {
          ...prev,
          visible: true,
          data: raw,
        };
      });
    },
    [clearTooltipTimer],
  );

  /**
   * @description 鼠标离开节点
   */
  const handleNodeMouseLeave = useCallback((): void => {
    if (isNodeDraggingRef.current) {
      return;
    }

    handleHideTooltip();
  }, [handleHideTooltip]);

  /**
   * @description 开始拖拽节点
   */
  const handleNodeDragStart = useCallback<OnNodeDrag<AnchorFlowNode>>((): void => {
    isNodeDraggingRef.current = true;

    clearTooltipTimer();

    setTooltip((prev) => ({
      ...prev,
      visible: false,
    }));

    setTooltipAnchor(null);
  }, [clearTooltipTimer]);

  /**
   * @description 拖拽结束后保存最终位置
   *
   * 拖拽过程中只更新 nodes。
   * 松手后才把最终位置保存到 nodePositionMap，
   * 这样后续展开 / 收起 /刷新布局时可以保留用户拖过的位置。
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

  /**
   * @description 鼠标进入 Popover
   */
  const handleTooltipMouseEnter = (): void => {
    clearTooltipTimer();
  };

  /**
   * @description 鼠标离开 Popover
   */
  const handleTooltipMouseLeave = (): void => {
    handleHideTooltip();
  };

  const fileName = tooltip.data?.filePath ? tooltip.data.filePath.split(/[\\/]/).pop() || tooltip.data.filePath : 'Unknown File';

  return (
    <div className={styles.appWrapper}>
      <div className={styles.topControls}>
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

      <Popover
        open={tooltip.visible && !!tooltip.data}
        anchorEl={tooltipAnchor}
        placement="bottom"
        followAnchor
        showArrow
        title={tooltip.data?.description || 'Anchor Point'}
        titleIcon={<FontAwesomeIcon icon={faTag} />}
        onMouseEnter={handleTooltipMouseEnter}
        onMouseLeave={handleTooltipMouseLeave}
        footer={
          <>
            <button className={styles.anchorActionButton} onClick={() => handleAnchorAction('edit')}>
              <FontAwesomeIcon icon={faPenToSquare} />
              编辑
            </button>

            <button className={`${styles.anchorActionButton} ${styles.danger}`} onClick={() => handleAnchorAction('delete')}>
              <FontAwesomeIcon icon={faTrash} />
              删除
            </button>
          </>
        }
      >
        {tooltip.data && (
          <>
            <div className={styles.anchorDetailRow}>
              <FontAwesomeIcon icon={faFolderOpenReg} />

              <span className={styles.anchorDetailValue}>{tooltip.data.group || 'Default'}</span>
            </div>

            <div className={styles.anchorDetailRow}>
              <FontAwesomeIcon icon={faFileCodeReg} />

              <span className={styles.anchorDetailValue}>
                {fileName} : {tooltip.data.line || '?'}
              </span>
            </div>

            {tooltip.data.content && <pre className={styles.codeBlock}>{tooltip.data.content.trim()}</pre>}
          </>
        )}
      </Popover>
    </div>
  );
}
