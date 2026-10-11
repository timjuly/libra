import type { IconLibrary, ServerRecord, Subscription } from '../shared/types';
export type Page = 'servers' | 'subscriptions' | 'icons' | 'security';
export type DialogState =
  | { kind: 'server'; server?: ServerRecord }
  | { kind: 'subscription'; subscription?: Subscription }
  | { kind: 'import'; server: ServerRecord }
  | { kind: 'json' }
  | { kind: 'qr'; subscription: Subscription }
  | { kind: 'help' }
  | { kind: 'iconLibrary'; library?: IconLibrary }
  | { kind: 'deleteIconLibrary'; library: IconLibrary }
  | { kind: 'browseIcons'; library: IconLibrary }
  | { kind: 'githubSettings' }
  | { kind: 'deleteServer'; server: ServerRecord }
  | { kind: 'deleteSubscription'; subscription: Subscription }
  | null;
