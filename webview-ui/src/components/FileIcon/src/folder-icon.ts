import fileIcon from 'material-icon-theme/icons/file.svg';
import folderIcon from 'material-icon-theme/icons/folder.svg';
import folderOpenIcon from 'material-icon-theme/icons/folder-open.svg';
import yarnIcon from 'material-icon-theme/icons/folder-yarn.svg';
import yarnOpenIcon from 'material-icon-theme/icons/folder-yarn-open.svg';
import vuexIcon from 'material-icon-theme/icons/folder-vuex-store.svg';
import vuexOpenIcon from 'material-icon-theme/icons/folder-vercel-open.svg';

import type { IconMatchRule } from './type';

/**
 * @description 文件夹收起状态精确匹配
 */
const FOLDER_EXACT_NAMES: Record<string, string> = {
  yarn: yarnIcon,
  store: vuexIcon,
};

/**
 * @description 文件夹收起状态正则匹配
 */
const FOLDER_REGEX_NAMES: IconMatchRule[] = [];

/**
 * @description 文件夹展开状态精确匹配
 */
const FOLDER_OPEN_EXACT_NAMES: Record<string, string> = {
  yarn: yarnOpenIcon,
  store: vuexOpenIcon,
};

/**
 * @description 文件夹展开状态正则匹配
 */
const FOLDER_OPEN_REGEX_NAMES: IconMatchRule[] = [];

const getMatchedFolderIcon = (folderName: string, rules: IconMatchRule[]) => {
  return rules.find((rule) => rule.pattern.test(folderName))?.icon;
};

export const getFolderIconUrl = (folderName: string, isExpanded = false) => {
  const lowerName = String(folderName || '').toLowerCase();
  const exactNames = isExpanded ? FOLDER_OPEN_EXACT_NAMES : FOLDER_EXACT_NAMES;
  const regexNames = isExpanded ? FOLDER_OPEN_REGEX_NAMES : FOLDER_REGEX_NAMES;
  const fallbackIcon = isExpanded ? folderOpenIcon : folderIcon;

  if (exactNames[lowerName]) {
    return exactNames[lowerName];
  }

  return getMatchedFolderIcon(folderName, regexNames) || fallbackIcon || fileIcon;
};
