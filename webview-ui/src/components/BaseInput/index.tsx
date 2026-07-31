import React, { forwardRef, useState } from 'react';
import styles from './index.module.css';

type BaseInputSize = 'small' | 'middle' | 'large';
type BaseInputStatus = 'success' | 'warning' | 'error';

export interface BaseInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix' | 'onChange'> {
  size?: BaseInputSize;
  status?: BaseInputStatus;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  allowClear?: boolean;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onValueChange?: (value: string) => void;
  onClear?: () => void;
}

const joinClassName = (...classNames: Array<string | false | undefined>) => {
  return classNames.filter(Boolean).join(' ');
};

export const BaseInput = forwardRef<HTMLInputElement, BaseInputProps>(
  ({ value, defaultValue, size = 'middle', status, prefix, suffix, allowClear = false, disabled = false, className, onChange, onValueChange, onClear, ...restProps }, ref) => {
    const [innerValue, setInnerValue] = useState(() => String(defaultValue ?? ''));
    const controlled = value !== undefined;
    const currentValue = controlled ? String(value ?? '') : innerValue;
    const clearVisible = allowClear && !disabled && currentValue.length > 0;

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value;

      if (!controlled) {
        setInnerValue(nextValue);
      }

      onChange?.(event);
      onValueChange?.(nextValue);
    };

    const handleClear = () => {
      if (!controlled) {
        setInnerValue('');
      }

      onValueChange?.('');
      onClear?.();
    };

    return (
      <span
        className={joinClassName(
          styles['base-input'],
          styles[`base-input-${size}`],
          status && styles[`base-input-${status}`],
          disabled && styles['base-input-disabled'],
          className,
        )}
      >
        {prefix && <span className={styles['base-input-prefix']}>{prefix}</span>}

        <input ref={ref} value={currentValue} disabled={disabled} onChange={handleChange} {...restProps} />

        {clearVisible && (
          <button type="button" className={styles['base-input-clear']} title="清空" onClick={handleClear}>
            <span className="codicon codicon-close" />
          </button>
        )}

        {suffix && <span className={styles['base-input-suffix']}>{suffix}</span>}
      </span>
    );
  },
);

BaseInput.displayName = 'BaseInput';

export default BaseInput;
