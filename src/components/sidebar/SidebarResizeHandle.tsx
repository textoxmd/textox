interface SidebarResizeHandleProps {
  position: 'left' | 'right';
  onResizeStart: () => void;
}

export function SidebarResizeHandle({ position, onResizeStart }: SidebarResizeHandleProps) {
  return (
    <div
      className={`resize-handle ${position === 'right' ? 'left' : ''}`}
      onMouseDown={(e) => {
        e.preventDefault();
        onResizeStart();
      }}
    />
  );
}
