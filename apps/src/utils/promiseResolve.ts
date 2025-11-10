let resolveFn: ((value: unknown) => void) | undefined;

const p = new Promise<unknown>((resolve) => {
  resolveFn = resolve;
});

// 导出等待结果的函数
export const waitForResult = (): Promise<unknown> => p;

// 导出触发 resolve 的函数
export const resolveResult = (data: unknown): void => {
  if (resolveFn) resolveFn(data);
};
