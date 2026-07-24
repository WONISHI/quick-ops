import type { ReactNode } from 'react';

import BaseButton from '@components/BaseButton';

import type { ApiProject } from '@/pages/api-dev-tools-app/src/type';

import styles from './index.module.css';

export interface ProjectCardProps {
  /**
   * @description 项目数据
   */
  project: ApiProject;

  /**
   * @description 是否为当前项目
   *
   * @default false
   */
  active?: boolean;

  /**
   * @description 接口列表插槽
   */
  children?: ReactNode;

  /**
   * @description 选择项目
   */
  onSelect: () => void | Promise<void>;

  /**
   * @description 重命名项目
   */
  onRename: () => void;

  /**
   * @description 给项目添加接口分组
   */
  onAddGroup: () => void;

  /**
   * @description 删除项目
   */
  onRemove: () => void;
}

/**
 * @description 项目卡片
 */
export default function ProjectCard({ project, active = false, children, onSelect, onRename, onAddGroup, onRemove }: ProjectCardProps) {
  return (
    <div
      className={[styles.card, active ? styles.active : ''].filter(Boolean).join(' ')}
      onClick={() => {
        onSelect();
      }}
    >
      <div className={styles.header}>
        <button
          type="button"
          className={styles.title}
          title={project.name}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
        >
          {project.name}
        </button>

        <BaseButton
          type="icon"
          size="small"
          title={`给项目添加分组：${project.name}`}
          icon={<i className="codicon codicon-new-collection" />}
          onClick={(event) => {
            event.stopPropagation();
            onAddGroup();
          }}
        />

        <BaseButton
          type="icon"
          size="small"
          title={`重命名项目：${project.name}`}
          icon={<i className="codicon codicon-edit" />}
          onClick={(event) => {
            event.stopPropagation();
            onRename();
          }}
        />

        <BaseButton
          type="icon"
          size="small"
          title={`删除项目：${project.name}`}
          icon={<i className="codicon codicon-trash" />}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        />
      </div>

      <div className={styles.content}>{children}</div>
    </div>
  );
}
