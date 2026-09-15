import { SUPPORTED_LOCALES, type Locale, type LocaleResource, type LocaleResources } from '../types';
import { de } from './de';
import { en } from './en';
import { it } from './it';

export { common } from './common';
export { de } from './de';
export { en } from './en';
export { it } from './it';

export const defaultResources: Record<Locale, LocaleResource> = { en, de, it };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const mergeResource = (
  base: LocaleResource,
  override: LocaleResource | undefined,
): LocaleResource => {
  if (!override) return base;

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    if (isObject(current) && isObject(value)) {
      merged[key] = mergeResource(
        current as LocaleResource,
        value as LocaleResource,
      );
    } else {
      merged[key] = value;
    }
  }
  return merged as LocaleResource;
};

/** Merge application-provided feature resources over the shipped resources. */
export const mergeResources = (
  ...resourceMaps: LocaleResources[]
): Record<Locale, LocaleResource> => {
  const merged = { ...defaultResources };

  for (const resourceMap of resourceMaps) {
    for (const locale of Object.keys(resourceMap) as Locale[]) {
      if (!SUPPORTED_LOCALES.includes(locale)) continue;
      const resource = resourceMap[locale];
      if (resource) merged[locale] = mergeResource(merged[locale], resource);
    }
  }

  return merged;
};
