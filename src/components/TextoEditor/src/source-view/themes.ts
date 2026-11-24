import { EditorView } from '@codemirror/view';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { oneDark } from '@codemirror/theme-one-dark';
import type { Extension } from '@codemirror/state';

function createSyntaxTheme(colors: Record<string, string>, options?: { dark?: boolean }): Extension {
  const rules: { tag: import('@lezer/highlight').Tag; color?: string; fontStyle?: string; fontWeight?: string; textDecoration?: string }[] = []
  const add = (tag: import('@lezer/highlight').Tag, key: string, extra?: { fontStyle?: string; fontWeight?: string; textDecoration?: string }) => {
    const c = colors[key]
    if (c) rules.push({ tag, color: c, ...extra })
  }
  add(tags.keyword, 'keyword')
  add(tags.string, 'string')
  add(tags.number, 'number')
  add(tags.comment, 'comment', { fontStyle: 'italic' })
  add(tags.variableName, 'variableName')
  add(tags.typeName, 'typeName')
  add(tags.operator, 'operator')
  add(tags.tagName, 'tagName')
  add(tags.attributeName, 'attributeName')
  add(tags.regexp, 'regexp')
  add(tags.inserted, 'inserted')
  add(tags.deleted, 'deleted')
  add(tags.atom, 'number')
  add(tags.meta, 'comment')
  add(tags.className, 'typeName')
  add(tags.propertyName, 'attributeName')
  add(tags.heading, 'heading', { fontWeight: 'bold' })
  add(tags.emphasis, 'emphasis', { fontStyle: 'italic' })
  add(tags.strong, 'strong', { fontWeight: 'bold' })
  add(tags.link, 'link')
  add(tags.url, 'url')
  add(tags.monospace, 'code')
  add(tags.quote, 'quote')
  add(tags.list, 'list')
  add(tags.escape, 'escape')
  add(tags.contentSeparator, 'contentSeparator')
  add(tags.strikethrough, 'strikethrough', { textDecoration: 'line-through' })
  return [
    EditorView.theme({}, { dark: options?.dark }),
    syntaxHighlighting(HighlightStyle.define(rules)),
  ]
}

