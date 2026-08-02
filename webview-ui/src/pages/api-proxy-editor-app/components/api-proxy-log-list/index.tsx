import BaseCodeEditor from '@components/BaseCodeEditor';
import styles from './index.module.css';

interface ApiProxyLogItem {
  id: string;
  time: number;
  level: 'info' | 'success' | 'error';
  message: string;
  from?: string;
  to?: string;
  ruleId?: string;
}

interface ApiProxyLogListProps {
  logs: ApiProxyLogItem[];
  expandedLogIds: Set<string>;
  onToggleLogDetail: (logId: string) => void;
}

function formatTime(time: number) {
  if (!time) return '';

  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, '0');

  return [`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`].join(' ');
}

function formatJsonText(value: string) {
  const text = value.trim();

  if (!text || (!text.startsWith('{') && !text.startsWith('['))) {
    return '';
  }

  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return '';
  }
}

function splitLogDetail(log: ApiProxyLogItem) {
  const lines: Array<{ label?: string; value: string }> = [];
  let jsonText = '';

  if (log.from) {
    lines.push({
      label: 'from',
      value: log.from,
    });
  }

  if (!log.to) {
    return {
      lines,
      jsonText,
    };
  }

  const responseIndex = log.to.search(/(^|\n)response:\s*/);

  if (responseIndex === -1) {
    lines.push({
      label: 'target',
      value: log.to,
    });
    return {
      lines,
      jsonText,
    };
  }

  const beforeResponse = log.to.slice(0, responseIndex).trim();
  const responseValue = log.to
    .slice(responseIndex)
    .replace(/^\n?response:\s*/, '')
    .trim();

  if (beforeResponse) {
    beforeResponse.split('\n').forEach((line) => {
      const match = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);

      if (!match) {
        lines.push({
          value: line,
        });
        return;
      }

      lines.push({
        label: match[1] === 'to' ? 'target' : match[1],
        value: match[2],
      });
    });
  }

  const formattedJson = formatJsonText(responseValue);

  if (formattedJson) {
    jsonText = formattedJson;
  } else if (responseValue) {
    lines.push({
      label: 'response',
      value: responseValue,
    });
  }

  return {
    lines,
    jsonText,
  };
}

function renderLogMessage(message: string) {
  const parts = message.split(' -> ');

  if (parts.length < 2) {
    return message;
  }

  return (
    <>
      <span className={styles['log-message-source']}>{parts[0]}</span>
      <span className={`codicon codicon-arrow-right ${styles['log-message-arrow']}`} />
      <span className={styles['log-message-target']}>{parts.slice(1).join(' -> ')}</span>
    </>
  );
}

export default function ApiProxyLogList({ logs, expandedLogIds, onToggleLogDetail }: ApiProxyLogListProps) {
  return (
    <div className={styles['log-list']}>
      {logs.length === 0 ? (
        <div className={styles['empty']}>暂无日志</div>
      ) : (
        logs
          .slice()
          .reverse()
          .map((log) => {
            const hasDetail = !!(log.from || log.to);
            const isExpanded = expandedLogIds.has(log.id);
            const detail = splitLogDetail(log);

            return (
              <div key={log.id} className={[styles['log-item'], styles[`log-${log.level}`]].filter(Boolean).join(' ')}>
                <button
                  type="button"
                  className={[styles['log-main'], hasDetail ? styles['log-main-clickable'] : ''].filter(Boolean).join(' ')}
                  disabled={!hasDetail}
                  onClick={() => hasDetail && onToggleLogDetail(log.id)}
                >
                  {hasDetail ? <span className="codicon codicon-chevron-right" data-expanded={isExpanded} /> : <span className={styles['log-chevron-placeholder']} />}

                  <span className={styles['log-time']}>{formatTime(log.time)}</span>
                  <span className={styles['log-message']}>{renderLogMessage(log.message)}</span>
                </button>

                {hasDetail && isExpanded && (
                  <div className={styles['log-detail']}>
                    {detail.lines.map((line, index) => (
                      <div key={`${log.id}-${index}`} className={styles['log-detail-row']}>
                        {line.label && <span className={styles['log-detail-label']}>{line.label}:</span>}
                        <span className={styles['log-detail-value']}>{line.value}</span>
                      </div>
                    ))}

                    {detail.jsonText && (
                      <div className={styles['log-code-editor']}>
                        <BaseCodeEditor value={detail.jsonText} language="json" editable={false} lineWrapping />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
      )}
    </div>
  );
}
