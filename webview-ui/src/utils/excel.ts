export function getColumnLetter(n: number): string {
  let name = '';

  while (n >= 0) {
    name = String.fromCharCode((n % 26) + 65) + name;
    n = Math.floor(n / 26) - 1;
  }

  return name;
}