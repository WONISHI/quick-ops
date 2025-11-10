export function defineConstArray<const T extends readonly unknown[]>(arr: T) {
  return arr;
}
