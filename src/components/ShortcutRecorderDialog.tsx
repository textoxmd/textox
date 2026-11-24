import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from '@/components/GlassDialog';
import {
  SHORTCUT_ACTIONS,
  ShortcutsConfig,
  ShortcutConflict,
  findConflictsForShortcut,
  formatShortcutToTags,
  isValidShortcut,
  saveShortcutsConfig,
} from '../utils/shortcuts';

interface ShortcutRecorderDialogProps {
  actionId: string | null;
  config: ShortcutsConfig;
  onClose: () => void;
  onSave: (config: ShortcutsConfig) => void;
}

export function ShortcutRecorderDialog({
  actionId,
  config,
  onClose,
  onSave,
}: ShortcutRecorderDialogProps) {
  const { t } = useTranslation();
  const [recordingShortcut, setRecordingShortcut] = useState<string | null>(null);
  const [pendingConflicts, setPendingConflicts] = useState<ShortcutConflict[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setRecordingShortcut(null);
    setPendingConflicts([]);
  }, [actionId]);

  useEffect(() => {
    if (!actionId) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return;

      event.preventDefault();
      event.stopPropagation();

      if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;

      const parts: string[] = [];
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

      if (isMac && event.metaKey) parts.push('Cmd');
      if (event.ctrlKey) parts.push('Ctrl');
      if (event.altKey) parts.push(isMac ? 'Opt' : 'Alt');
      if (event.shiftKey) parts.push('Shift');

      let key = event.key;
      if (key.length === 1) key = key.toUpperCase();
      parts.push(key);

      const shortcutString = parts.join('+');
      if (isValidShortcut(shortcutString)) {
        setRecordingShortcut(shortcutString);
        const foundConflicts = findConflictsForShortcut(config, shortcutString, actionId);
        setPendingConflicts(foundConflicts);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [actionId, config]);

  const handleConfirm = useCallback(async () => {
    if (!actionId || !recordingShortcut || isSaving) return;

    const hasBuiltInConflict = pendingConflicts.some(c => {
      const a = SHORTCUT_ACTIONS.find(sa => sa.id === c.actionId);
      return a?.builtIn;
    });
    if (hasBuiltInConflict) return;

    setIsSaving(true);
    try {
      const newConfig: ShortcutsConfig = {
        ...config,
        shortcuts: {
          ...config.shortcuts,
          [actionId]: recordingShortcut,
        },
      };

      for (const conflict of pendingConflicts) {
        newConfig.shortcuts[conflict.actionId] = null;
      }

      await saveShortcutsConfig(newConfig);
      onSave(newConfig);
    } finally {
      setIsSaving(false);
    }
  }, [actionId, recordingShortcut, pendingConflicts, config, onSave, isSaving]);

  const hasBuiltInConflict = useMemo(() => {
    return pendingConflicts.some(c => {
      const a = SHORTCUT_ACTIONS.find(sa => sa.id === c.actionId);
      return a?.builtIn;
    });
  }, [pendingConflicts]);

  const hasConflict = pendingConflicts.length > 0 && !hasBuiltInConflict;

  const actionName = useMemo(() => {
    if (!actionId) return '';
    const action = SHORTCUT_ACTIONS.find(a => a.id === actionId);
    return action ? t(action.name) : '';
  }, [actionId, t]);

  return (
    <Dialog open={!!actionId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-xs">
        <div className="flex flex-col gap-4">
          <div className="self-start">
            <span className="text-sm text-muted-foreground">{actionName}</span>
          </div>

          <div className="flex items-center justify-center gap-1 py-2">
            {formatShortcutToTags(recordingShortcut ?? config.shortcuts[actionId!] ?? '').map((tag, index) => (
              <Kbd
                key={index}
                className={`shortcut-tag${recordingShortcut ? ' recording' : ''}${
                  hasBuiltInConflict ? ' conflict-builtin' : ''
                }${hasConflict ? ' conflict' : ''}`}
              >
                {tag}
              </Kbd>
            ))}
            {!recordingShortcut && !config.shortcuts[actionId!] && (
              <span className="text-muted-foreground text-xs">—</span>
            )}
            {hasBuiltInConflict && (
              <Ban className="ml-1 h-4 w-4 text-warning" aria-hidden />
            )}
            {hasConflict && (
              <Circle className="ml-1 h-2 w-2 fill-warning text-warning" aria-hidden />
            )}
          </div>

          <DialogFooter className="mt-0 w-full">
            {!hasBuiltInConflict && (
              <Button
                variant="outline"
                size="sm"
                className={`rounded-lg${hasConflict ? ' shortcut-btn-warning' : ''}`}
                onClick={handleConfirm}
                disabled={!recordingShortcut || isSaving}
                autoFocus
              >
                {hasConflict ? t('shortcuts.forceOverride') : t('common.save')}
              </Button>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
