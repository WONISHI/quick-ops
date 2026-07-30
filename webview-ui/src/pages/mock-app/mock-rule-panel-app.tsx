import styles from '@pages/mock-app/index.module.css';
import MockSkeleton from '@pages/mock-app/components/mock-skeleton';
import BaseCodeEditor from '@components/BaseCodeEditor';
import { useEffect, useMemo, useState } from 'react';
import { vscode } from '@utils/vscode';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowsRotate, faCheck, faPlus, faTrash, faXmark } from '@fortawesome/free-solid-svg-icons';
import { faCopy, faFolderOpen } from '@fortawesome/free-regular-svg-icons';
import { MOCK_GENERATOR_GROUPS } from '@pages/mock-app/src/constants';
import type { MockRuleMode, MockFieldType, MockGeneratorType, MockFieldConfig, MockGeneratorGroup, MockTemplateBuildResult, MockFieldEditorProps } from '@pages/mock-app/src/type';

const MOCK_FIELD_TYPES: MockFieldType[] = ['Basic', 'Image', 'Color', 'Text', 'Name', 'Web', 'Address', 'Helper', 'Miscellaneous', 'Object', 'Array'];

const MOCK_GENERATOR_OPTIONS = MOCK_GENERATOR_GROUPS.flatMap((group) => group.options);

const MOCK_GENERATOR_OPTION_MAP = new Map(MOCK_GENERATOR_OPTIONS.map((item) => [item.value, item]));

const MOCK_GENERATOR_TYPE_TO_FIELD_TYPE = new Map<MockGeneratorType, Exclude<MockFieldType, 'Object' | 'Array'>>();

MOCK_GENERATOR_GROUPS.forEach((group) => {
  group.options.forEach((option) => {
    MOCK_GENERATOR_TYPE_TO_FIELD_TYPE.set(option.value, group.label);
  });
});

const MOCK_GENERATOR_TYPES = new Set<MockGeneratorType>(MOCK_GENERATOR_OPTIONS.map((item) => item.value));

