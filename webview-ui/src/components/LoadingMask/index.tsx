import React from 'react';
import styles from './index.module.css';

interface LoadingMaskProps {
  visible: boolean;
}

const LoadingMask: React.FC<LoadingMaskProps> = ({ visible }) => {
  if (!visible) return null;

  return (
    <div className={styles['loading-mask']}>
      <div className={styles['loading-mask-bg']} />

      <i className={`codicon codicon-loading codicon-modifier-spin ${styles['loading-icon']}`} />
    </div>
  );
};

export default LoadingMask;