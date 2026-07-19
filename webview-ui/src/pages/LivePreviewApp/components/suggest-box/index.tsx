import { forwardRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGlobe } from '@fortawesome/free-solid-svg-icons';
import { escapeRegExp } from '../../utils';
import styles from './index.module.css';

export interface SuggestItemType {
  url: string;
  title: string;
  description?: string;
  logo?: string;
  isDefault?: boolean;
}

interface SuggestBoxProps {
  visible: boolean;
  suggestions: SuggestItemType[];
  selectedIndex: number;
  query: string;
  onHover: (index: number) => void;
  onSelect: (url: string) => void;
}

const SuggestBox = forwardRef<HTMLDivElement, SuggestBoxProps>(
  ({ visible, suggestions, selectedIndex, query, onHover, onSelect }, ref) => {
    if (!visible || suggestions.length === 0) return null;

    const renderHighlighted = (text: string) => {
      const q = query.trim();
      if (!q) return text;

      const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, 'gi'));

      return parts.map((part, i) =>
        part.toLowerCase() === q.toLowerCase() ? (
          <span key={i} className={styles['highlight-match']}>
            {part}
          </span>
        ) : (
          part
        )
      );
    };

    return (
      <div className={styles['suggest-box']} ref={ref}>
        {suggestions.map((item, index) => (
          <div
            key={`${item.url}-${index}`}
            className={`${styles['suggest-item']} ${index === selectedIndex ? styles['selected'] : ''}`}
            onMouseEnter={() => onHover(index)}
            onClick={() => onSelect(item.url)}
          >
            <div className={styles['suggest-logo-wrap']}>
              {item.logo ? (
                <img
                  className={styles['suggest-logo']}
                  src={item.logo}
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              ) : (
                <FontAwesomeIcon icon={faGlobe} className={styles['suggest-logo-placeholder']} />
              )}
            </div>

            <div className={styles['suggest-content']}>
              <div className={styles['suggest-title-row']}>
                <div className={styles['suggest-title']}>{renderHighlighted(item.title)}</div>
                {item.isDefault && <span className={styles['suggest-default-tag']}>默认</span>}
              </div>

              {item.description && (
                <div className={styles['suggest-description']}>{renderHighlighted(item.description)}</div>
              )}

              <div className={styles['suggest-url']}>{renderHighlighted(item.url)}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }
);

SuggestBox.displayName = 'SuggestBox';

export default SuggestBox;