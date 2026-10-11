import type { PlayerId, ServerConfig } from './types';

export const PLAYERS: { id: PlayerId; name: string; initial: string }[] = [
  { id: 'libra', name: 'Libra', initial: 'L' },
  { id: 'senplayer', name: 'SenPlayer', initial: 'S' },
  { id: 'eplayerx', name: 'EplayerX', initial: 'E' },
  { id: 'rex', name: 'Rex', initial: 'R' },
  { id: 'hills', name: 'Hills', initial: 'H' },
  { id: 'rodelplayer', name: '小幻播放器', initial: 'R' },
];
export function base64url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
export function playerLink(player: PlayerId, config: ServerConfig): { url: string; warning?: string } {
  if (player === 'libra') {
    // Libra v1 deliberately excludes the logo and any management-only fields.
    const { type, name, note, credentials, primary, alternates } = config;
    return {
      url: `libra://import/server?v=1&data=${base64url(JSON.stringify({ type, name, note, credentials, primary, alternates }))}`,
    };
  }
  const params = new URLSearchParams({ type: 'emby' });
  const put = (key: string, value?: string) => {
    if (value !== undefined) params.set(key, value);
  };
  put('username', config.credentials?.username);
  put('password', config.credentials?.password);
  const alternates = config.alternates ?? [];
  if (player === 'senplayer') {
    put('name', config.name);
    put('note', config.note);
    put('icon', config.logo);
    put('address', config.primary.url);
    alternates.forEach((line, index) => {
      put(`address${index + 1}`, line.url);
      put(`address${index + 1}name`, line.name);
    });
    return { url: `senplayer://importserver?${params}` };
  }
  if (player === 'eplayerx') {
    put('href', config.primary.url);
    put('name', config.name);
    put('remark', config.note);
    if (alternates.length) {
      // The adapter's inner list uses literal separators; do not silently corrupt them.
      if (alternates.some((line) => /[,;]/.test(line.url + (line.name ?? '')))) {
        return {
          url: '',
          warning: 'EplayerX 的备用线路格式不能无损表达逗号或分号，请使用 Libra 导入或手动填写。',
        };
      }
      put('backupHref', alternates.map((line) => `${line.url};${line.name ?? ''}`).join(','));
    }
    return { url: `eplayerx://add-or-update?${params}` };
  }
  const primary = new URL(config.primary.url);
  if (primary.pathname !== '/') {
    return {
      url: '',
      warning: `${PLAYERS.find((item) => item.id === player)!.name} 已知导入协议未明确支持主线路的基础路径，请在播放器中手动添加完整地址，或使用 Libra / SenPlayer 导入。`,
    };
  }
  put('scheme', primary.protocol.slice(0, -1));
  put('host', primary.hostname);
  put('port', primary.port || (primary.protocol === 'https:' ? '443' : '80'));
  // Rex names the primary line with title; its source adapter defaults to 主线路.
  put('title', player === 'rex' ? config.primary.name || '主线路' : config.name);
  alternates.forEach((line, index) => {
    put(`line${index + 1}`, line.url);
    put(`line${index + 1}title`, player === 'rex' ? line.name || `线路${index + 1}` : line.name);
  });
  return { url: `${player}://import?${params}` };
}
