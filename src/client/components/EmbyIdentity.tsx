import { useEffect, useId, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { api, errorMessage } from '../api';
import { Button, IconButton, Message } from './ui';

export function EmbyIdentity() {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');

  useEffect(() => {
    if (!open || deviceId) return;
    let active = true;
    setLoading(true);
    setError('');
    api<{ deviceId: string }>('/api/settings/emby')
      .then((settings) => {
        if (active) {
          setDeviceId(settings.deviceId);
          setLoading(false);
        }
      })
      .catch((error) => {
        if (active) {
          setError(errorMessage(error));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [open, deviceId, attempt]);

  async function copy() {
    setCopied(false);
    setCopyError('');
    try {
      await navigator.clipboard.writeText(deviceId);
      setCopied(true);
    } catch {
      setCopyError('复制失败，请选中 DeviceId 手动复制');
    }
  }

  return (
    <details className="emby-identity" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>客户端身份</summary>
      <div className="emby-identity-content" aria-busy={loading}>
        <p>客户端、设备名称与 UA：LibraManager</p>
        {loading && <p role="status">正在读取 DeviceId…</p>}
        {error && (
          <>
            <Message tone="error">{error}</Message>
            <Button variant="ghost" type="button" onClick={() => setAttempt((value) => value + 1)}>
              重新读取 DeviceId
            </Button>
          </>
        )}
        {deviceId && (
          <>
            <label className="field-label" htmlFor={inputId}>
              DeviceId
            </label>
            <div className="input-with-action">
              <input id={inputId} value={deviceId} readOnly />
              <IconButton label="复制 DeviceId" onClick={copy}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </IconButton>
            </div>
            <p role={copied ? 'status' : undefined}>
              {copied ? 'DeviceId 已复制' : '本部署共用，重新部署后保持不变。'}
            </p>
            {copyError && <Message tone="error">{copyError}</Message>}
          </>
        )}
      </div>
    </details>
  );
}
