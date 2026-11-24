/**
 * 快捷键设置组件
 * 提供快捷键的配置、修改和冲突检测功能
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { RotateCcw, X } from 'lucide-react';
import {
  loadShortcutsConfig,
  saveShortcutsConfig,
  resetShortcutsToDefault,
  getDefaultShortcut,
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  ShortcutAction,
  ShortcutsConfig,
  ShortcutConflict,
  getAllConflicts,
  formatShortcutToTags,
} from '../utils/shortcuts';
import { ShortcutRecorderDialog } from './ShortcutRecorderDialog';
import { editorInsertCommands } from './TextoEditor/src/extension/registry';

function slashByAction(): Record<string, string> {
  const map: Record<string, string> = {
    heading_1: '/h1', heading_2: '/h2', heading_3: '/h3',
    heading_4: '/h4', heading_5: '/h5', heading_6: '/h6',
    bullet_list: '/ul', ordered_list: '/ol', task_list: '/task',
    code_block: '/code', blockquote: '/quote', horizontal_rule: '/hr',
    image: '/image', link: '/link',
  };
  for (const cmd of editorInsertCommands()) map[cmd.id] = `/${cmd.keyword}`;
  return map;
}

interface ShortcutSettingsProps {
  onConfigChange?: (config: ShortcutsConfig) => void;
}

/**
 * 快捷键设置组件
 */
