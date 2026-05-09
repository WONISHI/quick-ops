export const isUrlLike = (str: string) =>
  /^(https?:\/\/|file:\/\/)?(localhost|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})(:\d+)?(\/.*)?$/i.test(str);

export const escapeRegExp = (string: string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};