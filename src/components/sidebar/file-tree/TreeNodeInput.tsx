import { useState, useRef, useEffect } from 'react';

interface RenameInputProps {
  initialName: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function RenameInput({ initialName, onConfirm, onCancel }: RenameInputProps) {
  const [value, setValue] = useState(initialName);
  const confirmedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  const onConfirmRef = useRef(onConfirm);

  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => { onConfirmRef.current = onConfirm; }, [onConfirm]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const dotIndex = initialName.lastIndexOf('.');
    if (dotIndex > 0) {
      el.setSelectionRange(0, dotIndex);
    } else {
      el.select();
    }

    const handleGlobalClick = (e: MouseEvent) => {
      if (!confirmedRef.current && el && !el.contains(e.target as Node)) {
        confirmedRef.current = true;
        onConfirmRef.current(valueRef.current.trim() || initialName);
      }
    };

    document.addEventListener('mousedown', handleGlobalClick, true);
    return () => document.removeEventListener('mousedown', handleGlobalClick, true);
  }, [initialName]);

  const submitValue = () => {
    if (!confirmedRef.current) {
      confirmedRef.current = true;
      onConfirm(value.trim() || initialName);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      submitValue();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!confirmedRef.current) {
        confirmedRef.current = true;
        onCancel();
      }
    }
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (!confirmedRef.current) {
        submitValue();
      }
    }, 0);
  };

  return (
    <span className="file-name rename-input">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
    </span>
  );
}

interface CreatingNodeInputProps {
  name: string;
  level: number;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function CreatingNodeInput({ name, level, onConfirm, onCancel }: CreatingNodeInputProps) {
  return (
    <div
      className="tree-item creating-node"
      style={{ paddingLeft: `${level * 15 + 8}px` }}
    >
      {Array.from({ length: level }).map((_, i) => (
        <span
          key={i}
          className="tree-indent"
          style={{ left: `${i * 15 + 14.5}px` }}
        />
      ))}
      <span className="expand-arrow dot cursor-default text-muted-foreground/60">
        <svg width="6" height="6" viewBox="0 0 6 6">
          <circle cx="3" cy="3" r="3" fill="currentColor" />
        </svg>
      </span>
      <RenameInput
        initialName={name}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </div>
  );
}
