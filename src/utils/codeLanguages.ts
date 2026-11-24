import { Extension } from '@codemirror/state';
import { Language, LanguageSupport } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { go } from '@codemirror/lang-go';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { rust } from '@codemirror/lang-rust';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { php } from '@codemirror/lang-php';
import { sass } from '@codemirror/lang-sass';
import { angular } from '@codemirror/lang-angular';
import { StreamLanguage } from '@codemirror/language';
import { csharp, kotlin } from '@codemirror/legacy-modes/mode/clike';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { diff } from '@codemirror/legacy-modes/mode/diff';

import { CODE_LANGUAGE_META } from './codeLanguageMeta';

export interface CodeLanguageConfig {
  value: string;
  label: string;
  alias: string[];
  getLanguage: () => Language | null;
}

function getLanguageFromSupport(support: LanguageSupport | Extension[]): Language | null {
  if (Array.isArray(support)) {
    return null;
  }
  return support.language;
}

export const CODE_LANGUAGES: CodeLanguageConfig[] = CODE_LANGUAGE_META.map(meta => {
  let getLanguage: () => Language | null;

  switch (meta.value) {
    case '':
      getLanguage = () => null;
      break;
    case 'javascript':
      getLanguage = () => getLanguageFromSupport(javascript());
      break;
    case 'typescript':
      getLanguage = () => getLanguageFromSupport(javascript({ typescript: true }));
      break;
    case 'python':
      getLanguage = () => getLanguageFromSupport(python());
      break;
    case 'markdown':
      getLanguage = () => getLanguageFromSupport(markdown());
      break;
    case 'go':
      getLanguage = () => getLanguageFromSupport(go());
      break;
    case 'json':
      getLanguage = () => getLanguageFromSupport(json());
      break;
    case 'css':
      getLanguage = () => getLanguageFromSupport(css());
      break;
    case 'html':
      getLanguage = () => getLanguageFromSupport(html());
      break;
    case 'rust':
      getLanguage = () => getLanguageFromSupport(rust());
      break;
    case 'sql':
      getLanguage = () => getLanguageFromSupport(sql());
      break;
    case 'xml':
      getLanguage = () => getLanguageFromSupport(xml());
      break;
    case 'yaml':
      getLanguage = () => getLanguageFromSupport(yaml());
      break;
    case 'java':
      getLanguage = () => getLanguageFromSupport(java());
      break;
    case 'cpp':
      getLanguage = () => getLanguageFromSupport(cpp());
      break;
    case 'php':
      getLanguage = () => getLanguageFromSupport(php());
      break;
    case 'sass':
      getLanguage = () => getLanguageFromSupport(sass());
      break;
    case 'angular':
      getLanguage = () => getLanguageFromSupport(angular());
      break;
    default:
      getLanguage = () => null;
      break;
  }

  return { ...meta, getLanguage };
});

export function getLanguageExtension(lang: string): Extension[] {
  const lowerLang = lang.toLowerCase().trim();

  switch (lowerLang) {
    case 'shell':
    case 'bash':
    case 'sh':
      return [StreamLanguage.define(shell).extension];
    case 'csharp':
    case 'cs':
      return [StreamLanguage.define(csharp).extension];
    case 'ruby':
    case 'rb':
      return [StreamLanguage.define(ruby).extension];
    case 'swift':
      return [StreamLanguage.define(swift).extension];
    case 'kotlin':
    case 'kt':
      return [StreamLanguage.define(kotlin).extension];
    case 'lua':
      return [StreamLanguage.define(lua).extension];
    case 'toml':
      return [StreamLanguage.define(toml).extension];
    case 'diff':
    case 'patch':
    case 'git-diff':
      return [StreamLanguage.define(diff).extension];
  }

  const found = CODE_LANGUAGES.find(
    l => l.value === lowerLang || l.alias.includes(lowerLang)
  );

  if (!found || !found.getLanguage) {
    return [];
  }

  const language = found.getLanguage();
  return language ? [language.extension] : [];
}

export function getLanguageSupport(lang: string): Language | null {
  const lowerLang = lang.toLowerCase().trim();

  const found = CODE_LANGUAGES.find(
    l => l.value === lowerLang || l.alias.includes(lowerLang)
  );

  return found && found.getLanguage ? found.getLanguage() : null;
}
