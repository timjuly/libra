import { useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpRight,
  Globe2,
  Grid2X2,
  Link2,
  List,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  UserRound,
  Waypoints,
  X,
} from 'lucide-react';
import type { DashboardData, ServerRecord } from '../../shared/types';
import { Spinner, Button, IconButton, Empty } from '../components/ui';
import { titleOf } from '../helpers';
import type { DialogState } from '../types';

export function ServersPage({
  data,
  loading,
  load,
  setDialog,
  toggleServer,
  busyId,
}: {
  data: DashboardData;
  loading: boolean;
  load: () => Promise<void>;
  setDialog: (value: DialogState) => void;
  toggleServer: (server: ServerRecord) => Promise<void>;
  busyId: string;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [layout, setLayout] = useState('grid');
  const shown = data.servers.filter(
    (server) =>
      (filter === 'all' || server.enabled === (filter === 'enabled')) &&
      `${titleOf(server)} ${server.config.note ?? ''} ${server.config.primary.url} ${server.config.credentials?.username ?? ''}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const activeSubs = data.subscriptions.filter((item) => item.enabled).length;
  return (
    <>
      <div className="stats-grid">
        <div className="stat">
          <span className="stat-icon purple">
            <Server size={21} />
          </span>
          <div>
            <span>服务器总数</span>
            <strong>{loading ? '—' : data.servers.length}</strong>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon green">
            <Waypoints size={22} />
          </span>
          <div>
            <span>已启用线路</span>
            <strong>
              {loading
                ? '—'
                : data.servers
                    .filter((item) => item.enabled)
                    .reduce((n, item) => n + 1 + (item.config.alternates?.length ?? 0), 0)}
              <small>主线路与备用线路</small>
            </strong>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon orange">
            <Link2 size={21} />
          </span>
          <div>
            <span>已启用订阅</span>
            <strong>{loading ? '—' : activeSubs}</strong>
          </div>
        </div>
      </div>
      <div className="collection-heading">
        <h2>
          我的服务器 <span>{data.servers.length}</span>
        </h2>
        <button className="text-button muted-text" onClick={() => setDialog({ kind: 'json' })}>
          <ArrowDownToLine size={15} />从 JSON 添加
        </button>
      </div>
      <div className="toolbar">
        <div className="filter-tabs">
          {[
            ['all', '全部'],
            ['enabled', '已启用'],
            ['disabled', '已停用'],
          ].map(([id, title]) => (
            <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>
              {title}
            </button>
          ))}
        </div>
        <div className="toolbar-tools">
          <label className="search">
            <Search size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索名称、地址或账号"
              aria-label="搜索服务器"
            />
            {search && (
              <button onClick={() => setSearch('')} aria-label="清除搜索">
                <X size={14} />
              </button>
            )}
          </label>
          <div className="view-switch">
            <IconButton label="卡片视图" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}>
              <Grid2X2 size={17} />
            </IconButton>
            <IconButton label="列表视图" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}>
              <List size={18} />
            </IconButton>
          </div>
          <IconButton label="刷新服务器" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={17} className={loading ? 'spin' : ''} />
          </IconButton>
        </div>
      </div>
      {loading ? (
        <div className="loading-state">
          <Spinner />
          正在整理你的连接…
        </div>
      ) : shown.length ? (
        <div className={`server-grid ${layout === 'list' ? 'list-layout' : ''}`}>
          {shown.map((server, index) => (
            <article className={`server-card ${!server.enabled ? 'disabled-card' : ''}`} key={server.id}>
              <div className="server-card-top">
                <ServerArt server={server} index={index} />
                <div className="server-title">
                  <h3 title={titleOf(server)}>{titleOf(server)}</h3>
                  {server.config.note && <span>{server.config.note}</span>}
                </div>
                <IconButton
                  label={`编辑 ${titleOf(server)}`}
                  onClick={() => setDialog({ kind: 'server', server })}
                >
                  <Pencil size={16} />
                </IconButton>
              </div>
              <div className="server-details">
                <div>
                  <Globe2 size={15} />
                  <span title={server.config.primary.url}>
                    {server.config.primary.url.replace(/^https?:\/\//, '')}
                  </span>
                </div>
                <div>
                  <UserRound size={15} />
                  <span>{server.config.credentials?.username || '未填写账号'}</span>
                  <span className="route-count">
                    <Network size={13} />
                    {1 + (server.config.alternates?.length ?? 0)} 条线路
                  </span>
                </div>
              </div>
              <div className="server-card-footer">
                <button
                  className={`status-button ${server.enabled ? 'enabled' : ''}`}
                  disabled={!!busyId}
                  onClick={() => void toggleServer(server)}
                  title={server.enabled ? '点击停用订阅中的配置' : '点击启用配置'}
                >
                  <span />
                  {busyId === server.id ? '保存中' : server.enabled ? '已启用' : '已停用'}
                </button>
                <div>
                  <IconButton
                    label={`删除 ${titleOf(server)}`}
                    onClick={() => setDialog({ kind: 'deleteServer', server })}
                  >
                    <Trash2 size={15} />
                  </IconButton>
                  <button className="import-button" onClick={() => setDialog({ kind: 'import', server })}>
                    导入播放器
                    <ArrowUpRight size={15} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          icon={<Server size={30} />}
          title={search || filter !== 'all' ? '没有找到匹配的服务器' : '第一份连接，从这里开始'}
          description={
            search || filter !== 'all'
              ? '试试其他关键词，或切换筛选条件。'
              : '添加 Emby 服务器，把地址、账号和备用线路整理在一起。'
          }
        >
          {!search && filter === 'all' && (
            <Button onClick={() => setDialog({ kind: 'server' })}>
              <Plus size={17} />
              添加第一台服务器
            </Button>
          )}
        </Empty>
      )}
      <div className="collection-footnote">
        <ShieldCheck size={14} />
        <span>连接信息加密保存。启用状态表示纳入订阅，不代表服务器连通性。</span>
      </div>
    </>
  );
}
function ServerArt({ server, index }: { server: ServerRecord; index: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`server-art art-${index % 4}`}>
      {server.config.logo && /^https:\/\//i.test(server.config.logo) && !failed ? (
        <img
          src={server.config.logo}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <Server size={25} />
      )}
    </span>
  );
}
