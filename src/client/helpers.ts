import type { ServerRecord } from '../shared/types';
export const titleOf = (server: ServerRecord) =>
  server.config.name || new URL(server.config.primary.url).hostname;
export const makeSlug = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
export const feedURL = (slug: string) => `${window.location.origin}/${slug}`;
