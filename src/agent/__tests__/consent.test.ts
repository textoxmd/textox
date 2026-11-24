import { describe, expect, it } from 'vitest';
import { coverageOf, hasOverseasProvider } from '../consent';

describe('consent', () => {
  it('detects overseas providers in the coverage set', () => {
    expect(hasOverseasProvider(['deepseek', 'zhipu'])).toBe(false);
    expect(hasOverseasProvider(['deepseek', 'openai'])).toBe(true);
    expect(hasOverseasProvider(['anthropic'])).toBe(true);
  });

  it('ignores custom and empty sets', () => {
    expect(hasOverseasProvider([])).toBe(false);
    expect(hasOverseasProvider(['custom'])).toBe(false);
    expect(hasOverseasProvider(['deepseek', 'custom'])).toBe(false);
  });

  it('builds coverage from region plus existing profiles', () => {
    expect(coverageOf(false, ['deepseek'])).toEqual([
      'deepseek',
      'zhipu',
      'moonshot',
      'qwen',
      'openai',
      'anthropic',
      'google',
      'xai',
      'custom',
    ]);
    expect(coverageOf(true, ['openai'])).toEqual([
      'deepseek',
      'zhipu',
      'moonshot',
      'qwen',
      'custom',
      'openai',
    ]);
    expect(coverageOf(true, ['openai', 'openai'])).toEqual([
      'deepseek',
      'zhipu',
      'moonshot',
      'qwen',
      'custom',
      'openai',
    ]);
  });
});
