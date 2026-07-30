import type { MockGeneratorGroup } from '@pages/mock-app/src/type';

export const MOCK_GENERATOR_GROUPS: MockGeneratorGroup[] = [
  {
    label: 'Basic',
    options: [
      { value: 'boolean', label: 'boolean' },
      {
        value: 'natural',
        label: 'natural',
        defaultArguments: '1, 10000',
        argumentsPlaceholder: '最小值, 最大值',
      },
      {
        value: 'integer',
        label: 'integer',
        defaultArguments: '-100, 100',
        argumentsPlaceholder: '最小值, 最大值',
      },
      {
        value: 'float',
        label: 'float',
        defaultArguments: '0, 100, 2, 2',
        argumentsPlaceholder: '最小值, 最大值, 最少小数位, 最多小数位',
      },
      {
        value: 'character',
        label: 'character',
        argumentsPlaceholder: '可选字符池，例如 "lower"',
      },
      {
        value: 'string',
        label: 'string',
        defaultArguments: '5, 20',
        argumentsPlaceholder: '最小长度, 最大长度',
      },
      {
        value: 'range',
        label: 'range',
        defaultArguments: '1, 10',
        argumentsPlaceholder: '起始值, 结束值, 步长',
      },
      {
        value: 'date',
        label: 'date',
        argumentsPlaceholder: '可选格式，例如 "yyyy-MM-dd"',
      },
      {
        value: 'time',
        label: 'time',
        argumentsPlaceholder: '可选格式，例如 "HH:mm:ss"',
      },
      {
        value: 'datetime',
        label: 'datetime',
        argumentsPlaceholder: '可选格式，例如 "yyyy-MM-dd HH:mm:ss"',
      },
      {
        value: 'now',
        label: 'now',
        argumentsPlaceholder: '可选单位或格式',
      },
    ],
  },
  {
    label: 'Image',
    options: [
      {
        value: 'image',
        label: 'image',
        defaultArguments: '"200x100"',
        argumentsPlaceholder: '尺寸, 背景色, 前景色, 格式, 文本',
      },
      {
        value: 'dataImage',
        label: 'dataImage',
        defaultArguments: '"200x100"',
        argumentsPlaceholder: '尺寸, 文本',
      },
    ],
  },
  {
    label: 'Color',
    options: [{ value: 'color', label: 'color' }],
  },
  {
    label: 'Text',
    options: [
      {
        value: 'paragraph',
        label: 'paragraph',
        defaultArguments: '1, 3',
        argumentsPlaceholder: '最少句数, 最多句数',
      },
      {
        value: 'sentence',
        label: 'sentence',
        defaultArguments: '3, 8',
        argumentsPlaceholder: '最少单词数, 最多单词数',
      },
      { value: 'word', label: 'word' },
      {
        value: 'title',
        label: 'title',
        defaultArguments: '3, 5',
        argumentsPlaceholder: '最少单词数, 最多单词数',
      },
      {
        value: 'cparagraph',
        label: 'cparagraph',
        defaultArguments: '1, 3',
        argumentsPlaceholder: '最少句数, 最多句数',
      },
      {
        value: 'csentence',
        label: 'csentence',
        defaultArguments: '3, 8',
        argumentsPlaceholder: '最少汉字数, 最多汉字数',
      },
      {
        value: 'cword',
        label: 'cword',
        argumentsPlaceholder: '可选字符池或长度',
      },
      {
        value: 'ctitle',
        label: 'ctitle',
        defaultArguments: '3, 5',
        argumentsPlaceholder: '最少汉字数, 最多汉字数',
      },
    ],
  },
  {
    label: 'Name',
    options: [
      { value: 'first', label: 'first' },
      { value: 'last', label: 'last' },
      { value: 'name', label: 'name' },
      { value: 'cfirst', label: 'cfirst' },
      { value: 'clast', label: 'clast' },
      { value: 'cname', label: 'cname' },
    ],
  },
  {
    label: 'Web',
    options: [
      { value: 'url', label: 'url' },
      { value: 'domain', label: 'domain' },
      { value: 'email', label: 'email' },
      { value: 'ip', label: 'ip' },
      { value: 'tld', label: 'tld' },
    ],
  },
  {
    label: 'Address',
    options: [
      { value: 'area', label: 'area' },
      { value: 'region', label: 'region' },
    ],
  },
  {
    label: 'Helper',
    options: [
      {
        value: 'capitalize',
        label: 'capitalize',
        defaultArguments: '"hello world"',
        argumentsPlaceholder: '待处理文本',
      },
      {
        value: 'upper',
        label: 'upper',
        defaultArguments: '"hello world"',
        argumentsPlaceholder: '待处理文本',
      },
      {
        value: 'lower',
        label: 'lower',
        defaultArguments: '"HELLO WORLD"',
        argumentsPlaceholder: '待处理文本',
      },
      {
        value: 'pick',
        label: 'pick',
        defaultArguments: '"A", "B", "C"',
        argumentsPlaceholder: '候选值，使用逗号分隔',
      },
      {
        value: 'shuffle',
        label: 'shuffle',
        defaultArguments: '"A", "B", "C"',
        argumentsPlaceholder: '待打乱值，使用逗号分隔',
      },
    ],
  },
  {
    label: 'Miscellaneous',
    options: [
      { value: 'guid', label: 'guid' },
      { value: 'id', label: 'id' },
    ],
  },
];
