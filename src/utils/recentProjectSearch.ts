export function normalizeSearchText(value: string): string {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .toLowerCase()
    .trim();
}

export function compactSearchText(value: string): string {
  return normalizeSearchText(value).replace(/[\s/_.@#:$+~\-]+/g, '');
}

export function getSequentialFuzzyScore(target: string, input: string): number | null {
  if (!target || !input) {
    return null;
  }

  let targetIndex = 0;
  let firstIndex = -1;
  let lastIndex = -1;
  let gapScore = 0;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const foundIndex = target.indexOf(char, targetIndex);

    if (foundIndex === -1) {
      return null;
    }

    if (firstIndex === -1) {
      firstIndex = foundIndex;
    }

    if (lastIndex !== -1) {
      gapScore += Math.max(0, foundIndex - lastIndex - 1);
    }

    lastIndex = foundIndex;
    targetIndex = foundIndex + 1;
  }

  return firstIndex + gapScore + Math.max(0, target.length - input.length) * 0.01;
}
