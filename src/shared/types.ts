export interface Endpoint {
  url: string;
  name?: string;
}
export interface DiscoveredLines {
  lines: Endpoint[];
  skipped: number;
}
export interface ServerConfig {
  type: 'emby';
  name?: string;
  note?: string;
  logo?: string;
  credentials?: { username?: string; password?: string };
  primary: Endpoint;
  alternates?: Endpoint[];
}
export interface ServerRecord {
  id: string;
  config: ServerConfig;
  enabled: boolean;
  version: string;
  createdAt: string;
  updatedAt: string;
}
export interface Subscription {
  id: string;
  slug: string;
  name: string;
  allServers: boolean;
  serverIds: string[];
  enabled: boolean;
  version: string;
  createdAt: string;
  updatedAt: string;
}
export interface DashboardData {
  servers: ServerRecord[];
  subscriptions: Subscription[];
  iconLibraries: IconLibrary[];
  revisions: { servers: string; iconLibraries: string };
}
export type CatalogWrite<T> = T & { catalogRevision: string };
export interface IconLibrary {
  id: string;
  name: string;
  url: string;
  version: string;
  createdAt: string;
  updatedAt: string;
}
export interface LibraryIcon {
  name: string;
  url: string;
}
export interface IconCatalog {
  icons: LibraryIcon[];
  skipped: number;
}
export interface GitHubStatus {
  configured: boolean;
  version: string | null;
  updatedAt: string | null;
}
export type PlayerId = 'senplayer' | 'eplayerx' | 'rex' | 'hills' | 'rodelplayer' | 'libra';
