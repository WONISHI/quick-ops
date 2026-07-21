interface HighlightTextProps {
  text: string;
  query: string;
  globalStartIndex: number;
  currentActiveMatch: number;
  isLineActive: boolean;
}

export default function HighlightText({
  text,
  query,
  globalStartIndex,
  currentActiveMatch,
  isLineActive,
}: HighlightTextProps) {
  if (!query) return <span>{text}</span>;
  
  const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${safeQuery})`, 'gi'));

  let matchCounter = 0;
  
  return (
    <span>
      {parts.map((part, index) => {
        const isMatch = part.toLowerCase() === query.toLowerCase();
        if (isMatch) {
          const thisGlobalIndex = globalStartIndex + matchCounter;
          matchCounter++;
          const isKeywordActive = thisGlobalIndex === currentActiveMatch;

          return (
            <span
              key={index}
              style={{
                backgroundColor: isKeywordActive 
                  ? 'var(--vscode-editor-findMatchBackground, #515c6a)' 
                  : 'var(--vscode-editor-findMatchHighlightBackground, #ea5c0055)',
                color: isKeywordActive 
                  ? '#fff' 
                  : isLineActive ? 'inherit' : 'var(--vscode-editor-findMatchForeground, inherit)',
                border: isKeywordActive 
                  ? '1px solid var(--vscode-editor-findMatchBorder, #f48771)' 
                  : 'none',
                borderRadius: '2px',
              }}
            >
              {part}
            </span>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </span>
  );
}