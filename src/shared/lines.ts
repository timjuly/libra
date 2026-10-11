import type { Endpoint } from './types';
import { baseURL } from './validation';

export function newAlternateLines(
  primary: Endpoint,
  existing: Endpoint[],
  discovered: Endpoint[],
): Endpoint[] {
  const seen = new Set([baseURL(primary.url)]);
  for (const line of existing) {
    try {
      seen.add(baseURL(line.url));
    } catch {
      /* Keep unfinished manual rows in the form. */
    }
  }
  const additional: Endpoint[] = [];
  for (const line of discovered) {
    const url = baseURL(line.url);
    if (seen.has(url)) continue;
    seen.add(url);
    // Use the same canonical address for comparison and the saved draft.
    additional.push({ ...line, url });
  }
  return additional;
}
