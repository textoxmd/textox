import type { FeatureSpecs } from "../_types.ts";

export const codeSpecs: FeatureSpecs = {
  name: "code",
  renderCases: {
    code: (children) => `<c>${children}</c>`,
  },
  cases: [
    {
      id: "backticks",
      label: "inline code via single backticks",
      seed: "",
      events: ["`", "1", "`", " "],
      checkpoints: [
        { at: 1, expect: "`|" },
        { at: 2, expect: "`1|" },
        { at: 3, expect: "<g>`</g><c>1</c><g>`</g>|" },
        { at: 4, expect: "<c>1</c> |" },
      ],
    },
    {
      id: "double-backtick-basic",
      label: "``x`` — double-backtick fence around plain content",
      seed: "",
      events: ["`", "`", "x", "`", "`", " "],
      checkpoints: [
        { at: 2, expect: "``|" },
        { at: 3, expect: "``x|" },
        // step 5: 2-backtick open + 2-backtick close → fence fires
        { at: 5, expect: "<g>``</g><c>x</c><g>``</g>|" },
        { at: 6, expect: "<c>x</c> |" },
      ],
    },
    {
      id: "double-backtick-embedded-backtick",
      label: "`` ` `` — double-backtick fence wrapping a single backtick",
      seed: "",
      events: ["`", "`", " ", "`", " ", "`", "`", " "],
      checkpoints: [
        { at: 1, expect: "`|" },
        { at: 2, expect: "``|" },
        { at: 3, expect: "`` |" },
        // step 4: `` `` ` `` — markdown-it requires the closing fence to match
        // the opener length, so the 1-char run cannot close the 2-char opener:
        // no code span yet (the old scanner paired across run lengths,
        // Typora-style). This matches `parse()` on load.
        { at: 4, expect: "`` `|" },
        // step 5: still unclosed.
        { at: 5, expect: "`` ` |" },
        // step 6: the space between two 1-char runs becomes a code span whose
        // content is that single space (CommonMark keeps all-space content).
        { at: 6, expect: "`` <g>`</g><c> </c><g>`</g>|" },
        // step 7: the 2-char close run that finally lands re-pairs with the
        // 2-char open run as a 2-char fence; the leading + trailing space
        // are soft ranges inside the span (visible since cursor is inside).
        { at: 7, expect: "<g>``</g> <c>`</c> <g>``</g>|" },
        // step 8: cursor moves past the new trailing space → outside span
        // → soft + delim hidden.
        { at: 8, expect: "<c>`</c> |" },
      ],
    },
  ],
};
