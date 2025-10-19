// 文件后缀
export const fileTypes = ['vue', 'jsx', 'tsx', 'css', 'less', 'scss', 'html', 'js', 'ts'];
// 网络状态码
export const httpStatusCode = [100, 101, 102, 200, 201, 202, 204, 301, 302, 304, 400, 401, 403, 404, 409, 429, 500, 501, 502, 503, 504];
// 请求方式
export const MethodCode = ['get', 'post', 'put', 'delete', 'all'];

export enum OpenMode {
  /** 当前窗体或弹窗中打开 */
  CURRENT = 'execute-in-current',
  /** 新开独立窗体或弹窗 */
  NEW = 'execute-with-new-session',
}