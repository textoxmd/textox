import type { FeatureSpecs } from "../_types.ts";

export const emphasisSpecs: FeatureSpecs = {
  name: "emphasis",
  renderCases: {
    em: (children) => `<i>${children}</i>`,
    i: (children) => `<i>${children}</i>`,
    strong: (children) => `<b>${children}</b>`,
    b: (children) => `<b>${children}</b>`,
  },
  cases: [
    {
      id: "asterisks",
      label: "italic via single asterisks",
      seed: "",
      events: ["*", "1", "*", " "],
      checkpoints: [
        { at: 1, expect: "*|" },
        { at: 2, expect: "*1|" },
        { at: 3, expect: "<g>*</g><i>1</i><g>*</g>|" },
        { at: 4, expect: "<i>1</i> |" },
      ],
    },
    {
      id: "double-asterisks",
      label: "bold via double asterisks",
      seed: "",
      events: ["*", "*", "1", "*", "*", " "],
      checkpoints: [
        { at: 2, expect: "**|" },
        { at: 3, expect: "**1|" },
        // step 4: `**1*` — CommonMark reads the leading `*` as literal text
        // and the last `*` as the opener's partner, so the em covers `1` only.
        // The old delimiter scanner paired the *adjacent* run instead (em on
        // `*1`); the locator follows markdown-it, which is what `parse()`
        // already produces on load, so the live path now agrees with it.
        { at: 4, expect: "*<g>*</g><i>1</i><g>*</g>|" },
        { at: 5, expect: "<g>**</g><b>1</b><g>**</g>|" },
        { at: 6, expect: "<b>1</b> |" },
      ],
    },
    {
      id: "underscores",
      label: "italic via single underscores",
      seed: "",
      events: ["_", "1", "_", " "],
      checkpoints: [
        { at: 1, expect: "_|" },
        { at: 2, expect: "_1|" },
        { at: 3, expect: "<g>_</g><i>1</i><g>_</g>|" },
        { at: 4, expect: "<i>1</i> |" },
      ],
    },
    {
      id: "double-underscores",
      label: "bold via double underscores",
      seed: "",
      events: ["_", "_", "1", "_", "_", " "],
      checkpoints: [
        { at: 2, expect: "__|" },
        { at: 3, expect: "__1|" },
        // step 4: same CommonMark reading as `**1*` above — literal `_` +
        // em on `1` (the old scanner produced em on `_1`).
        { at: 4, expect: "_<g>_</g><i>1</i><g>_</g>|" },
        { at: 5, expect: "<g>__</g><b>1</b><g>__</g>|" },
        { at: 6, expect: "<b>1</b> |" },
      ],
    },
    {
      id: "two-groups-underscore",
      label: "_em_ __strong__ — two independent underscore groups",
      seed: "",
      events: ["_","e","m","_"," ","_","_","s","t","r","o","n","g","_","_"," "],
      checkpoints: [
        { at: 16, expect: "<i>em</i> <b>strong</b> |" },
      ],
    },
    {
      id: "underscore-inside-word",
      label: "foo_bar_baz — underscore inside a word does not fire",
      seed: "",
      events: ["f", "o", "o", "_", "b", "a", "r", "_", "b", "a", "z"],
      checkpoints: [{ at: 11, expect: "foo_bar_baz|" }],
    },
    {
      id: "triple-asterisks-stable",
      label: "***1*** stable — em wrapping strong",
      seed: "***1*** ",
      events: [],
      checkpoints: [{ at: 0, expect: "<i><b>1</b></i> |" }],
    },
    {
      id: "triple-asterisks-typing",
      label: "***1*** typing — em wraps strong when both 3-char delims close",
      seed: "",
      events: ["*", "*", "*", "1", "*", "*", "*", " "],
      checkpoints: [
        { at: 4, expect: "***1|" },
        // step 5: `***1*` — markdown-it closes the innermost pair, leaving
        // `**` as literal text and em on `1` (the old scanner folded the
        // unmatched open chars into the em content: `**1`).
        { at: 5, expect: "**<g>*</g><i>1</i><g>*</g>|" },
        // step 6: `***1**` — literal `*` then strong on `1` (old scanner
        // put the unmatched open char inside the strong content).
        { at: 6, expect: "*<g>**</g><b>1</b><g>**</g>|" },
        // step 7: both runs len 3 → em outer wraps strong inner.
        // cursor at pos 7 sits at em's spanTo (inside em) but past
        // strong's spanTo (outside strong) → em delims gray, strong
        // delims hidden.
        { at: 7, expect: "<g>*</g><i><b>1</b></i><g>*</g>|" },
        { at: 8, expect: "<i><b>1</b></i> |" },
      ],
    },
    {
      id: "triple-underscores-stable",
      label: "___1___ stable — em wrapping strong (underscore variant)",
      seed: "___1___ ",
      events: [],
      checkpoints: [{ at: 0, expect: "<i><b>1</b></i> |" }],
    },
  ],
};
