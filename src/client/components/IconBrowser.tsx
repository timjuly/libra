import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Image, RefreshCw } from 'lucide-react';
import type { IconCatalog, IconLibrary, LibraryIcon } from '../../shared/types';
import { searchIcons } from '../../shared/icons';
import { errorMessage } from '../api';
import { cachedIcons, invalidateIconCatalog, libraryKey, loadIcons } from '../icon-cache';
import { Button, IconButton, Message, Spinner } from './ui';

export function IconImage({ url }: { url: string }) {
  const [failed, setFailed] = useState('');
  let valid = false;
  try {
    const parsed = new URL(url);
    valid = parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    /* Empty or partially typed URL. */
  }
  return (
    <span className="icon-image">
      {valid && failed !== url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailed(url)}
        />
      ) : (
        <Image size={23} aria-hidden="true" />
      )}
    </span>
  );
}

const PAGE_SIZE = 60;
type CatalogResult = { catalog?: IconCatalog; error?: string };
const cachedResults = (libraries: IconLibrary[]): Record<string, CatalogResult> =>
  Object.fromEntries(
    libraries.flatMap((library) => {
      const catalog = cachedIcons(library);
      return catalog ? [[libraryKey(library), { catalog }]] : [];
    }),
  );
export function IconBrowser({
  libraries,
  selected,
  onSelect,
  action = '选择',
}: {
  libraries: IconLibrary[];
  selected?: string;
  onSelect: (icon: LibraryIcon) => void;
  action?: string;
}) {
  const [scope, setScope] = useState('all');
  const scoped = scope === 'all' ? libraries : libraries.filter((item) => item.id === scope);
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search);
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const [results, setResults] = useState<Record<string, CatalogResult>>(() => cachedResults(libraries));
  const forced = useRef(new Set<string>());
  const sources = scoped.map(libraryKey).join(',');
  useEffect(() => {
    let active = true;
    setResults((previous) => ({ ...previous, ...cachedResults(scoped) }));
    const pending = scoped.filter((library) => !cachedIcons(library));
    let index = 0;
    async function next() {
      while (active && index < pending.length) {
        const library = pending[index++];
        const key = libraryKey(library);
        let result: CatalogResult;
        try {
          result = {
            catalog: await loadIcons(library, forced.current.has(key)),
          };
        } catch (error) {
          result = { error: errorMessage(error) };
        }
        if (!active) return;
        forced.current.delete(key);
        setResults((previous) => ({ ...previous, [key]: result }));
      }
    }
    // Limit simultaneous downloads even when the user adds many libraries.
    void Promise.all(Array.from({ length: Math.min(3, pending.length) }, next));
    return () => {
      active = false;
    };
  }, [sources, reload]);
  const pendingCount = scoped.filter((library) => !results[libraryKey(library)]).length;
  const failed = scoped.filter((library) => results[libraryKey(library)]?.error);
  const failureMessages = new Set(failed.map((library) => results[libraryKey(library)]?.error));
  const icons = useMemo(() => {
    const seen = new Set<string>();
    const combined = scoped.flatMap((library) =>
      (results[libraryKey(library)]?.catalog?.icons ?? [])
        .filter((icon) => {
          if (seen.has(icon.url)) return false;
          seen.add(icon.url);
          return true;
        })
        .map((icon) => ({ ...icon, libraryName: library.name })),
    );
    return searchIcons(combined, query);
  }, [sources, results, query]);
  const pages = Math.max(1, Math.ceil(icons.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const refresh = (targets = scoped) => {
    for (const library of targets) {
      const key = libraryKey(library);
      invalidateIconCatalog(library);
      forced.current.add(key);
    }
    setResults(cachedResults(libraries));
    setPage(0);
    setReload((value) => value + 1);
  };
  if (!libraries.length) return <p className="icon-browser-empty">暂无图标库，请先在「图标库」页面添加。</p>;
  return (
    <section className="icon-browser" aria-label="图标选择">
      <div className="icon-browser-toolbar">
        <select
          aria-label="选择图标库"
          value={scope}
          onChange={(event) => {
            setScope(event.target.value);
            setPage(0);
          }}
        >
          <option value="all">全部图库</option>
          {libraries.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <input
          aria-label="搜索图标"
          placeholder="搜索图标名称"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault();
          }}
        />
        <IconButton label="刷新图标" onClick={() => refresh()} disabled={pendingCount > 0}>
          <RefreshCw size={17} />
        </IconButton>
      </div>
      {failed.length > 0 && (
        <Message tone="error">
          {scoped.length === 1
            ? results[libraryKey(failed[0])].error
            : `${failed.length} 个图库加载失败：${failed.map((library) => library.name).join('、')}`}{' '}
          {scoped.length > 1 && failureMessages.size === 1 && <span>（{[...failureMessages][0]}）</span>}
          <button
            type="button"
            className="text-button"
            disabled={pendingCount > 0}
            onClick={() => refresh(failed)}
          >
            重试
          </button>
        </Message>
      )}
      <>
        <div className="icon-browser-count" role="status">
          {search.trim() ? `找到 ${icons.length} 个图标` : `${icons.length} 个图标`}
          {pendingCount > 0 && (
            <span className="icon-loading">
              <Spinner />
              正在加载 {pendingCount} 个图库…
            </span>
          )}
        </div>
        {icons.length ? (
          <div className="icon-grid">
            {icons.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((icon) => (
              <button
                key={icon.url}
                type="button"
                className={`icon-choice ${selected === icon.url ? 'selected' : ''}`}
                aria-label={`${action}图标 ${icon.name} · ${icon.libraryName}`}
                aria-pressed={selected === icon.url}
                title={`${icon.name} · ${icon.libraryName}`}
                onClick={() => onSelect(icon)}
              >
                <IconImage url={icon.url} />
                <span className="icon-choice-name">{icon.name}</span>
                {selected === icon.url && <Check className="icon-choice-check" size={13} />}
              </button>
            ))}
          </div>
        ) : !pendingCount && !failed.length ? (
          <p className="icon-browser-empty">
            {search.trim() ? '没有找到匹配的图标' : '这个图库暂无可用的 HTTPS 图标'}
          </p>
        ) : null}
        {pages > 1 && (
          <div className="icon-pagination">
            <Button
              type="button"
              variant="ghost"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft size={15} />
              上一页
            </Button>
            <span>
              {currentPage + 1} / {pages}
            </span>
            <Button
              type="button"
              variant="ghost"
              disabled={currentPage + 1 === pages}
              onClick={() => setPage(currentPage + 1)}
            >
              下一页
              <ChevronRight size={15} />
            </Button>
          </div>
        )}
      </>
    </section>
  );
}
