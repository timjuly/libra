import { useEffect, useState, type FormEvent } from 'react';
import { Check, Download, Plus, Server, Trash2, Waypoints } from 'lucide-react';
import type { CatalogWrite, DiscoveredLines, Endpoint, IconLibrary, ServerRecord } from '../../shared/types';
import { LogoField } from '../components/LogoField';
import { LineSelection } from '../components/LineSelection';
import { EmbyIdentity } from '../components/EmbyIdentity';
import { baseURL, validateConfig } from '../../shared/validation';
import { newAlternateLines } from '../../shared/lines';
import { Button, IconButton, Field, PasswordInput, Message, Switch } from '../components/ui';
import { Modal } from '../components/Modal';
import { api, errorMessage } from '../api';

import { useEditorClose } from '../useEditorClose';

export function ServerEditor({
  server,
  iconLibraries,
  catalogRevision,
  close,
  save,
}: {
  server?: ServerRecord;
  iconLibraries: IconLibrary[];
  catalogRevision: string;
  close: () => void;
  save: (record: CatalogWrite<ServerRecord>) => void;
}) {
  const original = server?.config;
  const [name, setName] = useState(original?.name ?? '');
  const [note, setNote] = useState(original?.note ?? '');
  const [logo, setLogo] = useState(original?.logo ?? '');
  const [username, setUsername] = useState(original?.credentials?.username ?? '');
  const [password, setPassword] = useState(original?.credentials?.password ?? '');
  const [primary, setPrimary] = useState<Endpoint>(original?.primary ?? { url: '', name: '' });
  const [alternates, setAlternates] = useState<Endpoint[]>(
    original?.alternates?.map((line) => ({ ...line })) ?? [],
  );
  const [enabled, setEnabled] = useState(server?.enabled ?? true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState('');
  const [discoveryMessage, setDiscoveryMessage] = useState('');
  const [candidates, setCandidates] = useState<Endpoint[] | null>(null);
  const working = busy || discovering;
  useEffect(() => {
    setCandidates(null);
    setDiscoveryMessage('');
    setDiscoveryError('');
  }, [primary.url, username, password]);
  const requestClose = useEditorClose(
    { name, note, logo, username, password, primary, alternates, enabled },
    close,
    working,
  );
  function addLines(lines: Endpoint[]) {
    const additional = newAlternateLines(primary, alternates, lines);
    if (additional.length + alternates.length > 32) {
      setCandidates(additional);
      return;
    }
    setAlternates([...alternates, ...additional]);
    setCandidates(null);
    setDiscoveryMessage(
      additional.length ? `已添加 ${additional.length} 条备用线路，保存后生效` : '没有发现新的备用线路',
    );
  }
  async function discover() {
    if (working) return;
    setDiscoveryError('');
    try {
      const url = baseURL(primary.url);
      if (!username.trim()) throw new Error('请先填写 Emby 用户名');
      if (
        new URL(url).protocol === 'http:' &&
        !window.confirm(
          '当前主线路使用 HTTP，Cloudflare 到 Emby 服务器之间的连接未加密，用户名和密码将以明文发送。仍要获取备用线路吗？',
        )
      )
        return;
      setDiscovering(true);
      setDiscoveryMessage('');
      setCandidates(null);
      const result = await api<DiscoveredLines>('/api/servers/discover-lines', 'POST', {
        primary: { url },
        credentials: { username, password },
      });
      addLines(result.lines);
      if (result.skipped)
        setDiscoveryMessage(
          (message) => `${message}${message ? '；' : ''}已忽略 ${result.skipped} 条无效线路`,
        );
    } catch (error) {
      setDiscoveryError(errorMessage(error));
    } finally {
      setDiscovering(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (working) return;
    setBusy(true);
    setError('');
    try {
      const config = validateConfig({
        type: 'emby',
        name,
        note,
        logo,
        credentials: { username, ...(password.length > 0 ? { password } : {}) },
        primary,
        alternates,
      });
      const record = await api<CatalogWrite<ServerRecord>>(
        `/api/servers${server ? `/${server.id}` : ''}`,
        server ? 'PUT' : 'POST',
        { config, enabled, version: server?.version, catalogRevision },
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
      title={server ? '编辑服务器' : '添加服务器'}
      subtitle="保存连接信息，随时导入你喜欢的播放器。"
      close={requestClose}
      wide
    >
      <form onSubmit={submit} aria-busy={working}>
        <fieldset className="server-editor-fields" disabled={working}>
          <div className="modal-body">
            <div className="form-section-heading">
              <Server size={17} />
              <h3>基本信息</h3>
              <span>EMBY</span>
            </div>
            <div className="form-grid">
              <Field label="服务器名称" optional>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如：家庭媒体库"
                  maxLength={100}
                  autoFocus
                />
              </Field>
              <Field label="备注" optional>
                <input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="一句话介绍这份媒体收藏"
                  maxLength={500}
                />
              </Field>
            </div>
            <LogoField value={logo} onChange={setLogo} libraries={iconLibraries} />
            <div className="form-grid">
              <Field label="用户名" optional>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="off"
                  placeholder="Emby 账号"
                  maxLength={200}
                />
              </Field>
              <Field label="密码" optional>
                <PasswordInput value={password} onChange={setPassword} placeholder="服务器登录密码" />
              </Field>
            </div>
            <div className="section-divider" />
            <div className="form-section-heading">
              <Waypoints size={17} />
              <h3>连接线路</h3>
              <Button
                variant="secondary"
                type="button"
                className="line-discovery-action"
                busy={discovering}
                onClick={discover}
              >
                {!discovering && <Download size={15} />}
                {discovering ? '正在获取' : '获取备用线路'}
              </Button>
            </div>
            <p className="line-discovery-note">
              获取线路会以 LibraManager 登录并尝试登出，请先确认服务器的客户端白名单与设备限制。
            </p>
            <EmbyIdentity />
            <div className="line-editor primary-line">
              <div className="line-label">
                <span className="route-dot" />
                主线路
              </div>
              <div className="route-fields">
                <Field label="线路地址">
                  <input
                    type="url"
                    value={primary.url}
                    onChange={(event) => setPrimary({ ...primary, url: event.target.value })}
                    placeholder="https://media.example.com:8920/emby"
                    required
                    maxLength={2048}
                  />
                </Field>
                <Field label="线路名称" optional>
                  <input
                    value={primary.name ?? ''}
                    onChange={(event) => setPrimary({ ...primary, name: event.target.value })}
                    placeholder="主线路"
                    maxLength={100}
                  />
                </Field>
              </div>
            </div>
            {discoveryError && <Message tone="error">{discoveryError}</Message>}
            {discoveryMessage && (
              <p className="line-discovery-message" role="status">
                {discoveryMessage}
              </p>
            )}
            {candidates && (
              <LineSelection
                lines={candidates}
                capacity={32 - alternates.length}
                add={addLines}
                close={() => setCandidates(null)}
              />
            )}
            {alternates.map((line, index) => (
              <div className="line-editor" key={index}>
                <div className="line-label">
                  <span className="route-dot muted" />
                  备用线路 {index + 1}
                  <IconButton
                    label={`删除备用线路 ${index + 1}`}
                    onClick={() => setAlternates(alternates.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </div>
                <div className="route-fields">
                  <Field label="线路地址">
                    <input
                      type="url"
                      value={line.url}
                      onChange={(event) =>
                        setAlternates(
                          alternates.map((item, i) =>
                            i === index ? { ...item, url: event.target.value } : item,
                          ),
                        )
                      }
                      placeholder="http://192.168.1.10:8096"
                      required
                      maxLength={2048}
                    />
                  </Field>
                  <Field label="线路名称" optional>
                    <input
                      value={line.name ?? ''}
                      onChange={(event) =>
                        setAlternates(
                          alternates.map((item, i) =>
                            i === index ? { ...item, name: event.target.value } : item,
                          ),
                        )
                      }
                      placeholder="例如：家中直连"
                      maxLength={100}
                    />
                  </Field>
                </div>
              </div>
            ))}
            <Button
              variant="secondary"
              type="button"
              className="dashed full"
              disabled={alternates.length >= 32}
              onClick={() => setAlternates([...alternates, { url: '', name: '' }])}
            >
              <Plus size={16} />
              添加备用线路 <span className="muted-text">{alternates.length} / 32</span>
            </Button>
            <p className="field-note">支持局域网、IPv6 和反向代理路径。备用线路应指向同一台可信服务器。</p>
            <div className="setting-row">
              <div>
                <strong>包含在订阅中</strong>
                <p>启用后，这台服务器可通过订阅链接获取。</p>
              </div>
              <Switch checked={enabled} onChange={() => setEnabled(!enabled)} label="包含在订阅中" />
            </div>
            {error && <Message tone="error">{error}</Message>}
          </div>
          <div className="modal-footer">
            <Button variant="secondary" type="button" onClick={requestClose} disabled={working}>
              取消
            </Button>
            <Button type="submit" busy={busy}>
              <Check size={16} />
              {server ? '保存更改' : '添加服务器'}
            </Button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
