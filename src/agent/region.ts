import { invoke } from '@tauri-apps/api/core';

export type StoreRegionSource = 'store' | 'locale' | 'unknown';

export interface StoreRegion {
  country: string | null;
  source: StoreRegionSource;
}

const UNKNOWN: StoreRegion = { country: null, source: 'unknown' };

let region: StoreRegion = UNKNOWN;

/** `en-US` → `US`，`zh-Hans-CN` → `CN`，取不到返回 null。 */
export function parseLocaleRegion(locale: string): string | null {
  const parts = locale.replace('_', '-').split('-').slice(1);
  const found = parts.find((part) => /^[A-Za-z]{2}$/.test(part));
  return found ? found.toUpperCase() : null;
}

export function isMainlandChina(value: StoreRegion): boolean {
  return !value.country || value.country === 'CN' || value.country === 'CHN';
}

export async function loadStoreRegion(): Promise<StoreRegion> {
  try {
    region = await invoke<StoreRegion>('get_store_region');
  } catch {
    const country =
      typeof navigator === 'undefined' ? null : parseLocaleRegion(navigator.language ?? '');
    region = country ? { country, source: 'locale' } : UNKNOWN;
  }
  return region;
}

export function currentRegion(): StoreRegion {
  return region;
}

export function resetRegionForTests(value: StoreRegion = UNKNOWN): void {
  region = value;
}
