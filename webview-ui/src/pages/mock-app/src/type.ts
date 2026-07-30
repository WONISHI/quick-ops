export type MockRuleMode = 'mock' | 'custom' | 'file';

export type MockFieldType = 'Basic' | 'Image' | 'Color' | 'Text' | 'Name' | 'Web' | 'Address' | 'Helper' | 'Miscellaneous' | 'Object' | 'Array';

export type MockGeneratorType =
  | 'boolean'
  | 'natural'
  | 'integer'
  | 'float'
  | 'character'
  | 'string'
  | 'range'
  | 'date'
  | 'time'
  | 'datetime'
  | 'now'
  | 'image'
  | 'dataImage'
  | 'color'
  | 'paragraph'
  | 'sentence'
  | 'word'
  | 'title'
  | 'cparagraph'
  | 'csentence'
  | 'cword'
  | 'ctitle'
  | 'first'
  | 'last'
  | 'name'
  | 'cfirst'
  | 'clast'
  | 'cname'
  | 'url'
  | 'domain'
  | 'email'
  | 'ip'
  | 'tld'
  | 'area'
  | 'region'
  | 'capitalize'
  | 'upper'
  | 'lower'
  | 'pick'
  | 'shuffle'
  | 'guid'
  | 'id';

export interface MockFieldConfig {
  id: string;
  fieldName: string;
  fieldType: MockFieldType;
  generatorType?: MockGeneratorType;
  arguments?: string;
  length?: number;
  children?: MockFieldConfig[];
}

export interface MockGeneratorOption {
  value: MockGeneratorType;
  label: string;
  defaultArguments?: string;
  argumentsPlaceholder?: string;
}

export interface MockGeneratorGroup {
  label: Exclude<MockFieldType, 'Object' | 'Array'>;
  options: MockGeneratorOption[];
}

export interface MockTemplateBuildResult {
  template: Record<string, unknown>;
  templateText: string;
  error: string;
}

export interface MockFieldEditorProps {
  field: MockFieldConfig;
  depth: number;
  onPatch: (fieldId: string, patch: Partial<MockFieldConfig>) => void;
  onTypeChange: (fieldId: string, fieldType: MockFieldType) => void;
  onAddChild: (fieldId: string) => void;
  onRemove: (fieldId: string) => void;
}