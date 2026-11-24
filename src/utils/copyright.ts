export const COPYRIGHT_START_YEAR = 2024;

/**
 * 生成版权年份标签：起始年份与当前年份相同则只显示一年，
 * 否则显示区间（如 2024-2026），避免每年手动更新。
 */
export function getCopyrightYearLabel(): string {
  const currentYear = new Date().getFullYear();
  return currentYear > COPYRIGHT_START_YEAR
    ? `${COPYRIGHT_START_YEAR}-${currentYear}`
    : String(COPYRIGHT_START_YEAR);
}
