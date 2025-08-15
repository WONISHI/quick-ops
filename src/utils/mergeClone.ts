type Primitive = string | number | boolean | symbol | null | undefined;

type MergeClone<T, U> = {
  [K in keyof T | keyof U]: K extends keyof U
    ? K extends keyof T
      ? T[K] extends object
        ? U[K] extends object
          ? MergeClone<T[K], U[K]>
          : U[K]
        : U[K]
      : U[K]
    : K extends keyof T
    ? T[K]
    : never;
};

export default function mergeClone<T extends object, U extends object>(obj1: T, obj2: U): MergeClone<T, U> {
  const result: any = { ...obj1 };

  for (const key in obj2) {
    if (obj2.hasOwnProperty(key)) {
      const val1 = (obj1 as any)[key];
      const val2 = (obj2 as any)[key];

      if (
        val1 &&
        typeof val1 === 'object' &&
        val1 !== null &&
        !Array.isArray(val1) &&
        val2 &&
        typeof val2 === 'object' &&
        val2 !== null &&
        !Array.isArray(val2)
      ) {
        result[key] = mergeClone(val1, val2);
      } else {
        result[key] = val2;
      }
    }
  }

  return result as MergeClone<T, U>;
}