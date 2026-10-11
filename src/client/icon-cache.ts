import type { IconCatalog, IconLibrary } from '../shared/types';
import { api } from './api';

export const libraryKey = (library: IconLibrary) => `${library.id}:${library.version}:${library.url}`;
const catalogs = new Map<string, { value: IconCatalog; expires: number }>();
const pending = new Map<string, Promise<IconCatalog>>();
let generation = 0;

export function clearIconCatalogCache() {
  generation++;
  catalogs.clear();
  pending.clear();
}
export function invalidateIconCatalog(library: IconLibrary) {
  catalogs.delete(libraryKey(library));
  pending.delete(libraryKey(library));
}
export function cachedIcons(library: IconLibrary): IconCatalog | undefined {
  const key = libraryKey(library);
  const entry = catalogs.get(key);
  if (entry && entry.expires > Date.now()) return entry.value;
  catalogs.delete(key);
}
export function loadIcons(library: IconLibrary, refresh = false): Promise<IconCatalog> {
  const key = libraryKey(library);
  const cached = !refresh && cachedIcons(library);
  if (cached) return Promise.resolve(cached);
  if (!refresh && pending.has(key)) return pending.get(key)!;
  const started = generation;
  const request = api<IconCatalog>(`/api/icon-libraries/${library.id}/icons${refresh ? '?refresh=1' : ''}`)
    .then((value) => {
      if (started === generation && pending.get(key) === request) {
        catalogs.set(key, { value, expires: Date.now() + 10 * 60 * 1000 });
        // Bound memory across edits to the same library and retain only successes.
        if (catalogs.size > 60) catalogs.delete(catalogs.keys().next().value!);
      }
      return value;
    })
    .finally(() => {
      if (pending.get(key) === request) pending.delete(key);
    });
  pending.set(key, request);
  return request;
}
