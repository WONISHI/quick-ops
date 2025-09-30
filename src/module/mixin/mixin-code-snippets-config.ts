import { properties } from '../../global-object/properties';
/**
 * 替换字符串中 ${} 内容为指定值
 * @param str 原字符串
 * @param values 替换对象，key 为变量名，value 为替换值
 */
export function replaceTemplateVariables(str: string) {
  return str.replace(/\[\[(.+?)\]\]/g, (_, key) => {
    const k = key as keyof typeof properties;
    return !!properties[k] ? `"${properties[k]}"` : '';
  });
}

export function parseFieldValue(texts: string[]) {
  if (!texts.length) return '';
  const regex = /\[\[(.+?)\]\]/g;
  return texts.reduce((prev, item) => {
    if (regex.test(item)) {
      prev += replaceTemplateVariables(item) + '\n';
    } else {
      prev += item + '\n';
    }
    return prev;
  }, '');
}