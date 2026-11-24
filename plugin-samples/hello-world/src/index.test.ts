import { describe, expect, it } from 'vitest';

import HelloWorldPlugin from './index';

describe('HelloWorldPlugin', () => {
  it('declares the greeting and shout settings fields', () => {
    const fields = HelloWorldPlugin.settingsFields ?? [];
    const byKey = new Map(fields.map((field) => [field.key, field]));

    expect(byKey.get('greeting')).toMatchObject({ type: 'text', default: 'Hello' });
    expect(byKey.get('shout')).toMatchObject({ type: 'boolean', default: false });
    expect(fields.length).toBeGreaterThanOrEqual(2);
  });
});
