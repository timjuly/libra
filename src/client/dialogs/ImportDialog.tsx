import { useState } from 'react';
import { ArrowUpRight, Check, Copy, Server, ShieldCheck } from 'lucide-react';
import type { PlayerId, ServerRecord } from '../../shared/types';
import { PLAYERS, playerLink } from '../../shared/players';
import { Button, Message } from '../components/ui';
import { Modal } from '../components/Modal';
import { titleOf } from '../helpers';

export function ImportDialog({
  server,
  close,
  copy,
}: {
  server: ServerRecord;
  close: () => void;
  copy: (value: string) => void;
}) {
  const [player, setPlayer] = useState<PlayerId>('libra');
  const selected = PLAYERS.find((item) => item.id === player)!;
  const link = playerLink(player, server.config);
  return (
    <Modal title="打开喜欢的播放器" subtitle="选择应用，将这份连接配置带过去。" close={close}>
      <div className="modal-body">
        <div className="import-server">
          <span className="server-art">
            <Server size={25} />
          </span>
          <div>
            <strong>{titleOf(server)}</strong>
            <p>{server.config.primary.url}</p>
          </div>
          <span className="pill">Emby</span>
        </div>
        <div className="player-grid">
          {PLAYERS.map((item) => (
            <button
              key={item.id}
              className={`player-option ${player === item.id ? 'selected' : ''}`}
              onClick={() => setPlayer(item.id)}
              aria-pressed={player === item.id}
            >
              <span className={`player-icon ${item.id}`} aria-hidden="true">
                {item.initial}
              </span>
              <strong>{item.name}</strong>
              {player === item.id && <Check size={15} className="player-check" />}
            </button>
          ))}
        </div>
        {link.warning && <Message tone="error">{link.warning}</Message>}
        <div className="import-note">
          <ShieldCheck size={18} />
          <p>导入链接包含账号信息，请妥善保管。需在当前设备安装对应播放器；各播放器支持的字段可能不同。</p>
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="secondary" type="button" disabled={!link.url} onClick={() => copy(link.url)}>
          <Copy size={16} />
          复制导入链接
        </Button>
        {link.url ? (
          <a className="button primary" href={link.url} rel="noreferrer">
            打开 {selected.name}
            <ArrowUpRight size={17} />
          </a>
        ) : (
          <Button disabled>暂不支持此地址</Button>
        )}
      </div>
    </Modal>
  );
}
