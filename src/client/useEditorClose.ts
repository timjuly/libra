import { useEffect, useRef } from 'react';

export function useEditorClose(value: unknown, close: () => void, busy: boolean) {
  const serialized = JSON.stringify(value);
  const initial = useRef(serialized);
  const dirty = initial.current !== serialized;
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  return () => {
    if (busy) return;
    if (dirty && !window.confirm('有未保存的更改，确定放弃并关闭吗？')) return;
    close();
  };
}
