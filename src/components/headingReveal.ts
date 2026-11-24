/** 大纲点击「未加载块」的跳转入口：由 MarkdownEditor 注册。 */
export const revealHeadingRef: {
  current: ((line: number, text: string) => void) | null;
} = { current: null };
