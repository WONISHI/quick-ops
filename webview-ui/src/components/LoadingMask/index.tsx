import React from 'react';
import styles from './index.module.css';

interface LoadingMaskProps {
  visible: boolean;
  children?: React.ReactNode;
}

const LoadingMask: React.FC<LoadingMaskProps> = ({ visible, children }) => {
  if (!visible) return null;

  return (
    <div className={styles['loading-mask']}>
      <div className={styles['loading-mask-bg']} />

      {children || (
        <i
          className={`codicon codicon-loading codicon-modifier-spin ${styles['loading-icon']}`}
        />
      )}
    </div>
  );
};

export default LoadingMask;