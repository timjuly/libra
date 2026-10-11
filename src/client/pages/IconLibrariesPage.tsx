import { Images, KeyRound, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { IconLibrary } from '../../shared/types';
import type { DialogState } from '../types';
import { Button, Empty, IconButton, Spinner } from '../components/ui';

export function IconLibrariesPage({
  libraries,
  loading,
  load,
  setDialog,
}: {
  libraries: IconLibrary[];
  loading: boolean;
  load: () => Promise<void>;
  setDialog: (dialog: DialogState) => void;
}) {
  return (
    <>
      <div className="collection-heading">
        <h2>
          我的图标库 <span>{libraries.length}</span>
        </h2>
        <div className="icon-library-tools">
          <Button variant="secondary" onClick={() => setDialog({ kind: 'githubSettings' })}>
            <KeyRound size={15} />
            GitHub Token
          </Button>
          <IconButton label="刷新图标库列表" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={17} className={loading ? 'spin' : ''} />
          </IconButton>
        </div>
      </div>
      {loading ? (
        <div className="loading-state">
          <Spinner />
          正在加载图标库…
        </div>
      ) : libraries.length ? (
        <div className="icon-libraries-grid">
          {libraries.map((library) => (
            <article className="icon-library-card" key={library.id}>
              <div className="icon-library-heading">
                <span className="icon-library-symbol">
                  <Images size={23} />
                </span>
                <h3>{library.name}</h3>
              </div>
              <p className="icon-library-url" title={library.url}>
                {library.url}
              </p>
              <div className="icon-library-actions">
                <Button variant="secondary" onClick={() => setDialog({ kind: 'browseIcons', library })}>
                  <Images size={15} />
                  浏览图标
                </Button>
                <IconButton
                  label={`编辑 ${library.name}`}
                  onClick={() => setDialog({ kind: 'iconLibrary', library })}
                >
                  <Pencil size={16} />
                </IconButton>
                <IconButton
                  label={`删除 ${library.name}`}
                  onClick={() => setDialog({ kind: 'deleteIconLibrary', library })}
                >
                  <Trash2 size={16} />
                </IconButton>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          icon={<Images size={30} />}
          title="还没有图标库"
          description="添加一个图库，为服务器选择喜欢的 Logo。"
        >
          <Button onClick={() => setDialog({ kind: 'iconLibrary' })}>
            <Plus size={17} />
            添加第一个图标库
          </Button>
        </Empty>
      )}
    </>
  );
}
