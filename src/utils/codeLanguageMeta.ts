export interface CodeLanguageMeta {
  value: string;
  label: string;
  alias: string[];
}

export const CODE_LANGUAGE_META: CodeLanguageMeta[] = [
  { value: '', label: 'Plain Text', alias: ['text', 'plain', 'plaintext'] },
  { value: 'javascript', label: 'JavaScript', alias: ['js', 'jsx', 'javascript'] },
  { value: 'typescript', label: 'TypeScript', alias: ['ts', 'tsx', 'typescript'] },
  { value: 'python', label: 'Python', alias: ['py', 'python'] },
  { value: 'markdown', label: 'Markdown', alias: ['md', 'markdown'] },
  { value: 'go', label: 'Go', alias: ['go', 'golang'] },
  { value: 'json', label: 'JSON', alias: ['json'] },
  { value: 'css', label: 'CSS', alias: ['css'] },
  { value: 'html', label: 'HTML', alias: ['html', 'htm'] },
  { value: 'rust', label: 'Rust', alias: ['rs', 'rust'] },
  { value: 'sql', label: 'SQL', alias: ['sql'] },
  { value: 'xml', label: 'XML', alias: ['xml'] },
  { value: 'yaml', label: 'YAML', alias: ['yaml', 'yml'] },
  { value: 'java', label: 'Java', alias: ['java'] },
  { value: 'cpp', label: 'C++', alias: ['cpp', 'c++', 'cc', 'cxx', 'c'] },
  { value: 'php', label: 'PHP', alias: ['php'] },
  { value: 'sass', label: 'Sass/SCSS', alias: ['sass', 'scss'] },
  { value: 'angular', label: 'Angular', alias: ['angular'] },
  { value: 'shell', label: 'Shell/Bash', alias: ['shell', 'bash', 'sh'] },
  { value: 'csharp', label: 'C#', alias: ['csharp', 'cs'] },
  { value: 'ruby', label: 'Ruby', alias: ['ruby', 'rb'] },
  { value: 'swift', label: 'Swift', alias: ['swift'] },
  { value: 'kotlin', label: 'Kotlin', alias: ['kotlin', 'kt'] },
  { value: 'lua', label: 'Lua', alias: ['lua'] },
  { value: 'toml', label: 'TOML', alias: ['toml'] },
  { value: 'diff', label: 'Diff', alias: ['diff', 'patch', 'git-diff'] },
];

export const SPECIAL_LANGUAGES = [
  { value: 'math', label: 'Math' },
  { value: 'latex', label: 'LaTeX' },
  { value: 'mermaid', label: 'Mermaid' },
];

export function getAllLanguageOptions(): { value: string; label: string }[] {
  return [
    ...CODE_LANGUAGE_META.map(lang => ({ value: lang.value, label: lang.label })),
    ...SPECIAL_LANGUAGES,
  ];
}

export function getLanguageConfig(lang: string): CodeLanguageMeta | undefined {
  const lowerLang = lang.toLowerCase().trim();
  return CODE_LANGUAGE_META.find(
    l => l.value === lowerLang || l.alias.includes(lowerLang)
  );
}

export function isValidLanguage(lang: string): boolean {
  const lowerLang = lang.toLowerCase().trim();
  return CODE_LANGUAGE_META.some(
    l => l.value === lowerLang || l.alias.includes(lowerLang)
  );
}

export function isSpecialLanguage(lang: string): boolean {
  const lowerLang = lang.toLowerCase().trim();
  return SPECIAL_LANGUAGES.some(l => l.value === lowerLang);
}
