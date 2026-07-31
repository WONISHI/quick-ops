import styles from './index.module.css';

type ApiProxyMatchType = 'exact' | 'regex';

export interface ProxyItemRule {
  id: string;
  name: string;
  enabled: boolean;
  matchType: ApiProxyMatchType;
  match: string;
  target: string;
  rewrite?: string;
  preserveQuery: boolean;
}

export interface ProxyItemProps {
  rule: ProxyItemRule;
  running?: boolean;
  onStart?: (rule: ProxyItemRule) => void;
  onStop?: (rule: ProxyItemRule) => void;
  onEdit?: (rule: ProxyItemRule) => void;
  onDelete?: (rule: ProxyItemRule) => void;
}

export default function ProxyItem({ rule, running = false, onStart, onStop, onEdit, onDelete }: ProxyItemProps) {
  const title = rule.name || '未命名代理';

  return (
    <div className={[styles['proxy-item'], running ? styles['proxy-running'] : ''].filter(Boolean).join(' ')}>
      <span className={[styles['proxy-icon'], running ? styles['proxy-icon-running'] : ''].filter(Boolean).join(' ')}>
        <span className="codicon codicon-symbol-interface" />
      </span>

      <button type="button" className={styles['proxy-main']} title={title} onClick={() => onEdit?.(rule)}>
        <span className={styles['proxy-name']}>{title}</span>
        <span className={styles['proxy-meta']}>
          {rule.matchType === 'regex' ? '正则' : '精确'} · {rule.match || '未配置匹配地址'}
        </span>
      </button>

      <div className={styles['proxy-actions']}>
        <button
          type="button"
          className={styles['icon-btn']}
          title={running ? '停止代理' : '启动代理'}
          onClick={() => {
            if (running) {
              onStop?.(rule);
            } else {
              onStart?.(rule);
            }
          }}
        >
          <span className={`codicon ${running ? 'codicon-debug-disconnect' : 'codicon-rocket'}`} />
        </button>

        <button type="button" className={styles['icon-btn']} title="修改代理" onClick={() => onEdit?.(rule)}>
          <span className="codicon codicon-edit" />
        </button>

        <button type="button" className={[styles['icon-btn'], styles['danger']].join(' ')} title="删除代理" onClick={() => onDelete?.(rule)}>
          <span className="codicon codicon-trash" />
        </button>
      </div>
    </div>
  );
}
