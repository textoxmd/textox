import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Copy, FileJson, RefreshCw, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { logger } from '@/utils/logger';

interface McpStatus {
  /** 配置里的开关（可能为开，但端口被占用导致没跑起来） */
  enabled: boolean;
  running: boolean;
  port: number;
  url: string;
  error: string | null;
}

const PORT_MIN = 1024;
const PORT_MAX = 65535;
/** 与 Rust 侧 `mcp::DEFAULT_PORT` 保持一致。 */
const DEFAULT_PORT = 38471;

function parsePort(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number.parseInt(text, 10);
  if (value < PORT_MIN || value > PORT_MAX) return null;
  return value;
}

/**
 * 设置 → 实验功能：MCP 服务开关 + 客户端配置（弹窗查看/复制，不再占独立侧边栏分类）。
 *
 * 状态以 Rust 侧的 `get_mcp_status` 为准（配置开关与监听状态可能不一致，
 * 例如端口被占用）；开关本身走 `set_config`，`set_config` 落盘后会即时启停服务。
 *
 * 端口是数字输入，改动不即时生效：编辑的只是草稿，点「应用」（或回车）
 * 才写配置并重启监听，避免边输入边换端口（例如删到一半的空值）；
 * 值偏离默认端口时旁边出现「恢复默认值」按钮。
 */
