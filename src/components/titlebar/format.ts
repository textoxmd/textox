/**
 * 文件信息卡片的格式化函数。
 *
 * 这一层刻意与 i18n / React / Tauri 解耦：缺失值统一返回 `null`，
 * 由组件决定用本地化的破折号还是别的占位文案。
 */

const SIZE_UNITS = ['KB', 'MB', 'GB', 'TB'] as const;

/** 字节数 → 「12.4 KB」。缺失或非法返回 null。 */
export function formatFileSize(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) {
    const rounded = Math.round(bytes);
    // 1023.7 B 四舍五入后是 1024 B，应进位成 1.0 KB。
    return rounded < 1024 ? `${rounded} B` : '1.0 KB';
  }

  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  let text = value.toFixed(decimalsFor(value));
  // 取整后可能正好撞到 1024（如 1023.96 KB），按显示值再进位一次。
  if (Number(text) >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
    value = Number(text) / 1024;
    unitIndex += 1;
    text = value.toFixed(decimalsFor(value));
  }
  return `${text} ${SIZE_UNITS[unitIndex]}`;
}

/** 三位数以上不带小数（123 KB），其余保留一位（12.4 KB）。阈值取 99.95 以对齐四舍五入。 */
function decimalsFor(value: number): number {
  return value >= 99.95 ? 0 : 1;
}

/** 换行符：含 CRLF 即判定为 CRLF，否则 LF。 */
export function detectNewline(content: string): 'CRLF' | 'LF' {
  return content.includes('\r\n') ? 'CRLF' : 'LF';
}

/**
 * 修改时间 → 「今天 09:32」/「昨天 18:04」/「11/10 18:04」。
 *
 * 月日走 locale 原生格式（分隔符与顺序随语言），今天/昨天用
 * `Intl.RelativeTimeFormat` 的 `numeric: 'auto'`，这样 15 种语言不必各加一条
 * i18n key。缺失返回 null。
 */
export function formatModifiedAt(
  mtimeMs: number | null | undefined,
  locale?: string,
  now: Date = new Date(),
): string | null {
  if (mtimeMs == null || !Number.isFinite(mtimeMs)) return null;
  const then = new Date(mtimeMs);
  if (Number.isNaN(then.getTime())) return null;

  // 用「本地日期换算成 UTC 时间戳」的方式取天数差，避免夏令时导致的 23/25 小时误差。
  const dayIndexOf = (date: Date) =>
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((dayIndexOf(now) - dayIndexOf(then)) / dayMs);

  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(then);

  // diffDays < 0 说明是未来时间（时钟偏差 / 网盘同步），交给 RelativeTimeFormat
  // 输出「明天」等比具体日期更可读。
  if (diffDays <= 1) {
    const day = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
      -diffDays,
      'day',
    );
    return `${day} ${time}`;
  }

  const date = new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
  }).format(then);
  return `${date} ${time}`;
}
