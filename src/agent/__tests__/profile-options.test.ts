import { describe, expect, it } from 'vitest';
import { profileOptions } from '../profile-options';

const profile = (id: string, enabled: boolean, model = 'deepseek-flash') => ({
  id,
  name: id,
  provider: 'deepseek' as const,
  model,
  apiKey: 'k',
  baseUrl: '',
  enabled,
});

describe('profileOptions', () => {
  it('lists only enabled profiles and reports an unset binding', () => {
    const { options, state } = profileOptions(
      [profile('a', true), profile('b', false)],
      '',
    );
    expect(options.map((option) => option.id)).toEqual(['a']);
    expect(state).toBe('unset');
  });

  it('reports an ok binding when the bound profile is enabled', () => {
    const { options, state } = profileOptions([profile('a', true)], 'a');
    expect(state).toBe('ok');
    expect(options).toEqual([{ id: 'a', label: 'a · deepseek-flash', inactive: false }]);
  });

  it('keeps the bound profile even when disabled', () => {
    const { options, state } = profileOptions(
      [profile('a', true), profile('b', false)],
      'b',
    );
    expect(options.map((option) => option.id)).toEqual(['a', 'b']);
    expect(options[1]).toEqual({ id: 'b', label: 'b · deepseek-flash', inactive: true });
    expect(state).toBe('inactive');
  });

  it('drops a deleted binding', () => {
    const { options, state } = profileOptions([profile('a', true)], 'gone');
    expect(options).toEqual([{ id: 'a', label: 'a · deepseek-flash', inactive: false }]);
    expect(state).toBe('deleted');
  });

  it('omits the separator when the model is empty', () => {
    const { options } = profileOptions([profile('n', true, '')], 'n');
    expect(options[0]?.label).toBe('n');
  });
});
