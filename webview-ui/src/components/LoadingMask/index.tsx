import React from 'react';
import styles from './index.module.css';

interface ChangesLoadingMaskProps {
  visible: boolean;
}

const ChangesLoadingMask: React.FC<ChangesLoadingMaskProps> = ({ visible }) => {
  if (!visible) return null;

  return (
    <div className={styles['changes-loading-mask']}>
      <div className={styles['changes-loading-mask-bg']} />

      <i className={`codicon codicon-loading codicon-modifier-spin ${styles['changes-loading-icon']}`} />
    </div>
  );
};

export default ChangesLoadingMask;