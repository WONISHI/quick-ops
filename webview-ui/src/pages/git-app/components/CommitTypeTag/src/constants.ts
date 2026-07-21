import type { CommitTypeOption } from './type';

export const COMMIT_TYPE_OPTIONS: CommitTypeOption[] = [
  {
    value: 'feat',
    label: 'feat',
    description: '新功能',
  },
  {
    value: 'fix',
    label: 'fix',
    description: '修补 bug',
  },
  {
    value: 'docs',
    label: 'docs',
    description: '文档',
  },
  {
    value: 'style',
    label: 'style',
    description: '格式（不影响代码运行的变动）',
  },
  {
    value: 'refactor',
    label: 'refactor',
    description: '重构',
  },
  {
    value: 'perf',
    label: 'perf',
    description: '性能优化',
  },
  {
    value: 'test',
    label: 'test',
    description: '测试',
  },
  {
    value: 'chore',
    label: 'chore',
    description: '构建过程或辅助工具的变动',
  },
  {
    value: 'revert',
    label: 'revert',
    description: '回退',
  },
  {
    value: 'build',
    label: 'build',
    description: '打包',
  },
];
