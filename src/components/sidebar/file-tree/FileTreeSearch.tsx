import { useEffect, useRef, useState } from 'react';
import { X, Loader2 } from 'lucide-react';

interface FileTreeSearchProps {
  query: string;
  searching: boolean;
  placeholder: string;
  onChange: (value: string) => void;
  onClose: () => void;
  closeTitle: string;
}

const CLOSE_ANIMATION_MS = 180;

export function FileTreeSearch({
  query,
  searching,
  placeholder,
  onChange,
  onClose,
  closeTitle,
}: FileTreeSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(onClose, CLOSE_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [closing, onClose]);

  return (
    <div className={`file-tree-search${closing ? ' closing' : ''}`}>
      <button
        className="file-tree-search-close-icon"
        onClick={() => setClosing(true)}
        title={closeTitle}
        aria-label={closeTitle}
      >
        <X size={14} />
      </button>
      <div className="file-tree-search-box">
        <input
          ref={inputRef}
          className="file-tree-search-input"
          type="text"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
        />
        {searching && <Loader2 className="file-tree-search-spinner animate-spin" size={14} />}
      </div>
    </div>
  );
}
