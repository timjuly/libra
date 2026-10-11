import { useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import type { CatalogWrite, IconLibrary } from '../../shared/types';
import { iconLibraryURL } from '../../shared/icons';
import { Modal } from '../components/Modal';
import { Button, Field, Message } from '../components/ui';
import { api, errorMessage } from '../api';
import { useEditorClose } from '../useEditorClose';

export function IconLibraryEditor({
  library,
  catalogRevision,
  close,
  save,
}: {
  library?: IconLibrary;
  catalogRevision: string;
  close: () => void;
  save: (library: CatalogWrite<IconLibrary>) => void;
}) {
  const [name, setName] = useState(library?.name ?? '');
  const [url, setUrl] = useState(library?.url ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestClose = useEditorClose({ name, url }, close, busy);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const record = await api<CatalogWrite<IconLibrary>>(
        `/api/icon-libraries${library ? `/${library.id}` : ''}`,
        library ? 'PUT' : 'POST',
        {
          name,
          url: iconLibraryURL(url),
          version: library?.version,
          catalogRevision,
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
    <Modal title={library ? '编辑图标库' : '添加图标库'} close={requestClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <Field label="图标库名称">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：我的图标库"
              maxLength={100}
              required
              autoFocus
            />
          </Field>
          <Field label="图标库地址">
            <input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="HTTPS JSON 地址，例如：https://example.com/icons.json"
              maxLength={2048}
              required
            />
          </Field>
          {error && <Message tone="error">{error}</Message>}
        </div>
        <div className="modal-footer">
          <Button type="button" variant="secondary" disabled={busy} onClick={requestClose}>
            取消
          </Button>
          <Button type="submit" busy={busy}>
            <Check size={16} />
            保存图标库
          </Button>
        </div>
      </form>
    </Modal>
  );
}