export function McpSettings() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [portText, setPortText] = useState('');
  const [configOpen, setConfigOpen] = useState(false);
  /** 上一次生效的端口：只在真正变化时覆盖草稿，避免无关刷新冲掉用户输入。 */
  const lastPortRef = useRef<number | null>(null);

  /** 拉取最新状态；返回它，便于调用方按「是否真的在跑」决定提示。 */
  const refreshStatus = useCallback(async (): Promise<McpStatus | null> => {
    try {
      const next = await invoke<McpStatus>('get_mcp_status');
      setStatus(next);
      return next;
    } catch (error) {
      logger.warn('[mcp] failed to read status', error);
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await invoke<{ mcp_enabled?: boolean; mcp_port?: number }>('get_config');
        if (!cancelled) {
          setEnabled(config.mcp_enabled === true);
          if (typeof config.mcp_port === 'number') setPortText(String(config.mcp_port));
        }
      } catch (error) {
        logger.warn('[mcp] failed to read config', error);
      }
      if (!cancelled) await refreshStatus();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshStatus]);

  useEffect(() => {
    const port = status?.port;
    if (typeof port !== 'number' || lastPortRef.current === port) return;
    lastPortRef.current = port;
    setPortText(String(port));
  }, [status?.port]);

  const writeEnabled = useCallback(
    async (next: boolean) => {
      setBusy(true);
      try {
        const config = await invoke<Record<string, unknown>>('get_config');
        await invoke('set_config', { config: { ...config, mcp_enabled: next } });
        setEnabled(next);
        const nextStatus = await refreshStatus();
        // 开关打开了但没起来（端口被占用等）：把真实原因说出来，别只提示成功。
        if (next && nextStatus?.enabled && !nextStatus.running) {
          toast.error(nextStatus.error ?? t('settings.mcp.toggleFailed'));
        }
      } catch (error) {
        logger.error('[mcp] failed to toggle server', error);
        toast.error(t('settings.mcp.toggleFailed'));
      } finally {
        setBusy(false);
      }
    },
    [refreshStatus, t],
  );

  /** 点「应用」/回车时才落盘：校验 1024–65535，落盘后由 Rust 侧重启监听。 */
  const applyPort = useCallback(async () => {
    const next = parsePort(portText);
    if (next === null) {
      toast.error(t('settings.mcp.portInvalid'));
      return;
    }
    if (next === status?.port) {
      setPortText(String(next));
      return;
    }
    setBusy(true);
    try {
      const config = await invoke<Record<string, unknown>>('get_config');
      await invoke('set_config', { config: { ...config, mcp_port: next } });
      setPortText(String(next));
      const nextStatus = await refreshStatus();
      // 端口改动后 Rust 会重启监听；只有真的在跑才算成功。
      if (nextStatus?.enabled && !nextStatus.running) {
        toast.error(nextStatus.error ?? t('settings.mcp.toggleFailed'));
      } else {
        toast.success(t('settings.mcp.portApplied'));
      }
    } catch (error) {
      logger.error('[mcp] failed to update port', error);
      toast.error(t('settings.mcp.toggleFailed'));
    } finally {
      setBusy(false);
    }
  }, [portText, refreshStatus, status?.port, t]);

  const copyText = useCallback(
    async (text: string, messageKey: string) => {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
        await navigator.clipboard.writeText(text);
        toast.success(t(messageKey));
      } catch (error) {
        logger.warn('[mcp] copy failed', error);
        toast.error(t('settings.mcp.copyFailed'));
      }
    },
    [t],
  );

  const url = status?.url ?? '';
  const configSnippet = JSON.stringify(
    {
      mcp: {
        servers: {
          textox: { type: 'remote', url, oauth: false },
        },
      },
    },
    null,
    2,
  );
  const running = status?.running === true;
  const appliedPort = status?.port;
  const portDirty = typeof appliedPort === 'number' && portText.trim() !== String(appliedPort);
  const canApplyPort = !busy && portDirty && parsePort(portText) !== null;
  /** 值偏离默认端口时给出「恢复默认值」入口（编辑中与已改成非默认端口后都可用）。 */
  const portDiffersFromDefault = portText.trim() !== String(DEFAULT_PORT);

  return (
    <>
      <div className="settings-item">
        <div className="settings-item-info">
          <span className="settings-item-label">{t('settings.mcp.title')}</span>
          <span className="settings-item-description">{t('settings.mcp.desc')}</span>
        </div>
        <Checkbox
          checked={enabled}
          disabled={busy}
          onCheckedChange={(checked) => void writeEnabled(checked === true)}
        />
      </div>

      <div className="settings-item">
        <div className="settings-item-info">
          <span className="settings-item-label">{t('settings.mcp.port')}</span>
          <span className="settings-item-description">{t('settings.mcp.portDesc')}</span>
        </div>
        <div className="flex items-center gap-2">
          {portDiffersFromDefault ? (
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              disabled={busy}
              title={t('settings.mcp.resetPort', { value: DEFAULT_PORT })}
              aria-label={t('settings.mcp.resetPort', { value: DEFAULT_PORT })}
              onClick={() => setPortText(String(DEFAULT_PORT))}
            >
              <RotateCcw />
            </Button>
          ) : (
            // 占位，避免图标出现/消失时输入框左右跳动。
            <span className="size-8 shrink-0" aria-hidden />
          )}
          <Input
            type="number"
            min={PORT_MIN}
            max={PORT_MAX}
            value={portText}
            disabled={busy}
            className="w-24 tabular-nums"
            onChange={(event) => setPortText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (canApplyPort) void applyPort();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                if (typeof appliedPort === 'number') setPortText(String(appliedPort));
              }
            }}
          />
          <Button
            variant="outline"
            disabled={!canApplyPort}
            onClick={() => void applyPort()}
          >
            {t('settings.mcp.apply')}
          </Button>
        </div>
      </div>

      <div className="settings-item">
        <div className="settings-item-info">
          <span className="settings-item-label">{t('settings.mcp.clientConfig')}</span>
          <span className="settings-item-description">{t('settings.mcp.clientConfigDesc')}</span>
        </div>
        <Button variant="outline" disabled={!url} onClick={() => setConfigOpen(true)}>
          <FileJson />
          {t('settings.mcp.viewConfig')}
        </Button>
      </div>

      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('settings.mcp.configDialogTitle')}</DialogTitle>
            <DialogDescription>{t('settings.mcp.clientConfigDesc')}</DialogDescription>
          </DialogHeader>
          <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
            {configSnippet}
          </pre>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => void copyText(configSnippet, 'settings.mcp.copiedConfig')}
            >
              <Copy />
              {t('settings.mcp.copyConfig')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="settings-item">
        <div className="settings-item-info">
          <span className="settings-item-label">{t('settings.mcp.status')}</span>
          <span className="settings-item-description flex items-center gap-2">
            <span
              className={`size-1.5 shrink-0 rounded-full ${running ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`}
            />
            <span>{running ? t('settings.mcp.running') : t('settings.mcp.stopped')}</span>
            {status?.error ? (
              <span className="truncate text-destructive" title={status.error}>
                {t('settings.mcp.error', { message: status.error })}
              </span>
            ) : null}
          </span>
        </div>
        {enabled && !running ? (
          <Button variant="outline" disabled={busy} onClick={() => void writeEnabled(true)}>
            <RefreshCw />
            {t('settings.mcp.retry')}
          </Button>
        ) : null}
      </div>
    </>
  );
}