function createFieldId(): string {
  return `mock-field-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getGeneratorGroup(fieldType: MockFieldType): MockGeneratorGroup | undefined {
  return MOCK_GENERATOR_GROUPS.find((group) => group.label === fieldType);
}

function createMockField(fieldName = '', fieldType: MockFieldType = 'Basic'): MockFieldConfig {
  const group = getGeneratorGroup(fieldType);
  const generatorType = group?.options[0]?.value;

  return {
    id: createFieldId(),
    fieldName,
    fieldType,
    generatorType,
    arguments: generatorType ? MOCK_GENERATOR_OPTION_MAP.get(generatorType)?.defaultArguments || '' : '',
    length: fieldType === 'Array' ? 3 : undefined,
    children: fieldType === 'Object' || fieldType === 'Array' ? [] : undefined,
  };
}

function createDefaultMockFields(): MockFieldConfig[] {
  return [];
}

function getDecimalLength(value: number): number {
  const text = String(value);
  const decimalIndex = text.indexOf('.');

  return decimalIndex < 0 ? 0 : text.length - decimalIndex - 1;
}

function createPrimitiveField(fieldName: string, value: unknown): MockFieldConfig {
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return {
        ...createMockField(fieldName, 'Basic'),
        generatorType: value >= 0 ? 'natural' : 'integer',
        arguments: `${value}, ${value}`,
      };
    }

    const decimalLength = getDecimalLength(value);

    return {
      ...createMockField(fieldName, 'Basic'),
      generatorType: 'float',
      arguments: `${value}, ${value}, ${decimalLength}, ${decimalLength}`,
    };
  }

  if (typeof value === 'boolean') {
    return {
      ...createMockField(fieldName, 'Basic'),
      generatorType: 'boolean',
      arguments: '',
    };
  }

  if (typeof value === 'string') {
    const matched = value.match(/^@([A-Za-z]+)(?:\((.*)\))?$/);

    if (matched) {
      const generatorType = matched[1] as MockGeneratorType;
      const fieldType = MOCK_GENERATOR_TYPE_TO_FIELD_TYPE.get(generatorType);

      if (fieldType && MOCK_GENERATOR_TYPES.has(generatorType)) {
        return {
          ...createMockField(fieldName, fieldType),
          generatorType,
          arguments: matched[2] || '',
        };
      }
    }

    return {
      ...createMockField(fieldName, 'Helper'),
      generatorType: 'pick',
      arguments: JSON.stringify(value),
    };
  }

  return {
    ...createMockField(fieldName, 'Basic'),
    generatorType: 'string',
    arguments: '0, 0',
  };
}

function parseTemplateObjectToFields(template: unknown): MockFieldConfig[] {
  if (!template || typeof template !== 'object' || Array.isArray(template)) {
    return [];
  }

  return Object.entries(template as Record<string, unknown>).map(([rawFieldName, value]) => {
    const arrayRule = rawFieldName.match(/^(.*)\|(\d+)$/);
    const fieldName = arrayRule?.[1] || rawFieldName;

    if (Array.isArray(value)) {
      const firstItem = value[0];
      const children = firstItem && typeof firstItem === 'object' && !Array.isArray(firstItem) ? parseTemplateObjectToFields(firstItem) : [];

      return {
        ...createMockField(fieldName, 'Array'),
        length: Math.max(1, Number(arrayRule?.[2] || value.length || 1)),
        children,
      };
    }

    if (value && typeof value === 'object') {
      return {
        ...createMockField(fieldName, 'Object'),
        children: parseTemplateObjectToFields(value),
      };
    }

    return createPrimitiveField(fieldName, value);
  });
}

function normalizeMockField(item: any): MockFieldConfig {
  if (item?.fieldType === 'Object' || item?.fieldType === 'Array') {
    return {
      id: String(item?.id || createFieldId()),
      fieldName: String(item?.fieldName || ''),
      fieldType: item.fieldType,
      length: item.fieldType === 'Array' ? Math.max(1, Number(item?.length || 1)) : undefined,
      children: Array.isArray(item?.children) ? item.children.map(normalizeMockField) : [],
    };
  }

  const legacyGeneratorType = MOCK_GENERATOR_TYPES.has(item?.generatorType) ? (item.generatorType as MockGeneratorType) : 'string';
  const inferredFieldType = MOCK_GENERATOR_TYPE_TO_FIELD_TYPE.get(legacyGeneratorType) || 'Basic';
  const fieldType = MOCK_FIELD_TYPES.includes(item?.fieldType) ? item.fieldType : inferredFieldType;
  const group = getGeneratorGroup(fieldType);
  const generatorType = group?.options.some((option) => option.value === item?.generatorType) ? item.generatorType : group?.options[0]?.value;

  return {
    id: String(item?.id || createFieldId()),
    fieldName: String(item?.fieldName || ''),
    fieldType,
    generatorType,
    arguments: String(item?.arguments || ''),
  };
}

function normalizeMockFields(fields: unknown, template: unknown): MockFieldConfig[] {
  if (Array.isArray(fields) && fields.length > 0) {
    return fields.map(normalizeMockField);
  }

  return parseTemplateObjectToFields(template);
}

interface BuildFieldMapResult {
  value: Record<string, unknown>;
  error: string;
}

function buildFieldMap(fields: MockFieldConfig[], parentPath = '根对象'): BuildFieldMapResult {
  const value: Record<string, unknown> = {};
  const usedFieldNames = new Set<string>();

  if (fields.length === 0) {
    return {
      value,
      error: `${parentPath}至少需要一个字段`,
    };
  }

  for (let index = 0; index < fields.length; index++) {
    const field = fields[index];
    const fieldName = field.fieldName.trim();
    const fieldPath = `${parentPath} > 第 ${index + 1} 行`;

    if (!fieldName) {
      return {
        value,
        error: `${fieldPath}的 Key 不能为空`,
      };
    }

    if (usedFieldNames.has(fieldName)) {
      return {
        value,
        error: `${parentPath}中的 Key“${fieldName}”重复`,
      };
    }

    usedFieldNames.add(fieldName);

    if (field.fieldType === 'Object') {
      const childResult = buildFieldMap(field.children || [], `${parentPath}.${fieldName}`);

      if (childResult.error) {
        return childResult;
      }

      value[fieldName] = childResult.value;
      continue;
    }

    if (field.fieldType === 'Array') {
      const length = Math.max(1, Math.floor(Number(field.length || 1)));
      const childResult = buildFieldMap(field.children || [], `${parentPath}.${fieldName}[]`);

      if (childResult.error) {
        return childResult;
      }

      value[`${fieldName}|${length}`] = [childResult.value];
      continue;
    }

    const generatorType = field.generatorType;

    if (!generatorType) {
      return {
        value,
        error: `${fieldPath}请选择生成方法`,
      };
    }

    const args = String(field.arguments || '').trim();

    value[fieldName] = args ? `@${generatorType}(${args})` : `@${generatorType}`;
  }

  return {
    value,
    error: '',
  };
}

function buildMockTemplate(fields: MockFieldConfig[]): MockTemplateBuildResult {
  const result = buildFieldMap(fields);

  return {
    template: result.value,
    templateText: JSON.stringify(result.value, null, 2),
    error: result.error,
  };
}

function updateFieldTree(fields: MockFieldConfig[], fieldId: string, updater: (field: MockFieldConfig) => MockFieldConfig): MockFieldConfig[] {
  return fields.map((field) => {
    if (field.id === fieldId) {
      return updater(field);
    }

    if (field.children?.length) {
      return {
        ...field,
        children: updateFieldTree(field.children, fieldId, updater),
      };
    }

    return field;
  });
}

function removeFieldFromTree(fields: MockFieldConfig[], fieldId: string): MockFieldConfig[] {
  return fields
    .filter((field) => field.id !== fieldId)
    .map((field) => ({
      ...field,
      children: field.children ? removeFieldFromTree(field.children, fieldId) : undefined,
    }));
}

function MockFieldEditor(props: MockFieldEditorProps) {
  const { field, depth, onPatch, onTypeChange, onAddChild, onRemove } = props;
  const isObject = field.fieldType === 'Object';
  const isArray = field.fieldType === 'Array';
  const isContainer = isObject || isArray;
  const generatorGroup = getGeneratorGroup(field.fieldType);
  const generatorOption = field.generatorType ? MOCK_GENERATOR_OPTION_MAP.get(field.generatorType) : undefined;

  return (
    <div className={[styles['mock-field-node'], depth > 0 ? styles['mock-field-node-nested'] : ''].filter(Boolean).join(' ')}>
      <div className={styles['mock-field-row']}>
        <input
          type="text"
          className={styles['mock-field-key']}
          value={field.fieldName}
          onChange={(event) =>
            onPatch(field.id, {
              fieldName: event.target.value,
            })
          }
          placeholder="请输入字段 Key"
          title="请输入返回对象中的字段 Key"
        />

        <select
          className={styles['mock-field-type']}
          value={field.fieldType}
          onChange={(event) => onTypeChange(field.id, event.target.value as MockFieldType)}
          title="选择字段类型"
        >
          {MOCK_FIELD_TYPES.map((fieldType) => (
            <option key={fieldType} value={fieldType}>
              {fieldType}
            </option>
          ))}
        </select>

        <div className={styles['mock-field-config']}>
          {generatorGroup && (
            <>
              <select
                value={field.generatorType}
                onChange={(event) => {
                  const generatorType = event.target.value as MockGeneratorType;

                  onPatch(field.id, {
                    generatorType,
                    arguments: MOCK_GENERATOR_OPTION_MAP.get(generatorType)?.defaultArguments || '',
                  });
                }}
                title="选择 Mock.js 生成方法"
              >
                {generatorGroup.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <input
                type="text"
                value={field.arguments || ''}
                onChange={(event) =>
                  onPatch(field.id, {
                    arguments: event.target.value,
                  })
                }
                placeholder={generatorOption?.argumentsPlaceholder || '无需参数'}
                title="只填写方法括号中的参数"
              />
            </>
          )}

          {isArray && (
            <label className={styles['mock-array-length']}>
              <span>length</span>
              <input
                type="number"
                min="1"
                value={field.length || 1}
                onChange={(event) =>
                  onPatch(field.id, {
                    length: Math.max(1, Number(event.target.value || 1)),
                  })
                }
                title="生成数组的长度"
              />
            </label>
          )}

          {isObject && <span className={styles['mock-structure-hint']}>对象结构</span>}
        </div>

        <button type="button" className={styles['mock-field-remove']} onClick={() => onRemove(field.id)} title="删除字段">
          <FontAwesomeIcon icon={faTrash} />
        </button>
      </div>

      {isContainer && (
        <div className={styles['mock-field-children']}>
          <div className={styles['mock-field-children-header']}>
            <span>{isArray ? '数组元素对象字段' : '对象字段'}</span>

            <button type="button" className={styles['mock-add-child']} onClick={() => onAddChild(field.id)}>
              <FontAwesomeIcon icon={faPlus} />
              新建字段
            </button>
          </div>

          <div className={styles['mock-field-children-list']}>
            {(field.children || []).length === 0 ? (
              <div className={styles['mock-field-children-empty']}>
                点击“新建字段”配置
                {isArray ? '数组元素' : '对象'}结构
              </div>
            ) : (
              (field.children || []).map((child) => (
                <MockFieldEditor key={child.id} field={child} depth={depth + 1} onPatch={onPatch} onTypeChange={onTypeChange} onAddChild={onAddChild} onRemove={onRemove} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MockRulePanelApp() {
  const [proxyId, setProxyId] = useState('');
  const [ruleId, setRuleId] = useState('');
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [statusCode, setStatusCode] = useState('200');
  const [contentType, setContentType] = useState('application/json');
  const [delay, setDelay] = useState('0');
  const [reqHeaders, setReqHeaders] = useState('');

  const [mode, setMode] = useState<MockRuleMode>('mock');
  const [mockFields, setMockFields] = useState<MockFieldConfig[]>(createDefaultMockFields);
  const [customJson, setCustomJson] = useState('');
  const [previewResult, setPreviewResult] = useState('');

  const [fileMode, setFileMode] = useState('single');
  const [filePathSingle, setFilePathSingle] = useState('');
  const [filePathsMultiple, setFilePathsMultiple] = useState<string[]>([]);
  const [fileDisposition, setFileDisposition] = useState('inline');
  const [uploadDestPath, setUploadDestPath] = useState('');

  const [copyStatus, setCopyStatus] = useState<Record<string, boolean>>({});

  /**
   * @description 是否正在等待 Extension Host 初始化规则
   */
  const [initializing, setInitializing] = useState(true);

  const mockTemplateResult = useMemo(() => buildMockTemplate(mockFields), [mockFields]);

  const previewContent = mockTemplateResult.error ? `Error: ${mockTemplateResult.error}` : previewResult;

  useEffect(() => {
    vscode.postMessage({
      type: 'webviewLoaded',
    });
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;

      if (msg.type === 'init') {
        setProxyId(msg.proxyId || '');

        const rule = msg.rule;

        setRuleId(rule?.id || '');
        setMethod(rule?.method || 'GET');
        setUrl(rule?.url || '');
        setContentType(rule?.contentType || 'application/json');
        setStatusCode(rule?.statusCode?.toString() || '200');
        setDelay(rule?.delay?.toString() || '0');
        setReqHeaders(rule?.reqHeaders ? JSON.stringify(rule.reqHeaders) : '');
        setFileDisposition(rule?.fileDisposition || 'inline');

        if (rule?.fileDisposition === 'upload') {
          setUploadDestPath(String(rule?.filePath || ''));
        }

        const paths = String(rule?.filePath || '')
          .split('\n')
          .map((item: string) => item.trim())
          .filter(Boolean);

        if (paths.length > 1) {
          setFileMode('multiple');
          setFilePathsMultiple(paths);
          setFilePathSingle('');
        } else {
          setFileMode('single');
          setFilePathSingle(paths[0] || '');
          setFilePathsMultiple([]);
        }

        let currentMode = rule?.mode as MockRuleMode | undefined;

        if (!currentMode) {
          if (rule?.isFile) {
            currentMode = 'file';
          } else if (rule && !rule.isTemplate && rule.data) {
            currentMode = 'custom';
          } else {
            currentMode = 'mock';
          }
        }

        setMode(currentMode);

        if (currentMode === 'custom') {
          setCustomJson(typeof rule?.data === 'string' ? rule.data : JSON.stringify(rule?.data || {}, null, 2));
        } else if (currentMode === 'mock') {
          setMockFields(normalizeMockFields(rule?.mockFields, rule?.template));
        }

        setInitializing(false);
        return;
      }

      if (msg.type === 'fileReturnPathSelected') {
        const newPaths = String(msg.path || '')
          .split('\n')
          .map((item: string) => item.trim())
          .filter(Boolean);

        if (fileMode === 'single') {
          setFilePathSingle(newPaths[0] || '');
        } else {
          setFilePathsMultiple((previous) => {
            const updated = [...previous];

            newPaths.forEach((item: string) => {
              if (!updated.includes(item)) {
                updated.push(item);
              }
            });

            return updated;
          });
        }

        return;
      }

      if (msg.type === 'folderReturnPathSelected') {
        setUploadDestPath(String(msg.path || ''));

        return;
      }

      if (msg.type === 'simulateResult') {
        setPreviewResult(msg.error ? `Error: ${msg.error}` : JSON.stringify(msg.result, null, 2));
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [fileMode]);

  useEffect(() => {
    if (mode !== 'mock' || mockTemplateResult.error) {
      return;
    }

    vscode.postMessage({
      type: 'simulate',
      template: mockTemplateResult.template,
      mode: 'mock',
    });
  }, [mockTemplateResult, mode]);

  const updateMockField = (fieldId: string, patch: Partial<MockFieldConfig>) => {
    setMockFields((previous) =>
      updateFieldTree(previous, fieldId, (field) => ({
        ...field,
        ...patch,
      })),
    );
  };

  const changeMockFieldType = (fieldId: string, fieldType: MockFieldType) => {
    setMockFields((previous) =>
      updateFieldTree(previous, fieldId, (field) => {
        if (fieldType === 'Object' || fieldType === 'Array') {
          return {
            ...field,
            fieldType,
            generatorType: undefined,
            arguments: '',
            length: fieldType === 'Array' ? field.length || 3 : undefined,
            children: field.children || [],
          };
        }

        const group = getGeneratorGroup(fieldType);
        const generatorType = group?.options[0]?.value;

        return {
          ...field,
          fieldType,
          generatorType,
          arguments: generatorType ? MOCK_GENERATOR_OPTION_MAP.get(generatorType)?.defaultArguments || '' : '',
          length: undefined,
          children: undefined,
        };
      }),
    );
  };

  const addMockField = () => {
    setMockFields((previous) => [...previous, createMockField()]);
  };

  const addMockChildField = (fieldId: string) => {
    setMockFields((previous) =>
      updateFieldTree(previous, fieldId, (field) => ({
        ...field,
        children: [...(field.children || []), createMockField()],
      })),
    );
  };

  const removeMockField = (fieldId: string) => {
    setMockFields((previous) => removeFieldFromTree(previous, fieldId));
  };

  const handleCopy = (text: string, id: string) => {
    vscode.postMessage({
      type: 'copyText',
      payload: text,
    });

    setCopyStatus((previous) => ({
      ...previous,
      [id]: true,
    }));

    window.setTimeout(() => {
      setCopyStatus((previous) => ({
        ...previous,
        [id]: false,
      }));
    }, 2000);
  };

  const simulateMock = () => {
    if (mockTemplateResult.error) {
      vscode.postMessage({
        type: 'error',
        message: mockTemplateResult.error,
      });
      return;
    }

    vscode.postMessage({
      type: 'simulate',
      template: mockTemplateResult.template,
      mode: 'mock',
    });
  };

  const save = () => {
    if (!url.trim()) {
      vscode.postMessage({
        type: 'error',
        message: 'API Path 不能为空！',
      });
      return;
    }

    const parsedDelay = parseInt(delay, 10) || 0;
    let reqHeadersObject = null;

    if (reqHeaders.trim()) {
      try {
        reqHeadersObject = JSON.parse(reqHeaders);

        if (typeof reqHeadersObject !== 'object' || reqHeadersObject === null || Array.isArray(reqHeadersObject)) {
          throw new Error();
        }
      } catch {
        vscode.postMessage({
          type: 'error',
          message: '注入请求头必须是合法的 JSON 对象格式！',
        });
        return;
      }
    }

    let template: Record<string, unknown> | undefined;
    let data: unknown;
    let filePath = '';

    try {
      if (mode === 'mock') {
        if (mockTemplateResult.error) {
          vscode.postMessage({
            type: 'error',
            message: mockTemplateResult.error,
          });
          return;
        }

        template = mockTemplateResult.template;
      } else if (mode === 'custom') {
        data = JSON.parse(customJson || '{}');
      } else {
        if (fileDisposition === 'upload') {
          filePath = uploadDestPath.trim();

          if (!filePath) {
            vscode.postMessage({
              type: 'error',
              message: '请指定文件存入路径！',
            });
            return;
          }
        } else {
          filePath = fileMode === 'single' ? filePathSingle.trim() : filePathsMultiple.join('\n');

          if (!filePath) {
            vscode.postMessage({
              type: 'error',
              message: '请选择要返回的文件！',
            });
            return;
          }
        }
      }

      vscode.postMessage({
        type: 'saveRule',
        payload: {
          id: ruleId,
          proxyId,
          method,
          url: url.trim(),
          contentType,
          enabled: true,
          template,
          mockFields: mode === 'mock' ? mockFields : undefined,
          data,
          mode,
          filePath,
          fileDisposition,
          delay: parsedDelay,
          reqHeaders: reqHeadersObject,
          statusCode: parseInt(statusCode, 10) || 200,
        },
      });
    } catch (error: unknown) {
      vscode.postMessage({
        type: 'error',
        message: `JSON 格式错误: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };

  if (initializing) {
    return <MockSkeleton variant="rule" />;
  }

  return (
    <div className={styles['mock-rule-root']}>
      <div className={styles['panel-container']}>
        <h2>配置拦截规则</h2>

        <div className={styles['form-row']}>
          <div className={styles['form-group']} style={{ flex: '0 0 100px' }}>
            <label>Method</label>

            <select value={method} onChange={(event) => setMethod(event.target.value)}>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>

          <div className={styles['form-group']}>
            <label>API Path</label>

            <input type="text" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="/api/user/info" />
          </div>

          <div className={styles['form-group']} style={{ flex: '0 0 80px' }}>
            <label>状态码</label>

            <input type="number" value={statusCode} onChange={(event) => setStatusCode(event.target.value)} placeholder="200" />
          </div>

          <div className={styles['form-group']} style={{ flex: '0 0 160px' }}>
            <label>Content-Type</label>

            <select value={contentType} onChange={(event) => setContentType(event.target.value)}>
              <option value="application/json">application/json</option>
              <option value="text/plain">text/plain</option>
              <option value="text/html">text/html</option>
              <option value="application/xml">application/xml</option>
              <option value="application/x-www-form-urlencoded">application/x-www-form-urlencoded</option>
              <option value="multipart/form-data">multipart/form-data</option>
              <option value="application/octet-stream">application/octet-stream (文件流)</option>
            </select>
          </div>
        </div>

        <div className={styles['form-row']}>
          <div className={styles['form-group']} style={{ flex: '0 0 100px' }}>
            <label>延时返回(ms)</label>

            <input type="number" value={delay} onChange={(event) => setDelay(event.target.value)} min="0" />
          </div>

          <div className={styles['form-group']}>
            <label>注入请求头 (合法 JSON 格式)</label>

            <input type="text" value={reqHeaders} onChange={(event) => setReqHeaders(event.target.value)} placeholder='{"X-Custom-Auth": "token123"}' />
          </div>
        </div>

        <div className={styles.tabs}>
          <button type="button" className={[styles.tab, mode === 'mock' ? styles.active : ''].filter(Boolean).join(' ')} onClick={() => setMode('mock')}>
            Mock 字段配置
          </button>

          <button type="button" className={[styles.tab, mode === 'custom' ? styles.active : ''].filter(Boolean).join(' ')} onClick={() => setMode('custom')}>
            静态 JSON
          </button>

          <button type="button" className={[styles.tab, mode === 'file' ? styles.active : ''].filter(Boolean).join(' ')} onClick={() => setMode('file')}>
            文件下发
          </button>
        </div>

        <div className={styles['tab-content']}>
          {mode === 'mock' && (
            <div>
              <div className={styles['mock-template-heading']}>
                <div className={styles['mock-template-title']}>Mock.js 模板代码</div>

                <div className={styles['mock-template-help']}>通过字段类型构建返回结构；Object 和 Array 可以继续嵌套字段。</div>
              </div>

              <div className={styles['mock-template-toolbar']}>
                <button type="button" className={styles['btn-sec']} onClick={addMockField}>
                  <FontAwesomeIcon icon={faPlus} />
                  新建字段
                </button>
              </div>

              <div className={styles['mock-fields-list']}>
                {mockFields.length === 0 ? (
                  <div className={styles['mock-fields-empty']}>暂无字段，点击“新建字段”开始构建 Mock 数据结构</div>
                ) : (
                  mockFields.map((field) => (
                    <MockFieldEditor
                      key={field.id}
                      field={field}
                      depth={0}
                      onPatch={updateMockField}
                      onTypeChange={changeMockFieldType}
                      onAddChild={addMockChildField}
                      onRemove={removeMockField}
                    />
                  ))
                )}
              </div>

              {mockTemplateResult.error && <div className={styles['mock-fields-error']}>{mockTemplateResult.error}</div>}

              <div className={styles['preview-section']}>
                <div className={styles['preview-header']}>
                  <label>实时预览 (Preview)</label>

                  <div className={styles['preview-actions']}>
                    <button type="button" className={styles['copy-btn']} onClick={() => handleCopy(previewContent, 'preview')}>
                      {copyStatus.preview ? (
                        <>
                          <FontAwesomeIcon
                            icon={faCheck}
                            style={{
                              color: 'var(--success)',
                            }}
                          />
                          已复制
                        </>
                      ) : (
                        <>
                          <FontAwesomeIcon icon={faCopy} />
                          复制
                        </>
                      )}
                    </button>

                    <button type="button" className={styles['btn-icon-only']} onClick={simulateMock} title="重新生成预览">
                      <FontAwesomeIcon icon={faArrowsRotate} />
                    </button>
                  </div>
                </div>

                <div className={styles['preview-box']}>{previewContent}</div>
              </div>
            </div>
          )}

          {mode === 'custom' && (
            <div>
              <div className={styles['textarea-header']}>
                <label>静态 JSON 数据</label>

                <button type="button" className={styles['copy-btn']} onClick={() => handleCopy(customJson, 'custom')}>
                  {copyStatus.custom ? (
                    <>
                      <FontAwesomeIcon
                        icon={faCheck}
                        style={{
                          color: 'var(--success)',
                        }}
                      />
                      已复制
                    </>
                  ) : (
                    <>
                      <FontAwesomeIcon icon={faCopy} />
                      复制
                    </>
                  )}
                </button>
              </div>

              <div className={styles['custom-json-editor']}>
                <BaseCodeEditor value={customJson} language="json" editable onChange={(val) => setCustomJson(val)} />
              </div>
            </div>
          )}

          {mode === 'file' && (
            <div>
              <div className={styles['form-group']}>
                <label>响应方式 (Content-Disposition)</label>

                <select value={fileDisposition} onChange={(event) => setFileDisposition(event.target.value)}>
                  <option value="inline">浏览器内预览 (Inline)</option>
                  <option value="attachment">作为附件下载 (Attachment)</option>
                  <option value="upload">文件上传</option>
                </select>
              </div>

              {fileDisposition !== 'upload' && (
                <div className={styles['form-group']} style={{ marginTop: '16px' }}>
                  <div className={styles['file-mode-header']}>
                    <label>选择要作为接口返回的本地文件</label>

                    <select value={fileMode} onChange={(event) => setFileMode(event.target.value)} className={styles['file-mode-select']}>
                      <option value="single">单文件</option>
                      <option value="multiple">多文件分发</option>
                    </select>
                  </div>

                  <div className={styles['file-select-row']}>
                    {fileMode === 'single' ? (
                      <input
                        type="text"
                        value={filePathSingle}
                        onChange={(event) => setFilePathSingle(event.target.value)}
                        placeholder="例如: public/logo.png 或绝对路径"
                        style={{ flex: 1 }}
                      />
                    ) : (
                      <div className={styles['file-tags-container']}>
                        {filePathsMultiple.length === 0 ? (
                          <span className={styles['file-empty-text']}>尚未选择文件...</span>
                        ) : (
                          filePathsMultiple.map((filePathItem, index) => (
                            <div key={filePathItem} className={styles['file-tag']}>
                              <span title={filePathItem}>{filePathItem}</span>

                              <FontAwesomeIcon
                                icon={faXmark}
                                className={styles['file-tag-close']}
                                onClick={() => setFilePathsMultiple(filePathsMultiple.filter((_, itemIndex) => itemIndex !== index))}
                              />
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    <button
                      type="button"
                      className={styles['btn-sec']}
                      style={{ height: '28px' }}
                      onClick={() =>
                        vscode.postMessage({
                          type: 'selectFileReturnPath',
                          currentPath: fileMode === 'single' ? filePathSingle : filePathsMultiple[0] || '',
                          multiple: fileMode === 'multiple',
                        })
                      }
                    >
                      <FontAwesomeIcon icon={faFolderOpen} />
                    </button>
                  </div>
                </div>
              )}

              {fileDisposition === 'upload' && method !== 'POST' && (
                <div className={styles['form-group']} style={{ marginTop: '16px' }}>
                  <div className={styles['upload-hint']}>
                    文件上传接口需要将 Method 设置为 <strong>POST</strong>
                  </div>
                </div>
              )}

              {fileDisposition === 'upload' && method === 'POST' && (
                <div className={styles['form-group']} style={{ marginTop: '16px' }}>
                  <label>文件存入路径</label>

                  <div className={styles['file-select-row']}>
                    <input
                      type="text"
                      value={uploadDestPath}
                      onChange={(event) => setUploadDestPath(event.target.value)}
                      placeholder="上传文件存放路径，例如: uploads/"
                      style={{ flex: 1 }}
                    />

                    <button
                      type="button"
                      className={styles['btn-sec']}
                      style={{ height: '28px' }}
                      onClick={() =>
                        vscode.postMessage({
                          type: 'selectFolderReturnPath',
                          currentPath: uploadDestPath,
                        })
                      }
                    >
                      <FontAwesomeIcon icon={faFolderOpen} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className={styles['actions-footer']}>
          <button
            type="button"
            className={styles['btn-sec']}
            onClick={() =>
              vscode.postMessage({
                type: 'cancel',
              })
            }
          >
            取消
          </button>

          <button type="button" className={styles['btn-pri']} onClick={save}>
            保存规则
          </button>
        </div>
      </div>
    </div>
  );
}
