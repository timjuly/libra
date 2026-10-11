import { useRef, useState } from 'react';
import type { Endpoint } from '../../shared/types';
import { Button } from './ui';

const PAGE_SIZE = 20;

export function LineSelection({
  lines,
  capacity,
  add,
  close,
}: {
  lines: Endpoint[];
  capacity: number;
  add: (lines: Endpoint[]) => void;
  close: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const matching = lines.filter((line) =>
    `${line.name ?? ''} ${line.url}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = matching.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const remaining = Math.max(0, capacity - selected.size);
  const unselected = matching.filter((line) => !selected.has(line.url));

  function changePage(next: number) {
    setPage(next);
    if (list.current) list.current.scrollTop = 0;
  }
  function selectMatching() {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const line of matching) {
        if (next.size >= capacity) break;
        next.add(line.url);
      }
      return next;
    });
  }
  return (
    <section className="line-selection" aria-label="选择获取的备用线路">
      <div className="line-selection-heading">
        <strong>发现 {lines.length} 条新线路</strong>
        <span>
          已选 {selected.size} / {capacity}
        </span>
      </div>
      <p>还可添加 {capacity} 条，请选择需要的线路。</p>
      <input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          changePage(0);
        }}
        placeholder="搜索线路名称或地址"
        aria-label="搜索获取的备用线路"
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault();
        }}
      />
      <div className="line-selection-bulk">
        <Button
          variant="ghost"
          type="button"
          disabled={!remaining || !unselected.length}
          onClick={selectMatching}
        >
          {unselected.length <= remaining ? '全选匹配线路' : `按顺序选满 ${capacity} 条`}
        </Button>
        <Button
          variant="ghost"
          type="button"
          disabled={!selected.size}
          onClick={() => setSelected(new Set())}
        >
          清空选择
        </Button>
      </div>
      <div className="line-selection-list" ref={list}>
        {visible.map((line) => (
          <label key={line.url}>
            <input
              type="checkbox"
              checked={selected.has(line.url)}
              disabled={!selected.has(line.url) && selected.size >= capacity}
              onChange={(event) =>
                setSelected((previous) => {
                  const next = new Set(previous);
                  if (event.target.checked && next.size < capacity) next.add(line.url);
                  else next.delete(line.url);
                  return next;
                })
              }
            />
            <span>
              <strong>{line.name || '未命名线路'}</strong>
              <small>{line.url}</small>
            </span>
          </label>
        ))}
        {!visible.length && <p>没有匹配的线路</p>}
      </div>
      <nav className="line-selection-pagination" aria-label="备用线路分页">
        <Button
          variant="ghost"
          type="button"
          disabled={currentPage === 0}
          onClick={() => changePage(currentPage - 1)}
        >
          上一页
        </Button>
        <span aria-live="polite">
          {currentPage + 1} / {pages} · {matching.length} 条
        </span>
        <Button
          variant="ghost"
          type="button"
          disabled={currentPage === pages - 1}
          onClick={() => changePage(currentPage + 1)}
        >
          下一页
        </Button>
      </nav>
      <div className="line-selection-actions">
        <Button variant="ghost" type="button" onClick={close}>
          收起
        </Button>
        <Button
          type="button"
          disabled={!selected.size || selected.size > capacity}
          onClick={() => add(lines.filter((line) => selected.has(line.url)))}
        >
          添加所选线路
        </Button>
      </div>
    </section>
  );
}
