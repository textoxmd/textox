import type { FeatureSpecs } from "../_types.ts";

export const autoLinkUrlSpecs: FeatureSpecs = {
  name: "auto-link-url",
  cases: [
    {
      id: "simple-bare-url",
      label: "https://x.com — bare URL auto-linked",
      seed: "https://x.com ",
      events: [],
      checkpoints: [
        { at: 0, expect: "<a:https://x.com>https://x.com</a> |" },
      ],
    },
    {
      id: "http-url",
      label: "http://example.com — http scheme works",
      seed: "http://example.com ",
      events: [],
      checkpoints: [
        { at: 0, expect: "<a:http://example.com>http://example.com</a> |" },
      ],
    },
    {
      id: "url-with-path",
      label: "https://example.com/path?q=1 — full URL",
      seed: "https://example.com/path?q=1 ",
      events: [],
      checkpoints: [
        {
          at: 0,
          expect:
            "<a:https://example.com/path?q=1>https://example.com/path?q=1</a> |",
        },
      ],
    },
    {
      id: "trailing-period",
      label: "Visit https://x.com. — trailing period excluded",
      seed: "Visit https://x.com. ",
      events: [],
      checkpoints: [
        {
          at: 0,
          expect:
            "Visit <a:https://x.com>https://x.com</a>. |",
        },
      ],
    },
    {
      id: "trailing-comma",
      label: "See https://x.com, which... — trailing comma excluded",
      seed: "See https://x.com, which ",
      events: [],
      checkpoints: [
        {
          at: 0,
          expect:
            "See <a:https://x.com>https://x.com</a>, which |",
        },
      ],
    },
    {
      id: "url-in-parens",
      label: "(see https://x.com) — parens not part of URL",
      seed: "(see https://x.com) ",
      events: [],
      checkpoints: [
        {
          at: 0,
          expect:
            "(see <a:https://x.com>https://x.com</a>) |",
        },
      ],
    },
    {
      id: "balanced-parens",
      label: "https://en.wikipedia.org/wiki/Milk_(food) — balanced parens kept",
      seed: "https://en.wikipedia.org/wiki/Milk_(food) ",
      events: [],
      checkpoints: [
        {
          at: 0,
          expect:
            "<a:https://en.wikipedia.org/wiki/Milk_(food)>https://en.wikipedia.org/wiki/Milk_(food)</a> |",
        },
      ],
    },
    {
      id: "trailing-paren",
      label: "(visit https://x.com/page) — trailing paren excluded",
      seed: "(visit https://x.com/page) ",
      events: [],
      checkpoints: [
        {
          at: 0,
          expect:
            "(visit <a:https://x.com/page>https://x.com/page</a>) |",
        },
      ],
    },
    {
      id: "no-conflict-with-link",
      label: "[Example](https://x.com) — bare URL detection does not interfere",
      seed: "[Example](https://x.com) ",
      events: [],
      checkpoints: [
        {
          at: 0,
          expect: "<l:https://x.com>Example</l> |",
        },
      ],
    },
    {
      id: "no-conflict-with-autolink",
      label: "<https://x.com> — existing autolink unaffected",
      seed: "<https://x.com> ",
      events: [],
      checkpoints: [
        {
          at: 0,
          expect: "<a:https://x.com>https://x.com</a> |",
        },
      ],
    },
  ],
};