const SOURCE_THEME_MAP: Record<string, Extension> = {
  oneDark: oneDark,

  // 亮色主题
  githubLight: createSyntaxTheme({
    keyword: '#d73a49', string: '#032f62', number: '#005cc5',
    comment: '#6a737d', variableName: '#e36209', typeName: '#005cc5',
    operator: '#d73a49', tagName: '#22863a', attributeName: '#6f42c1',
    regexp: '#032f62', inserted: '#22863a', deleted: '#d73a49',
    heading: '#d73a49', link: '#0366d6', url: '#0366d6',
    code: '#032f62', quote: '#6a737d', list: '#6a737d',
    strikethrough: '#6a737d', contentSeparator: '#6a737d', escape: '#d73a49',
  }, { dark: false }),
  xcodeLight: createSyntaxTheme({
    keyword: '#9a1e50', string: '#c41a16', number: '#1c00cf',
    comment: '#267507', variableName: '#326d74', typeName: '#5b4a9c',
    operator: '#9a1e50', tagName: '#9a1e50', attributeName: '#5b4a9c',
    regexp: '#c41a16', inserted: '#267507', deleted: '#c41a16',
    heading: '#9a1e50', link: '#1c00cf', url: '#1c00cf',
    code: '#c41a16', quote: '#267507', list: '#267507',
    strikethrough: '#267507', contentSeparator: '#267507', escape: '#9a1e50',
  }, { dark: false }),
  eclipse: createSyntaxTheme({
    keyword: '#7f0055', string: '#2a00ff', number: '#000000',
    comment: '#3f7f5f', variableName: '#000000', typeName: '#7f0055',
    operator: '#000000', tagName: '#7f0055', attributeName: '#7f0055',
    regexp: '#2a00ff', inserted: '#3f7f5f', deleted: '#7f0055',
    heading: '#7f0055', link: '#2a00ff', url: '#2a00ff',
    code: '#2a00ff', quote: '#3f7f5f', list: '#3f7f5f',
    strikethrough: '#3f7f5f', contentSeparator: '#3f7f5f', escape: '#7f0055',
  }, { dark: false }),
  basicLight: createSyntaxTheme({
    keyword: '#0000ff', string: '#a31515', number: '#098658',
    comment: '#008000', variableName: '#001080', typeName: '#0000ff',
    operator: '#000000', tagName: '#800000', attributeName: '#ff0000',
    regexp: '#a31515', inserted: '#098658', deleted: '#a31515',
    heading: '#0000ff', link: '#0000ff', url: '#0000ff',
    code: '#a31515', quote: '#008000', list: '#008000',
    strikethrough: '#008000', contentSeparator: '#008000', escape: '#0000ff',
  }, { dark: false }),
  tokyoNightDay: createSyntaxTheme({
    keyword: '#8c4351', string: '#485e30', number: '#8b5c2e',
    comment: '#8a8a8a', variableName: '#166775', typeName: '#8c4351',
    operator: '#8c4351', tagName: '#8c4351', attributeName: '#5a4a78',
    regexp: '#485e30', inserted: '#485e30', deleted: '#8c4351',
    heading: '#8c4351', link: '#166775', url: '#166775',
    code: '#485e30', quote: '#8a8a8a', list: '#8a8a8a',
    strikethrough: '#8a8a8a', contentSeparator: '#8a8a8a', escape: '#8c4351',
  }, { dark: false }),
  bbedit: createSyntaxTheme({
    keyword: '#0000ff', string: '#c41a16', number: '#1c00cf',
    comment: '#267507', variableName: '#000000', typeName: '#5b4a9c',
    operator: '#000000', tagName: '#9a1e50', attributeName: '#5b4a9c',
    regexp: '#c41a16', inserted: '#267507', deleted: '#c41a16',
    heading: '#0000ff', link: '#1c00cf', url: '#1c00cf',
    code: '#c41a16', quote: '#267507', list: '#267507',
    strikethrough: '#267507', contentSeparator: '#267507', escape: '#0000ff',
  }, { dark: false }),
  solarizedLight: createSyntaxTheme({
    keyword: '#859900', string: '#2aa198', number: '#d33682',
    comment: '#93a1a1', variableName: '#268bd2', typeName: '#b58900',
    operator: '#859900', tagName: '#268bd2', attributeName: '#b58900',
    regexp: '#cb4b16', inserted: '#859900', deleted: '#dc322f',
    heading: '#859900', link: '#268bd2', url: '#268bd2',
    code: '#2aa198', quote: '#93a1a1', list: '#93a1a1',
    strikethrough: '#93a1a1', contentSeparator: '#93a1a1', escape: '#859900',
  }, { dark: false }),

  // 暗色主题
  materialDark: createSyntaxTheme({
    keyword: '#c792ea', string: '#c3e88d', number: '#f78c6c',
    comment: '#546e7a', variableName: '#82aaff', typeName: '#ffcb6b',
    operator: '#89ddff', tagName: '#f07178', attributeName: '#c792ea',
    regexp: '#89ddff', inserted: '#c3e88d', deleted: '#f07178',
    heading: '#c792ea', link: '#82aaff', url: '#82aaff',
    code: '#c3e88d', quote: '#546e7a', list: '#546e7a',
    strikethrough: '#546e7a', contentSeparator: '#546e7a', escape: '#c792ea',
  }, { dark: true }),
  githubDark: createSyntaxTheme({
    keyword: '#f97583', string: '#9ecbff', number: '#79b8ff',
    comment: '#6a737d', variableName: '#ffab70', typeName: '#79b8ff',
    operator: '#f97583', tagName: '#85e89d', attributeName: '#b392f0',
    regexp: '#9ecbff', inserted: '#85e89d', deleted: '#f97583',
    heading: '#f97583', link: '#79b8ff', url: '#79b8ff',
    code: '#9ecbff', quote: '#6a737d', list: '#6a737d',
    strikethrough: '#6a737d', contentSeparator: '#6a737d', escape: '#f97583',
  }, { dark: true }),
  dracula: createSyntaxTheme({
    keyword: '#ff79c6', string: '#f1fa8c', number: '#bd93f9',
    comment: '#6272a4', variableName: '#50fa7b', typeName: '#8be9fd',
    operator: '#ff79c6', tagName: '#ff79c6', attributeName: '#50fa7b',
    regexp: '#f1fa8c', inserted: '#50fa7b', deleted: '#ff5555',
    heading: '#ff79c6', link: '#8be9fd', url: '#8be9fd',
    code: '#f1fa8c', quote: '#6272a4', list: '#6272a4',
    strikethrough: '#6272a4', contentSeparator: '#6272a4', escape: '#ff79c6',
  }, { dark: true }),
  atomone: createSyntaxTheme({
    keyword: '#c678dd', string: '#98c379', number: '#d19a66',
    comment: '#5c6370', variableName: '#e06c75', typeName: '#e5c07b',
    operator: '#56b6c2', tagName: '#e06c75', attributeName: '#d19a66',
    regexp: '#98c379', inserted: '#98c379', deleted: '#e06c75',
    heading: '#c678dd', link: '#61afef', url: '#61afef',
    code: '#98c379', quote: '#5c6370', list: '#5c6370',
    strikethrough: '#5c6370', contentSeparator: '#5c6370', escape: '#c678dd',
  }, { dark: true }),
  vscodeDark: createSyntaxTheme({
    keyword: '#569cd6', string: '#ce9178', number: '#b5cea8',
    comment: '#6a9955', variableName: '#9cdcfe', typeName: '#4ec9b0',
    operator: '#d4d4d4', tagName: '#569cd6', attributeName: '#9cdcfe',
    regexp: '#d16969', inserted: '#b5cea8', deleted: '#f44747',
    heading: '#569cd6', link: '#6fc1fa', url: '#6fc1fa',
    code: '#ce9178', quote: '#6a9955', list: '#6a9955',
    strikethrough: '#6a9955', contentSeparator: '#6a9955', escape: '#569cd6',
  }, { dark: true }),
  xcodeDark: createSyntaxTheme({
    keyword: '#ff7ab2', string: '#fc6a5d', number: '#d0bf69',
    comment: '#7f8c98', variableName: '#b281eb', typeName: '#5bc9f3',
    operator: '#ff7ab2', tagName: '#ff7ab2', attributeName: '#b281eb',
    regexp: '#fc6a5d', inserted: '#a8c023', deleted: '#fc6a5d',
    heading: '#ff7ab2', link: '#5bc9f3', url: '#5bc9f3',
    code: '#fc6a5d', quote: '#7f8c98', list: '#7f8c98',
    strikethrough: '#7f8c98', contentSeparator: '#7f8c98', escape: '#ff7ab2',
  }, { dark: true }),
  sublime: createSyntaxTheme({
    keyword: '#f92672', string: '#e6db74', number: '#ae81ff',
    comment: '#75715e', variableName: '#a6e22e', typeName: '#66d9ef',
    operator: '#f92672', tagName: '#f92672', attributeName: '#a6e22e',
    regexp: '#e6db74', inserted: '#a6e22e', deleted: '#f92672',
    heading: '#f92672', link: '#66d9ef', url: '#66d9ef',
    code: '#e6db74', quote: '#75715e', list: '#75715e',
    strikethrough: '#75715e', contentSeparator: '#75715e', escape: '#f92672',
  }, { dark: true }),
}

export function getThemeExtension(themeName: string): Extension[] {
  const ext = SOURCE_THEME_MAP[themeName]
  if (ext) return [ext]
  // 未知主题：根据当前外观回退到默认
  const isDark = document.documentElement.classList.contains('dark')
  const fallback = isDark ? 'vscodeDark' : 'githubLight'
  return [SOURCE_THEME_MAP[fallback]]
}
