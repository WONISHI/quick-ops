import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { dropTargetForExternal } from '@atlaskit/pragmatic-drag-and-drop/external/adapter';
import { containsFiles, getFiles } from '@atlaskit/pragmatic-drag-and-drop/external/file';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { setCustomNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview';
import styles from './index.module.css';
import type { DraggingEntity } from '@/pages/recent-projects-app/src/type';

const TREE_DRAG_DATA_TYPE = 'quickops-tree-item';

export type TreeDraggingEntity = DraggingEntity & {
  entities: DraggingEntity[];
};

export type TreeDragDropContainerProps = {
  path: string;
  className?: string;
  entity?: DraggingEntity;
  draggableEnabled: boolean;
  dropTargetEnabled: boolean;
  resolveDraggingEntity?: (entity: DraggingEntity) => TreeDraggingEntity;
  canDrop: (entity: TreeDraggingEntity) => boolean;
  onDragStart: (entity: TreeDraggingEntity) => void;
  onDragOver: (entity: TreeDraggingEntity) => void;
  onDragLeave: () => void;
  onDrop: (entity: TreeDraggingEntity) => void;
  onDragEnd: () => void;
  onExternalDragOver?: () => void;
  onExternalDragLeave?: () => void;
  onExternalFileDrop?: (files: File[], sourcePaths: string[]) => void;
  children: React.ReactNode;
};

const parsePragmaticDraggingEntity = (value: unknown): DraggingEntity | null => {
  if (!value || typeof value !== 'object') return null;

  const data = value as Record<string, unknown>;

  if (typeof data.path !== 'string' || typeof data.name !== 'string' || typeof data.projectName !== 'string') return null;

  return {
    path: data.path,
    name: data.name,
    isFolder: Boolean(data.isFolder),
    projectName: data.projectName,
  };
};

const getPragmaticDraggingEntity = (data: Record<string | symbol, unknown>): TreeDraggingEntity | null => {
  if (data.type !== TREE_DRAG_DATA_TYPE) return null;

  const primaryEntity = parsePragmaticDraggingEntity(data);

  if (!primaryEntity) return null;

  const parsedEntities = Array.isArray(data.entities) ? data.entities.map(parsePragmaticDraggingEntity).filter((item): item is DraggingEntity => !!item) : [];
  const entities = parsedEntities.length > 0 ? parsedEntities : [primaryEntity];

  return {
    ...primaryEntity,
    entities,
  };
};

export default function TreeDragDropContainer(props: TreeDragDropContainerProps) {
  const dropTargetRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);

  useLayoutEffect(() => {
    propsRef.current = props;
  }, [props]);

  useEffect(() => {
    const cleanups: (() => void)[] = [];
    const dropElement = dropTargetRef.current;
    const dragElement = dropElement?.querySelector<HTMLElement>(':scope > [data-tree-drag-handle="true"]') || null;
    const currentEntity = propsRef.current.entity;

    if (dragElement && currentEntity && propsRef.current.draggableEnabled) {
      let activeDraggingEntity: TreeDraggingEntity = {
        ...currentEntity,
        entities: [currentEntity],
      };

      cleanups.push(
        draggable({
          element: dragElement,
          getInitialData: () => {
            activeDraggingEntity = propsRef.current.resolveDraggingEntity?.(currentEntity) || activeDraggingEntity;

            return {
              type: TREE_DRAG_DATA_TYPE,
              ...activeDraggingEntity,
            };
          },
          onGenerateDragPreview({ nativeSetDragImage }) {
            activeDraggingEntity = propsRef.current.resolveDraggingEntity?.(currentEntity) || activeDraggingEntity;

            if (activeDraggingEntity.entities.length <= 1) return;

            setCustomNativeDragPreview({
              nativeSetDragImage,
              render({ container }) {
                const preview = document.createElement('div');
                const visibleEntities = activeDraggingEntity.entities.slice(0, 4);

                preview.className = styles['multi-drag-preview'];

                visibleEntities.forEach((item) => {
                  const row = document.createElement('div');

                  row.className = styles['multi-drag-preview-item'];
                  row.textContent = item.name;
                  preview.appendChild(row);
                });

                if (activeDraggingEntity.entities.length > visibleEntities.length) {
                  const more = document.createElement('div');

                  more.className = styles['multi-drag-preview-more'];
                  more.textContent = `还有 ${activeDraggingEntity.entities.length - visibleEntities.length} 个项目`;
                  preview.appendChild(more);
                }

                container.appendChild(preview);

                return () => {
                  preview.remove();
                };
              },
            });
          },
          onDragStart() {
            activeDraggingEntity = propsRef.current.resolveDraggingEntity?.(currentEntity) || activeDraggingEntity;
            propsRef.current.onDragStart(activeDraggingEntity);
          },
          onDrop() {
            window.setTimeout(() => {
              propsRef.current.onDragEnd();
            }, 0);
          },
        }),
      );
    }

    if (dropElement && propsRef.current.dropTargetEnabled) {
      const updateDropTarget = ({ source, location }: any) => {
        const entity = getPragmaticDraggingEntity(source.data);
        const innerMostTarget = location.current.dropTargets[0];

        if (!entity || innerMostTarget?.element !== dropElement || !propsRef.current.canDrop(entity)) {
          propsRef.current.onDragLeave();
          return;
        }

        propsRef.current.onDragOver(entity);
      };

      cleanups.push(
        dropTargetForElements({
          element: dropElement,
          getData: () => ({
            type: 'quickops-folder-drop-target',
            path: propsRef.current.path,
          }),
          getDropEffect: () => 'move',
          canDrop({ source }) {
            const entity = getPragmaticDraggingEntity(source.data);

            return !!entity && propsRef.current.canDrop(entity);
          },
          getIsSticky: () => true,
          onDragEnter: updateDropTarget,
          onDrag: updateDropTarget,
          onDragLeave() {
            propsRef.current.onDragLeave();
          },
          onDrop({ source, location }) {
            const entity = getPragmaticDraggingEntity(source.data);
            const innerMostTarget = location.current.dropTargets[0];

            if (!entity || innerMostTarget?.element !== dropElement || !propsRef.current.canDrop(entity)) {
              propsRef.current.onDragLeave();
              return;
            }

            propsRef.current.onDrop(entity);
          },
        }),
      );
    }

    if (dropElement && propsRef.current.dropTargetEnabled && propsRef.current.onExternalFileDrop) {
      const updateExternalDropTarget = ({ location }: any) => {
        const innerMostTarget = location.current.dropTargets[0];

        if (innerMostTarget?.element !== dropElement) {
          propsRef.current.onExternalDragLeave?.();
          return;
        }

        propsRef.current.onExternalDragOver?.();
      };

      cleanups.push(
        dropTargetForExternal({
          element: dropElement,
          getData: () => ({
            type: 'quickops-external-file-drop-target',
            path: propsRef.current.path,
          }),
          getDropEffect: () => 'copy',
          canDrop: containsFiles,
          getIsSticky: () => true,
          onDragEnter: updateExternalDropTarget,
          onDrag: updateExternalDropTarget,
          onDragLeave() {
            propsRef.current.onExternalDragLeave?.();
          },
          onDrop({ source, location }) {
            const innerMostTarget = location.current.dropTargets[0];

            if (innerMostTarget?.element !== dropElement) {
              propsRef.current.onExternalDragLeave?.();
              return;
            }

            const files = getFiles({ source });

            propsRef.current.onExternalDragLeave?.();

            if (files.length > 0) {
              propsRef.current.onExternalFileDrop?.(files, []);
            }
          },
        }),
      );
    }

    if (cleanups.length === 0) return;

    return combine(...cleanups);
  }, [props.path, props.draggableEnabled, props.dropTargetEnabled, props.entity?.path, props.entity?.name, props.entity?.isFolder, props.entity?.projectName]);

  return (
    <div ref={dropTargetRef} className={props.className}>
      {props.children}
    </div>
  );
}
