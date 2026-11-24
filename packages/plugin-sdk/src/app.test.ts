import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  APP_AGENT_TOOL,
  APP_COMMAND,
  APP_EXPORTER,
  APP_FILE_EDITOR,
  APP_IMAGE_UPLOADER,
  APP_OWNER,
  APP_SETTINGS_SECTION,
  declareAppExtensionPoints,
  type SettingsSection,
} from './app';
import {
  declareExtensionPoint,
  getContributions,
  hasExtensionPoint,
  ownerOfExtensionPoint,
  registerContributions,
  resetExtensionPointsForTests,
} from './extension-points';

const APP_POINTS = [
  APP_FILE_EDITOR,
  APP_EXPORTER,
  APP_COMMAND,
  APP_SETTINGS_SECTION,
  APP_IMAGE_UPLOADER,
  APP_AGENT_TOOL,
] as const;

beforeEach(() => {
  resetExtensionPointsForTests();
});

describe('declareAppExtensionPoints', () => {
  it('point ids', () => {
    declareAppExtensionPoints();
    expect(APP_POINTS).toHaveLength(6);
    // 独立字面表：锁定各常量对外暴露的字符串 id（不用常量自证）。
    const EXPECTED: ReadonlyArray<readonly [string, string]> = [
      ['app:fileEditor', APP_FILE_EDITOR],
      ['app:exporter', APP_EXPORTER],
      ['app:command', APP_COMMAND],
      ['app:settingsSection', APP_SETTINGS_SECTION],
      ['app:imageUploader', APP_IMAGE_UPLOADER],
      ['app:agentTool', APP_AGENT_TOOL],
    ];
    for (const [literal, id] of EXPECTED) expect(id).toBe(literal);
  });

  it('declares the app points with owner "app"', () => {
    declareAppExtensionPoints();
    for (const id of [
      APP_FILE_EDITOR,
      APP_EXPORTER,
      APP_COMMAND,
      APP_SETTINGS_SECTION,
      APP_IMAGE_UPLOADER,
      APP_AGENT_TOOL,
    ]) {
      expect(hasExtensionPoint(id)).toBe(true);
      expect(ownerOfExtensionPoint(id)).toBe(APP_OWNER);
    }
  });

  it('is idempotent', () => {
    declareAppExtensionPoints();
    declareAppExtensionPoints();
    expect(hasExtensionPoint(APP_COMMAND)).toBe(true);
  });

  it('does not override an already-declared point and fills in the rest', () => {
    declareExtensionPoint({ id: APP_COMMAND }, 'other');
    declareAppExtensionPoints();
    expect(ownerOfExtensionPoint(APP_COMMAND)).toBe('other');
    expect(ownerOfExtensionPoint(APP_FILE_EDITOR)).toBe(APP_OWNER);
    expect(ownerOfExtensionPoint(APP_EXPORTER)).toBe(APP_OWNER);
  });

  it('does not warn on a second declaration', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    declareAppExtensionPoints();
    declareAppExtensionPoints();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('accepts contributions once declared', () => {
    declareAppExtensionPoints();
    registerContributions('p', {
      [APP_COMMAND]: [{ id: 'p.cmd', titleKey: 'x', category: 'plugin', run: () => {} }],
    });
    expect(getContributions(APP_COMMAND).map((c) => c.id)).toEqual(['p.cmd']);
  });

  it('declares app:settingsSection and accepts setting sections', () => {
    declareAppExtensionPoints();
    expect(hasExtensionPoint(APP_SETTINGS_SECTION)).toBe(true);
    registerContributions('p', {
      [APP_SETTINGS_SECTION]: [{ id: 'p.s', titleKey: 't', fields: [] }],
    });
    expect(getContributions(APP_SETTINGS_SECTION).map((c) => c.id)).toContain('p.s');
  });

  it('round-trips every settings field variant', () => {
    declareAppExtensionPoints();
    registerContributions('p', {
      [APP_SETTINGS_SECTION]: [
        {
          id: 'p.settings',
          titleKey: 't',
          fields: [
            { type: 'text', key: 'url', labelKey: 'l.url', default: 'http://x' },
            { type: 'number', key: 'port', labelKey: 'l.port', default: 36677 },
            { type: 'boolean', key: 'on', labelKey: 'l.on', default: true },
            {
              type: 'select',
              key: 'mode',
              labelKey: 'l.mode',
              options: [{ value: 'a', labelKey: 'l.a' }],
            },
            { type: 'action', id: 'p.test', labelKey: 'l.test', run: async () => ({ ok: true }) },
          ],
        },
      ],
    });
    const [section] = getContributions(APP_SETTINGS_SECTION);
    expect(section?.fields.map((f) => f.type)).toEqual([
      'text',
      'number',
      'boolean',
      'select',
      'action',
    ]);
  });

  it('declares app:imageUploader and accepts uploader contributions', () => {
    declareAppExtensionPoints();
    expect(hasExtensionPoint(APP_IMAGE_UPLOADER)).toBe(true);
    registerContributions('p', {
      [APP_IMAGE_UPLOADER]: [{ id: 'p.uploader', upload: async () => 'https://cdn/x.png' }],
    });
    expect(getContributions(APP_IMAGE_UPLOADER).map((c) => c.id)).toEqual(['p.uploader']);
  });

  it('declares app:agentTool and accepts tool contributions', () => {
    declareAppExtensionPoints();
    expect(hasExtensionPoint(APP_AGENT_TOOL)).toBe(true);
    registerContributions('p', {
      [APP_AGENT_TOOL]: [
        {
          name: 'p.echo',
          description: 'echo',
          parameters: { type: 'object', properties: {} },
          execute: async (_host, args) => ({ content: JSON.stringify(args) }),
        },
      ],
    });
    expect(getContributions(APP_AGENT_TOOL).map((c) => c.name)).toEqual(['p.echo']);
  });

  it('action results may carry a detail string', async () => {
    declareAppExtensionPoints();
    registerContributions('p', {
      [APP_SETTINGS_SECTION]: [
        {
          id: 'p.s',
          titleKey: 't',
          fields: [
            {
              type: 'action',
              id: 'p.test',
              labelKey: 'l',
              run: async () => ({ ok: true, detail: 'https://cdn/x.png' }),
            },
          ],
        },
      ],
    });
    const [section] = getContributions(APP_SETTINGS_SECTION);
    const field = section?.fields[0];
    if (field?.type !== 'action' || !field.run) throw new Error('expected an inline action field');
    await expect(field.run({} as never, {})).resolves.toEqual({
      ok: true,
      detail: 'https://cdn/x.png',
    });
  });

  it('accepts a select field whose options use plain labels', () => {
    const section: SettingsSection = {
      id: 'demo',
      titleKey: 'demo.title',
      fields: [
        {
          type: 'select',
          key: 'theme',
          labelKey: 'demo.theme',
          options: [{ value: 'a', label: 'A' }],
        },
      ],
    };
    expect(section.fields[0]!.type).toBe('select');
  });

  it('accepts a modelProfile field', () => {
    const section: SettingsSection = {
      id: 'ai-explain.settings',
      titleKey: 'ai-explain.sectionTitle',
      fields: [
        {
          type: 'modelProfile',
          key: 'modelProfile',
          labelKey: 'ai-explain.modelProfile',
          default: '',
        },
      ],
    };
    expect(section.fields[0].type).toBe('modelProfile');
  });
});
