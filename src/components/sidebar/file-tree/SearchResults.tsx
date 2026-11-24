import { highlightMatch, type SearchResult } from './search';
import { ScrollEdges, useScrollEdges } from '@/components/sidebar/ScrollEdges';

interface SearchResultsProps {
  results: SearchResult[];
  query: string;
  rootPath: string;
  currentFile: string | null;
  searching: boolean;
  limitReached: boolean;
  onFileSelect: (path: string) => void;
  noResultsText: string;
  limitReachedText: string;
}

export function SearchResults({
  results,
  query,
  rootPath,
  currentFile,
  searching,
  limitReached,
  onFileSelect,
  noResultsText,
  limitReachedText,
}: SearchResultsProps) {
  const stripRoot = (path: string): string => {
    if (!rootPath) return path;
    const clean = path.replace(/[/\\]$/, '');
    const base = clean.startsWith(rootPath) ? clean.slice(rootPath.length) : clean;
    return base.replace(/^[/\\]/, '');
  };
  const edges = useScrollEdges<HTMLDivElement>();

  if (results.length === 0) {
    if (searching) return null;
    return <div className="search-results-empty">{noResultsText}</div>;
  }

  return (
    <div className="search-results-scroll">
      <div className="search-results" ref={edges.ref}>
        {limitReached && <div className="search-results-limit">{limitReachedText}</div>}
        {results.map((result) => (
          <button
            key={result.path}
            className={`search-result-item${result.path === currentFile ? ' selected' : ''}`}
            onClick={() => onFileSelect(result.path)}
          >
            <span className="search-result-name">
              {highlightMatch(result.name, query).map((segment, i) =>
                segment.highlight ? (
                  <mark key={i}>{segment.text}</mark>
                ) : (
                  <span key={i}>{segment.text}</span>
                ),
              )}
            </span>
            <span className="search-result-path">{stripRoot(result.path)}</span>
          </button>
        ))}
      </div>
      <ScrollEdges canScrollUp={edges.canScrollUp} canScrollDown={edges.canScrollDown} />
    </div>
  );
}
