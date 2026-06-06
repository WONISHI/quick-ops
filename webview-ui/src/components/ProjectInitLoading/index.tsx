import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSpinner } from '@fortawesome/free-solid-svg-icons';
import LoadingMask from '../LoadingMask';
import styles from './index.module.css';

interface ProjectInitLoadingProps {
  text?: string;
}

const ProjectInitLoading: React.FC<ProjectInitLoadingProps> = ({ text = '正在加载...' }) => {
  return (
    <div className={styles['init-loading-wrapper']}>
      <LoadingMask visible>
        <div className={styles['init-loading-content']}>
          <FontAwesomeIcon
            icon={faSpinner}
            spin
            className={styles['init-loading-icon']}
          />
          <span className={styles['init-loading-text']}>{text}</span>
        </div>
      </LoadingMask>
    </div>
  );
};

export default ProjectInitLoading;
