export interface SearchResult {
  name: string;
  path: string;
}

export const SEARCH_RESULT_LIMIT = 200;

export interface HighlightSegment {
  text: string;
  highlight: boolean;
}

export function highlightMatch(name: string, query: string): HighlightSegment[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [{ text: name, highlight: false }];

  const lowerName = name.toLowerCase();
  const segments: HighlightSegment[] = [];
  let index = 0;

  while (true) {
    const found = lowerName.indexOf(normalizedQuery, index);
    if (found === -1) {
      if (index < name.length) segments.push({ text: name.slice(index), highlight: false });
      break;
    }
    if (found > index) {
      segments.push({ text: name.slice(index, found), highlight: false });
    }
    segments.push({ text: name.slice(found, found + normalizedQuery.length), highlight: true });
    index = found + normalizedQuery.length;
  }

  return segments;
}