export function ShortcutSettings({ onConfigChange }: ShortcutSettingsProps) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<ShortcutsConfig>(loadShortcutsConfig());
  const [conflicts, setConflicts] = useState<Map<string, ShortcutConflict[]>>(new Map());
  const [copiedSlashKey, setCopiedSlashKey] = useState<string | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const [recordingActionId, setRecordingActionId] = useState<string | null>(null);

  // 加载配置时检测冲突
  useEffect(() => {
    const allConflicts = getAllConflicts(config);
    setConflicts(allConflicts);
  }, [config]);

  // 通知父组件配置变化
  useEffect(() => {
    onConfigChange?.(config);
  }, [config, onConfigChange]);

  /**
   * 清除快捷键
   */
  const clearShortcut = useCallback(async (actionId: string) => {
    const newConfig: ShortcutsConfig = {
      ...config,
      shortcuts: {
        ...config.shortcuts,
        [actionId]: null,
      },
    };
    setConfig(newConfig);
    await saveShortcutsConfig(newConfig);
  }, [config]);

  /**
   * 单个快捷键重置为默认值
   */
  const resetSingleShortcut = useCallback(async (actionId: string) => {
    const defaultShortcut = getDefaultShortcut(actionId);
    const newConfig: ShortcutsConfig = {
      ...config,
      shortcuts: {
        ...config.shortcuts,
        [actionId]: defaultShortcut,
      },
    };
    setConfig(newConfig);
    await saveShortcutsConfig(newConfig);
  }, [config]);

  const hasChanges = useMemo(() => {
    const defaults = DEFAULT_SHORTCUTS;
    const current = config.shortcuts;
    for (const key of Object.keys(defaults)) {
      if (current[key] !== defaults[key]) return true;
    }
    for (const key of Object.keys(current)) {
      if (!(key in defaults) && current[key] !== null) return true;
    }
    return false;
  }, [config]);

  /**
   * 重置为默认值
   */
  const handleReset = useCallback(async () => {
    const confirmed = await window.confirm(t('shortcuts.resetConfirm'));
    if (confirmed) {
      const defaultConfig = resetShortcutsToDefault();
      setConfig(defaultConfig);
      await saveShortcutsConfig(defaultConfig);
    }
  }, [t]);

  /**
   * 按分类分组显示动作
   */
  const groupedActions = SHORTCUT_ACTIONS.reduce((groups, action) => {
    const group = groups[action.category] || [];
    group.push(action);
    groups[action.category] = group;
    return groups;
  }, {} as Record<string, ShortcutAction[]>);

  const categoryNames: Record<string, string> = {
    file: t('shortcuts.categoryFile'),
    edit: t('shortcuts.categoryEdit'),
    view: t('shortcuts.categoryView'),
    paragraph: t('shortcuts.categoryParagraph'),
    format: t('shortcuts.categoryFormat'),
    window: t('shortcuts.categoryWindow'),
    help: t('shortcuts.categoryHelp'),
  };

  const slashMap = slashByAction();

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const handleCopySlash = useCallback(async (keyword: string) => {
    try {
      await navigator.clipboard.writeText(keyword);
      setCopiedSlashKey(keyword);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopiedSlashKey(null), 600);
    } catch {
      // ignore
    }
  }, []);

  return (
    <div className="shortcut-settings">
      <div className="shortcut-categories">
        {Object.entries(groupedActions).map(([category, actions]) => {
          if (actions.length === 0) return null;

          return (
            <div key={category} className="shortcut-category">
              <h4>{categoryNames[category] || category}</h4>
              <div className="shortcut-list">
                {actions.map((action) => {
                  const currentShortcut = config.shortcuts[action.id];
                  const defaultShortcut = getDefaultShortcut(action.id);
                  const actionConflicts = conflicts.get(action.id);
                  const isEdited = currentShortcut !== defaultShortcut;
                  const slashKeyword = slashMap[action.id];

                  return (
                    <div
                      key={action.id}
                      className={`shortcut-item${actionConflicts ? ' has-conflict' : ''}`}
                    >
                      <div className="shortcut-info">
                        <span className="shortcut-name">{t(action.name)}</span>
                        <span className="shortcut-description">
                          {t(action.description)}
                        </span>
                      </div>

                      <span className="slash-column">
                        {slashKeyword && (
                          <button
                            className={`slash-command-tag${copiedSlashKey === slashKeyword ? ' copied' : ''}`}
                            onClick={() => handleCopySlash(slashKeyword)}
                            title={t('shortcuts.clickToCopy')}
                          >
                            {copiedSlashKey === slashKeyword ? t('codeBlock.copied') : slashKeyword}
                          </button>
                        )}
                      </span>

                      <div className="shortcut-right">
                        <span
                          className={`shortcut-key${actionConflicts ? ' conflict' : ''}${action.builtIn ? ' built-in' : ''}`}
                          onClick={action.builtIn ? undefined : () => setRecordingActionId(action.id)}
                          title={action.builtIn ? t('shortcuts.builtIn') : t('shortcuts.clickToEdit')}
                        >
                          {currentShortcut ? (
                            <>
                              {formatShortcutToTags(currentShortcut).map((tag, index) => (
                                <Kbd key={index} className="shortcut-tag">{tag}</Kbd>
                              ))}
                            </>
                          ) : (
                            <span className="shortcut-not-set">{t('shortcuts.notSet')}</span>
                          )}
                        </span>
                        <span className="shortcut-actions">
                          {action.builtIn ? (
                            <span className="shortcut-action-btn placeholder" />
                          ) : currentShortcut && !isEdited ? (
                            <button
                              onClick={() => clearShortcut(action.id)}
                              className="shortcut-action-btn clear"
                              title={t('shortcuts.clearShortcut')}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          ) : isEdited ? (
                            <button
                              onClick={() => resetSingleShortcut(action.id)}
                              className="shortcut-action-btn reset"
                              title={t('shortcuts.resetToDefaultSingle')}
                            >
                              <RotateCcw className="h-3 w-3" />
                            </button>
                          ) : null}
                        </span>
                      </div>

                      {actionConflicts && (
                        <div className="shortcut-conflict-hint">
                          {t('shortcuts.conflictWith')}{' '}
                          {actionConflicts.map((c) => t(c.actionName)).join('、')}{' '}
                          {t('shortcuts.conflict')}
                        </div>
                      )}
                    </div>
                  );
                })}
                {category === 'paragraph' && slashMap.link && (
                  <div className="shortcut-item">
                    <div className="shortcut-info">
                      <span className="shortcut-name">{t('slash.link')}</span>
                    </div>
                    <span className="slash-column">
                      <button
                        className={`slash-command-tag${copiedSlashKey === '/link' ? ' copied' : ''}`}
                        onClick={() => handleCopySlash('/link')}
                        title={t('shortcuts.clickToCopy')}
                      >
                        {copiedSlashKey === '/link' ? t('codeBlock.copied') : '/link'}
                      </button>
                    </span>
                    <div className="shortcut-right">
                      <span className="shortcut-key is-na">
                        <Kbd className="shortcut-tag is-na">—</Kbd>
                      </span>
                      <span className="shortcut-actions">
                        <button className="shortcut-action-btn" disabled aria-hidden="true" tabIndex={-1} style={{ visibility: 'hidden' }}><X className="h-3 w-3" /></button>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="shortcut-settings-footer">
        {conflicts.size > 0 && (
          <div className="shortcut-conflicts-warning">
            <strong>⚠️ {t('shortcuts.conflictWarning')}</strong>
            <p>{t('shortcuts.conflictDesc')}</p>
          </div>
        )}
        <Button variant="outline" onClick={handleReset} disabled={!hasChanges}>
          {t('shortcuts.resetToDefault')}
        </Button>
      </div>
      <ShortcutRecorderDialog
        actionId={recordingActionId}
        config={config}
        onClose={() => setRecordingActionId(null)}
        onSave={(newConfig) => {
          setConfig(newConfig);
          setRecordingActionId(null);
        }}
      />
    </div>
  );
}
