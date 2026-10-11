import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './ui';

export function Modal({
  title,
  subtitle,
  children,
  close,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    window.dispatchEvent(new Event('libra:modal-open'));
    document.body.classList.add('modal-open');
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      aria-labelledby="modal-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && event.clientX !== 0) {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            close();
        }
      }}
    >
      <div className="modal-header">
        <div>
          <h2 id="modal-title">{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <IconButton label="关闭" onClick={close}>
          <X size={20} />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}
