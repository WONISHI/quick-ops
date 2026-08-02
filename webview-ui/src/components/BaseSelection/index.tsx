import React, { forwardRef, useState } from 'react';
import styles from './index.module.css';

type BaseSelectSize = 'small' | 'middle' | 'large';
type BaseSelectStatus = 'success' | 'warning' | 'error';

export interface BaseSelectOption<ValueType extends string = string> {
  label: React.ReactNode;
  value: ValueType;
  disabled?: boolean;
}

export interface BaseSelectProps<ValueType extends string = string> extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size' | 'value' | 'defaultValue' | 'onChange'> {
  value?: ValueType;
  defaultValue?: ValueType;
  options?: Array<BaseSelectOption<ValueType>>;
  placeholder?: string;
  size?: BaseSelectSize;
  status?: BaseSelectStatus;
  allowClear?: boolean;
  suffixIcon?: React.ReactNode;
  onChange?: (value: ValueType, option?: BaseSelectOption<ValueType>) => void;
  onClear?: () => void;
}

const EMPTY_VALUE = '__BASE_SELECT_EMPTY__';

const joinClassName = (...classNames: Array<string | false | undefined>) => {
  return classNames.filter(Boolean).join(' ');
};

export const BaseSelect = forwardRef<HTMLSelectElement, BaseSelectProps>(
  (
    { value, defaultValue, options = [], placeholder, size = 'middle', status, allowClear = false, suffixIcon, disabled = false, className, onChange, onClear, ...restProps },
    ref,
  ) => {
    const [innerValue, setInnerValue] = useState(() => defaultValue || '');
    const controlled = value !== undefined;
    const currentValue = controlled ? value || '' : innerValue;
    const clearVisible = allowClear && !disabled && !!currentValue;

    const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
      const nextValue = event.target.value === EMPTY_VALUE ? '' : event.target.value;
      const nextOption = options.find((option) => option.value === nextValue);

      if (!controlled) {
        setInnerValue(nextValue);
      }

      onChange?.(nextValue, nextOption);
    };

    const handleClear = () => {
      if (!controlled) {
        setInnerValue('');
      }

      onChange?.('', undefined);
      onClear?.();
    };

    return (
      <span
        className={joinClassName(
          styles['base-select'],
          styles[`base-select-${size}`],
          status && styles[`base-select-${status}`],
          disabled && styles['base-select-disabled'],
          className,
        )}
      >
        <select ref={ref} value={currentValue || EMPTY_VALUE} disabled={disabled} onChange={handleChange} {...restProps}>
          {placeholder && (
            <option value={EMPTY_VALUE} disabled>
              {placeholder}
            </option>
          )}

          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>

        {clearVisible ? (
          <button type="button" className={styles['base-select-clear']} title="清空" onClick={handleClear}>
            <span className="codicon codicon-close" />
          </button>
        ) : (
          <span className={styles['base-select-arrow']}>{suffixIcon || <span className="codicon codicon-chevron-down" />}</span>
        )}
      </span>
    );
  },
);

BaseSelect.displayName = 'BaseSelect';

export const BaseSelection = BaseSelect;
export type BaseSelectionProps<ValueType extends string = string> = BaseSelectProps<ValueType>;

export default BaseSelect;
