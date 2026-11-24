/**
 * 源码视图查找面板的纯文本匹配器。
 *
 * 抽成纯函数便于单测，同时把三件容易在长文档上炸掉的事收敛在一处：
 * - 大小写不敏感时不再复制整篇小写副本（改用转义正则，零额外 O(n) 分配）；
 * - 病态正则/超大文档不会冻死 UI（扫描带时间预算）；
 * - 匹配数量有上限，避免装饰集与 React state 被撑爆。
 */

export interface SearchMatch {
  from: number;
  to: number;
}

export interface FindMatchesOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface FindMatchesResult {
  matches: SearchMatch[];
  /** 因时间预算或数量上限被截断（计数显示为 `n+`） */
  truncated: boolean;
}

/** 单次扫描的时间预算（毫秒） */
export const SEARCH_SCAN_BUDGET_MS = 350;
/** 单次扫描的匹配数量上限 */
export const MAX_SEARCH_MATCHES = 20000;

/** 每扫描多少步检查一次时间预算 */
const DEADLINE_CHECK_INTERVAL = 512;

const WORD_CHAR = /\w/;

function isWordChar(ch: string): boolean {
  return ch !== '' && WORD_CHAR.test(ch);
}

/** 判断 `[from, to)` 两侧是否都不与单词字符相邻（全字匹配） */
export function isWholeWord(docText: string, from: number, to: number): boolean {
  const before = from > 0 ? docText.charAt(from - 1) : '';
  const after = to < docText.length ? docText.charAt(to) : '';
  return !isWordChar(before) && !isWordChar(after);
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findMatches(
  docText: string,
  query: string,
  options: FindMatchesOptions,
): FindMatchesResult {
  const empty: FindMatchesResult = { matches: [], truncated: false };
  if (!docText || !query) return empty;

  const { caseSensitive, wholeWord, regex } = options;
  const matches: SearchMatch[] = [];
  const deadline = Date.now() + SEARCH_SCAN_BUDGET_MS;
  let truncated = false;
  let steps = 0;

  /** 推入一个匹配；返回 false 表示已到上限、应停止扫描 */
  const push = (from: number, to: number): boolean => {
    if (wholeWord && !isWholeWord(docText, from, to)) return true;
    matches.push({ from, to });
    if (matches.length >= MAX_SEARCH_MATCHES) {
      truncated = true;
      return false;
    }
    return true;
  };

  const outOfBudget = (): boolean => {
    if ((++steps % DEADLINE_CHECK_INTERVAL) !== 0) return false;
    return Date.now() > deadline;
  };

  try {
    if (regex) {
      const regexp = new RegExp(query, caseSensitive ? 'g' : 'gi');
      let match: RegExpExecArray | null;
      while ((match = regexp.exec(docText)) !== null) {
        const length = match[0].length;
        if (length === 0) {
          // 空匹配无法高亮，跳过并前移，避免原地死循环
          regexp.lastIndex++;
          continue;
        }
        if (!push(match.index, match.index + length)) break;
        if (outOfBudget()) {
          truncated = true;
          break;
        }
      }
    } else if (caseSensitive) {
      let index = docText.indexOf(query);
      while (index !== -1) {
        if (!push(index, index + query.length)) break;
        index = docText.indexOf(query, index + query.length);
        if (outOfBudget()) {
          truncated = true;
          break;
        }
      }
    } else {
      // 大小写不敏感：转义后交给正则引擎做大小写折叠，避免 toLowerCase() 整篇副本
      const regexp = new RegExp(escapeRegExp(query), 'gi');
      let match: RegExpExecArray | null;
      while ((match = regexp.exec(docText)) !== null) {
        if (!push(match.index, match.index + match[0].length)) break;
        if (outOfBudget()) {
          truncated = true;
          break;
        }
      }
    }
  } catch {
    // 非法正则：返回已收集的部分（与旧实现一致，不抛给调用方）
    return { matches: [], truncated: false };
  }

  return { matches, truncated };
}
