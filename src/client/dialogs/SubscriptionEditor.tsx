import { useRef, useState, type FormEvent } from 'react';
import { Link2, RefreshCw, Server } from 'lucide-react';
import type { ServerRecord, Subscription } from '../../shared/types';
import { validateSlug } from '../../shared/validation';
import { Button, IconButton, Field, Message, Switch } from '../components/ui';
import { Modal } from '../components/Modal';
import { api, errorMessage } from '../api';
import { titleOf, makeSlug, feedURL } from '../helpers';

import { useEditorClose } from '../useEditorClose';

export function SubscriptionEditor({
  subscription,
  servers,
  close,
  save,
}: {
  subscription?: Subscription;
  servers: ServerRecord[];
  close: () => void;
  save: (value: Subscription) => void;
}) {
  const [name, setName] = useState(subscription?.name ?? '我的媒体订阅');
  const [slug, setSlug] = useState(() => subscription?.slug ?? makeSlug());
  const [allServers, setAllServers] = useState(subscription?.allServers ?? true);
  const [serverIds, setServerIds] = useState<string[]>(
    subscription?.serverIds.filter((id) => servers.some((server) => server.id === id)) ?? [],
  );
  const initialSelection = useRef(JSON.stringify({ allServers, serverIds }));
  const [enabled, setEnabled] = useState(subscription?.enabled ?? true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const requestClose = useEditorClose({ name, slug, allServers, serverIds, enabled }, close, busy);
  const weakSlug = slug.length >= 8 && (slug.length < 16 || /^\d+$/.test(slug) || /^(.)\1+$/.test(slug));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      validateSlug(slug);
      const selectionChanged = JSON.stringify({ allServers, serverIds }) !== initialSelection.current;
      const record = await api<Subscription>(
        `/api/subscriptions${subscription ? `/${subscription.id}` : ''}`,
        subscription ? 'PUT' : 'POST',
        {
          name,
          slug,
          enabled,
          version: subscription?.version,
          ...(!subscription || selectionChanged ? { allServers, serverIds } : {}),
        },
      );
      save(record);
      close();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={subscription ? '编辑订阅链接' : '创建订阅链接'}
      subtitle="给客户端一个地址，让服务器配置保持同步。"
      close={requestClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <Field label="订阅名称">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              placeholder="例如：我的 iPhone"
              autoFocus
              required
            />
          </Field>
          <Field label="链接后缀" hint="8–64 位字母或数字。随机后缀更难猜测。">
            <div className="input-with-action">
              <input
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                minLength={8}
                maxLength={64}
                pattern="[A-Za-z0-9]{8,64}"
                required
                spellCheck={false}
              />
              <IconButton label="随机生成后缀" onClick={() => setSlug(makeSlug())}>
                <RefreshCw size={17} />
              </IconButton>
            </div>
          </Field>
          {weakSlug && (
            <Message>这个后缀容易被猜到，建议使用随机生成的后缀，或至少 16 位随机字母与数字。</Message>
          )}
          <div className="url-preview">
            <Link2 size={15} />
            <span>{feedURL(slug || '…')}</span>
          </div>
          {subscription && slug !== subscription.slug && (
            <Message>保存后旧链接将失效。请在客户端更新订阅地址，传播可能需要一分钟或更久。</Message>
          )}
          <div className="section-divider" />
          <span className="field-label">包含哪些服务器</span>
          <div className="segmented">
            <button type="button" className={allServers ? 'active' : ''} onClick={() => setAllServers(true)}>
              全部服务器
            </button>
            <button
              type="button"
              className={!allServers ? 'active' : ''}
              onClick={() => setAllServers(false)}
            >
              指定服务器
            </button>
          </div>
          {allServers ? (
            <p className="field-note">自动包含当前及以后添加的已启用服务器。</p>
          ) : (
            <div className="server-picker">
              {servers.length ? (
                servers.map((server) => (
                  <label key={server.id}>
                    <input
                      type="checkbox"
                      checked={serverIds.includes(server.id)}
                      onChange={(event) =>
                        setServerIds(
                          event.target.checked
                            ? [...serverIds, server.id]
                            : serverIds.filter((id) => id !== server.id),
                        )
                      }
                    />
                    <span className="mini-server">
                      <Server size={16} />
                    </span>
                    <span>
                      {titleOf(server)}
                      <small>{new URL(server.config.primary.url).host}</small>
                    </span>
                    {!server.enabled && <em>已停用</em>}
                  </label>
                ))
              ) : (
                <p className="field-note">先添加一台服务器，再为它创建专属订阅。</p>
              )}
            </div>
          )}
          <div className="setting-row">
            <div>
              <strong>启用订阅</strong>
              <p>停用后，客户端将无法获取配置。</p>
            </div>
            <Switch checked={enabled} onChange={() => setEnabled(!enabled)} label="启用订阅" />
          </div>
          <Message>链接中包含服务器账号与密码。请只分享给可信的人，不要发布到公开页面。</Message>
          {error && <Message tone="error">{error}</Message>}
        </div>
        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={requestClose} disabled={busy}>
            取消
          </Button>
          <Button type="submit" busy={busy}>
            <Link2 size={16} />
            {subscription ? '保存链接' : '创建链接'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
