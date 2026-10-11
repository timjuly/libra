import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button, Message } from '../components/ui';
import { Modal } from '../components/Modal';
import { errorMessage } from '../api';

export function ConfirmDialog({
  title,
  description,
  close,
  confirm,
}: {
  title: string;
  description: string;
  close: () => void;
  confirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      title={title}
      close={() => {
        if (!busy) close();
      }}
    >
      <div className="modal-body">
        <p className="confirm-description">{description}</p>
        {error && <Message tone="error">{error}</Message>}
      </div>
      <div className="modal-footer">
        <Button variant="secondary" onClick={close} disabled={busy}>
          取消
        </Button>
        <Button
          variant="danger"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await confirm();
              close();
            } catch (error) {
              setError(errorMessage(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Trash2 size={16} />
          确认删除
        </Button>
      </div>
    </Modal>
  );
}
