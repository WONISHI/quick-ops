import React, { createContext, useContext } from 'react';
import styles from './index.module.css';

type BaseFormLayout = 'horizontal' | 'vertical';
type BaseFormValidateStatus = 'success' | 'warning' | 'error' | 'validating';

interface BaseFormContextValue {
  layout: BaseFormLayout;
  labelWidth: string;
  colon: boolean;
  disabled: boolean;
}

export interface BaseFormProps {
  children?: React.ReactNode;
  layout?: BaseFormLayout;
  labelWidth?: number | string;
  colon?: boolean;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export interface BaseFormItemProps {
  label?: React.ReactNode;
  required?: boolean;
  validateStatus?: BaseFormValidateStatus;
  help?: React.ReactNode;
  extra?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const BaseFormContext = createContext<BaseFormContextValue>({
  layout: 'horizontal',
  labelWidth: '76px',
  colon: false,
  disabled: false,
});

const normalizeLabelWidth = (value: number | string | undefined) => {
  if (typeof value === 'number') {
    return `${value}px`;
  }

  return value || '76px';
};

const joinClassName = (...classNames: Array<string | false | undefined>) => {
  return classNames.filter(Boolean).join(' ');
};

export function BaseForm({ children, layout = 'horizontal', labelWidth, colon = false, disabled = false, className, style }: BaseFormProps) {
  const contextValue: BaseFormContextValue = {
    layout,
    labelWidth: normalizeLabelWidth(labelWidth),
    colon,
    disabled,
  };

  return (
    <BaseFormContext.Provider value={contextValue}>
      <div
        className={joinClassName(styles['base-form'], layout === 'vertical' && styles['base-form-vertical'], disabled && styles['base-form-disabled'], className)}
        style={
          {
            ...style,
            '--base-form-label-width': contextValue.labelWidth,
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </BaseFormContext.Provider>
  );
}

export function BaseFormItem({ label, required = false, validateStatus, help, extra, children, className, style }: BaseFormItemProps) {
  const context = useContext(BaseFormContext);
  const statusClassName = validateStatus ? styles[`base-form-item-${validateStatus}`] : '';

  return (
    <div className={joinClassName(styles['base-form-item'], statusClassName, className)} style={style}>
      {label !== undefined && (
        <label className={styles['base-form-label']}>
          {required && <span className={styles['base-form-required']}>*</span>}
          <span className={styles['base-form-label-text']}>{label}</span>
          {context.colon && <span className={styles['base-form-colon']}>:</span>}
        </label>
      )}

      <div className={styles['base-form-control']}>
        {children}

        {help && <div className={styles['base-form-help']}>{help}</div>}
        {extra && <div className={styles['base-form-extra']}>{extra}</div>}
      </div>
    </div>
  );
}

export default BaseForm;