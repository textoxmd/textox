import type { FeatureSpecs } from "../_types.ts";

export const headingSpecs: FeatureSpecs = {
  name: "heading",
  cases: [
    {
      id: "type-and-commit-h1",
      label: "# a<Enter> — typing draft then commit to <h1>",
      seed: "",
      events: ["#", " ", "a", "<Enter>"],
      checkpoints: [
        // `#` alone: not entered (needs the ` ` to follow).
        { at: 1, expect: "#|" },
        // `# `: draft active even before any content is typed (empty
        // heading content is allowed — see 8f37884).
        { at: 2, expect: "<g># </g>|" },
        // `# a`: draft active — `# ` gets syntax-hint deco, content visible.
        { at: 3, expect: "<g># </g>a|" },
        // Enter commits the draft to a real heading; caret lands in a new
        // paragraph below.
        { at: 4, expect: "<h1>a</h1>\n|" },
      ],
    },

    {
      id: "type-and-commit-h3",
      label: "### x<Enter> — level N picked from #-count",
      seed: "",
      events: ["#", "#", "#", " ", "x", "<Enter>"],
      checkpoints: [
        { at: 3, expect: "###|" },          // not entered
        // `### `: empty-content draft is active (same rule as h1).
        { at: 4, expect: "<g>### </g>|" },
        { at: 5, expect: "<g>### </g>x|" }, // draft
        { at: 6, expect: "<h3>x</h3>\n|" }, // commit
      ],
    },

    {
      id: "hash-space-enter-commits-empty-h1",
      label: "# <Enter> → empty h1; ArrowUp re-enters it; Backspace unwraps",
      seed: "",
      events: ["#", " ", "<Enter>", "<ArrowUp>", "<Backspace>"],
      checkpoints: [
        // `# `: empty-content draft active.
        { at: 2, expect: "<g># </g>|" },
        // Enter commits the empty draft to an empty h1; caret lands in
        // the fresh paragraph below.
        { at: 3, expect: "<h1></h1>\n|" },
        // ArrowUp back into the committed empty heading (h-label shown,
        // cursor at the only position inside).
        { at: 4, expect: "<h1><h-label>H1</h-label>|</h1>" },
        // Backspace at the start of an empty heading unwraps it to a
        // plain paragraph (heading keymap, Typora semantics).
        { at: 5, expect: "|" },
      ],
    },

    {
      id: "backspace-exits-draft",
      label: "# a + two Backspaces — draft exits, then `#` removed",
      seed: "",
      events: ["#", " ", "a", "<Backspace>", "<Backspace>"],
      checkpoints: [
        { at: 3, expect: "<g># </g>a|" },   // draft
        // Delete `a` → text is `# ` → empty content still matches → draft stays.
        { at: 4, expect: "<g># </g>|" },
        // Delete the space → text is `#` → still paragraph, no deco.
        { at: 5, expect: "#|" },
      ],
    },

    {
      id: "rendered-seed-has-cursor-at-end",
      label: "seed `# a` parses to <h1>; cursor lands at end",
      seed: "# a",
      events: [],
      checkpoints: [
        // Parser produces a committed heading; setup() puts the caret at
        // end-of-doc, which resolves to inside the heading.
        { at: 0, expect: "<h1><h-label>H1</h-label>a|</h1>" },
      ],
    },

    {
      id: "commit-then-type",
      label: "# a<Enter>x — caret is in new paragraph after commit",
      seed: "",
      events: ["#", " ", "a", "<Enter>", "x"],
      checkpoints: [
        { at: 3, expect: "<g># </g>a|" },
        { at: 4, expect: "<h1>a</h1>\n|" },
        { at: 5, expect: "<h1>a</h1>\nx|" },
      ],
    },

    {
      id: "arrow-leave-commits",
      label: "ArrowDown from draft commits to heading (heading-scoped plugin)",
      // headingArrowDownPlugin fires only inside a heading-draft paragraph
      // at the doc's absolute end: spawns a fresh trailing paragraph, moves
      // the cursor into it, and leaveLineDraft then runs its commit. This
      // is NOT a global "last-line ArrowDown" behavior — a plain paragraph
      // at doc end does nothing.
      seed: "",
      events: ["#", " ", "a", "<ArrowDown>"],
      checkpoints: [
        { at: 3, expect: "<g># </g>a|" },
        { at: 4, expect: "<h1>a</h1>\n|" },
      ],
    },

    // ─── setext ───────────────────────────────────────────────────────
    // Typora doesn't auto-convert paragraph + `===` on Enter (we tested
    // and confirmed). setext is an *input* format only: parser recognises
    // it, serializer preserves it via the `style` attr. Pretty doesn't
    // distinguish atx/setext — both render <h1>x</h1> — so attr survival
    // is verified by roundtrip.test.ts (`doc1.eq(doc2)` checks attrs).
    {
      id: "parse-setext-h1",
      label: "seed `Heading\\n===` parses to <h1>",
      seed: "Heading\n===",
      events: [],
      checkpoints: [
        { at: 0, expect: "<h1><h-label>H1</h-label>Heading|</h1>" },
      ],
    },
    {
      id: "parse-setext-h2",
      label: "seed `Heading\\n---` parses to <h2> (not hr, since preceding text)",
      seed: "Heading\n---",
      events: [],
      checkpoints: [
        { at: 0, expect: "<h2><h-label>H2</h-label>Heading|</h2>" },
      ],
    },
    {
      id: "edit-setext-keeps-shape",
      label: "typing into a setext h1 keeps it heading",
      seed: "Heading\n===",
      events: ["x"],
      checkpoints: [
        { at: 0, expect: "<h1><h-label>H1</h-label>Heading|</h1>" },
        { at: 1, expect: "<h1><h-label>H1</h-label>Headingx|</h1>" },
      ],
    },

    // Two previously SKIPPED cases are removed because `runFeatureCases`
    // can't describe-without-tests cleanly:
    //   - rendered-reentry-stays-rendered (needs seed → rendered heading
    //     AND ArrowUp from a following paragraph into the heading)
    //   - empty-heading-double-backspace (needs a seed path to an empty
    //     heading; parser drops `# ` to a paragraph)
    // Reactivate once test-utils grows a JSON-seed path.
  ],
};
