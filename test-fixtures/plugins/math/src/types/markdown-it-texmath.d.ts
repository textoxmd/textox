declare module 'markdown-it-texmath' {
  import { PluginWithOptions } from 'markdown-it';

  interface TexmathOptions {
    engine?: {
      renderToString(tex: string, options?: any): string;
    };
    delimiters?: 'dollars' | 'brackets' | 'gitlab' | 'julia' | 'kramdown';
    katexOptions?: any;
  }

  interface TexmathInlineRule {
    name: string;
    rex: RegExp;
    tmpl: string;
    tag: string;
    pre?: (src: string, outerSpace: boolean | undefined, pos: number) => boolean;
    post?: (src: string, outerSpace: boolean | undefined, pos: number) => boolean;
  }

  interface TexmathBlockRule {
    name: string;
    rex: RegExp;
    tmpl: string;
    tag: string;
    displayMode?: boolean;
  }

  // `texmath.rules` / `texmath.inline` 是库的公开扩展点（其自带测试即如此使用），
  // 供只取某个 delimiter 的一部分规则时使用。
  const texmath: PluginWithOptions<TexmathOptions> & {
    rules: Record<string, { inline: TexmathInlineRule[]; block: TexmathBlockRule[] }>;
    inline(rule: TexmathInlineRule): (state: any, silent: boolean) => boolean;
  };
  export default texmath;
}
