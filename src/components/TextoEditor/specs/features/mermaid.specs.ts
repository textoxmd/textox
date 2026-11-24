import type { FeatureSpecs } from "../_types.ts";

export const mermaidSpecs: FeatureSpecs = {
  name: "mermaid",
  renderCases: {
    "mermaid-block": (_children, el) => {
      const isRenderMode = el.classList.contains("render-mode");
      const isCodeMode = el.classList.contains("code-mode");
      const pre = el.querySelector("pre");
      const code = pre?.querySelector("code");
      const text = code ? (code as HTMLElement).textContent ?? "" : "";

      if (isRenderMode) {
        return `\`\`\`mermaid\n${text}\n\`\`\``;
      }
      if (isCodeMode && pre) {
        const lang = pre.getAttribute("data-lang") ?? "mermaid";
        return `\`\`\`${lang}\n${text}\n\`\`\``;
      }
      return `\`\`\`mermaid\n${text}\n\`\`\``;
    },
  },
  cases: [
    {
      id: "mermaid-fence-enter",
      label: "```mermaid + Enter → code_block with lang=mermaid",
      seed: "",
      events: ["`", "`", "`", "m", "e", "r", "m", "a", "i", "d", "<Enter>"],
      checkpoints: [
        { at: 11, expect: "```mermaid\n|\n```" },
      ],
    },
    {
      id: "mermaid-fence-enter-type",
      label: "after commit, typing works inside mermaid block",
      seed: "",
      events: ["`", "`", "`", "m", "e", "r", "m", "a", "i", "d", "<Enter>", "g", "r", "a", "p", "h", " ", "L", "R"],
      checkpoints: [
        { at: 12, expect: "```mermaid\ng|aph LR\n```" },
        { at: 16, expect: "```mermaid\ngraph LR|\n```" },
      ],
    },
    {
      id: "mermaid-empty-backspace",
      label: "Backspace on empty mermaid block removes it",
      seed: "",
      events: ["`", "`", "`", "m", "e", "r", "m", "a", "i", "d", "<Enter>", "<Backspace>"],
      checkpoints: [
        { at: 12, expect: "|" },
      ],
    },
  ],
};
