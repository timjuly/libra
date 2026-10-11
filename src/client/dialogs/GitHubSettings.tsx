import { useEffect, useState, type FormEvent } from 'react';
import { Check, KeyRound, Trash2 } from 'lucide-react';
import type { GitHubStatus } from '../../shared/types';
import { api, errorMessage } from '../api';
import { clearIconCatalogCache } from '../icon-cache';
import { Modal } from '../components/Modal';
import { Button, Field, Message, PasswordInput, Spinner } from '../components/ui';
import { useEditorClose } from '../useEditorClose';

export function GitHubSettings({ close, notify }: { close: () => void; notify: (message: string) => void }) {
  const [status, setStatus] = useState<GitHubStatus>();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const requestClose = useEditorClose({ token }, close, busy);
  useEffect(() => {
    let active = true;
    setError('');
    void api<GitHubStatus>('/api/settings/github')
      .then((value) => {
        if (active) setStatus(value);
      })
      .catch((error: unknown) => {
        if (active) setError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [reload]);
  async function save(method: 'PUT' | 'DELETE') {
    if (!status) return;
    if (method === 'DELETE' && !window.confirm('确定移除 GitHub Token 吗？')) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/settings/github', method, {
        version: status.version,
        ...(method === 'PUT' ? { token } : {}),
      });
      clearIconCatalogCache();
      setToken('');
      notify(method === 'PUT' ? 'GitHub Token 已保存' : 'GitHub Token 已移除');
      close();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void save('PUT');
  }
  return (
    <Modal title="GitHub Token" close={requestClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          {!status && !error && (
            <div className="loading-state">
              <Spinner />
              正在加载设置…
            </div>
          )}
          {status && (
            <>
              <div className="github-token-status">
                <KeyRound size={17} />
                <span>{status.configured ? '已配置 Token' : '未配置 Token'}</span>
              </div>
              <Field label={status.configured ? '更换 Token' : 'Token'}>
                <PasswordInput
                  value={token}
                  onChange={setToken}
                  placeholder="粘贴 GitHub Personal Access Token"
                  required
                />
              </Field>
              <p className="field-note">
                用于读取 GitHub 图库，提高 API 请求额度。加密保存，不回显已保存的 Token。
              </p>
            </>
          )}
          {error && (
            <Message tone="error">
              {error}
              {!status && (
                <button className="text-button" type="button" onClick={() => setReload((value) => value + 1)}>
                  重新加载
                </button>
              )}
            </Message>
          )}
        </div>
        <div className="modal-footer">
          {status?.configured && (
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void save('DELETE')}>
              <Trash2 size={15} />
              移除 Token
            </Button>
          )}
          <Button type="button" variant="secondary" disabled={busy} onClick={requestClose}>
            取消
          </Button>
          <Button type="submit" busy={busy} disabled={!status || !token.trim()}>
            <Check size={16} />
            保存
          </Button>
        </div>
      </form>
    </Modal>
  );
}
