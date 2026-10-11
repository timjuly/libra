import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import type { CatalogWrite, ServerRecord } from '../../shared/types';
import { validateConfig } from '../../shared/validation';
import { Button, Field, Message } from '../components/ui';
import { Modal } from '../components/Modal';
import { api, errorMessage } from '../api';

import { useEditorClose } from '../useEditorClose';

export function JsonImport({
  close,
  save,
  catalogRevision,
}: {
  close: () => void;
  save: (row: CatalogWrite<ServerRecord>) => void;
  catalogRevision: string;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestClose = useEditorClose(value, close, busy);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new Error('JSON 格式不正确，请检查括号和引号');
      }
      if (Array.isArray(parsed)) throw new Error('请粘贴单台服务器的配置对象，不需要外层数组');
      const config = validateConfig(parsed);
      save(await api<CatalogWrite<ServerRecord>>('/api/servers', 'POST', { config, catalogRevision }));
      close();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="从 JSON 添加" subtitle="粘贴与订阅接口相同格式的单台服务器配置。" close={requestClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <Field label="服务器配置">
            <textarea
              className="code-input"
              rows={13}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoFocus
              spellCheck={false}
              placeholder={
                '{\n  "type": "emby",\n  "name": "家庭媒体库",\n  "primary": {\n    "url": "https://media.example.com"\n  }\n}'
              }
              required
              maxLength={100000}
            />
          </Field>
          {error && <Message tone="error">{error}</Message>}
        </div>
        <div className="modal-footer">
          <Button variant="secondary" type="button" onClick={requestClose} disabled={busy}>
            取消
          </Button>
          <Button type="submit" busy={busy}>
            <Plus size={16} />
            添加服务器
          </Button>
        </div>
      </form>
    </Modal>
  );
}
