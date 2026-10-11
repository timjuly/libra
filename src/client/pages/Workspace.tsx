import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  ChevronDown,
  CircleHelp,
  Images,
  Link2,
  LockKeyhole,
  LogOut,
  Menu,
  Plus,
  Server,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import type {
  CatalogWrite,
  DashboardData,
  IconLibrary,
  ServerRecord,
  Subscription,
} from '../../shared/types';
import { Brand, Button, IconButton, Message } from '../components/ui';
import { ServerEditor } from '../dialogs/ServerEditor';
import { SubscriptionEditor } from '../dialogs/SubscriptionEditor';
import { ImportDialog } from '../dialogs/ImportDialog';
import { JsonImport } from '../dialogs/JsonImport';
import { SubscriptionQR } from '../dialogs/SubscriptionQR';
import { ConfirmDialog } from '../dialogs/ConfirmDialog';
import { Help } from '../dialogs/Help';
import { Security } from './Security';
import { ServersPage } from './ServersPage';
import { SubscriptionsPage } from './SubscriptionsPage';
import { api, errorMessage } from '../api';
import { titleOf } from '../helpers';
import type { DialogState, Page } from '../types';
import { Toast } from '../components/Toast';
import { IconLibrariesPage } from './IconLibrariesPage';
import { IconLibraryEditor } from '../dialogs/IconLibraryEditor';
import { IconBrowser } from '../components/IconBrowser';
import { Modal } from '../components/Modal';
import { GitHubSettings } from '../dialogs/GitHubSettings';

export function Workspace({ logout }: { logout: () => void }) {
  const [data, setData] = useState<DashboardData>({
    servers: [],
    subscriptions: [],
    iconLibraries: [],
    revisions: { servers: '', iconLibraries: '' },
  });
  const [page, setPage] = useState<Page>('servers');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toast, setToast] = useState('');
  const [busyId, setBusyId] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function notify(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3500);
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify('已复制到剪贴板');
    } catch {
      notify('复制失败，请检查浏览器剪贴板权限');
    }
  }
  async function load() {
    setLoading(true);
    setError('');
    try {
      setData(await api<DashboardData>('/api/dashboard'));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);
  function saveServer({ catalogRevision, ...record }: CatalogWrite<ServerRecord>) {
    setData((previous) => ({
      ...previous,
      revisions: { ...previous.revisions, servers: catalogRevision },
      servers: previous.servers.some((item) => item.id === record.id)
        ? previous.servers.map((item) => (item.id === record.id ? record : item))
        : [...previous.servers, record],
    }));
    notify('服务器已保存');
  }
  function saveSubscription(record: Subscription) {
    setData((previous) => ({
      ...previous,
      subscriptions: previous.subscriptions.some((item) => item.id === record.id)
        ? previous.subscriptions.map((item) => (item.id === record.id ? record : item))
        : [record, ...previous.subscriptions],
    }));
    notify('订阅链接已保存');
  }
  function saveIconLibrary({ catalogRevision, ...record }: CatalogWrite<IconLibrary>) {
    setData((previous) => ({
      ...previous,
      revisions: { ...previous.revisions, iconLibraries: catalogRevision },
      iconLibraries: previous.iconLibraries.some((item) => item.id === record.id)
        ? previous.iconLibraries.map((item) => (item.id === record.id ? record : item))
        : [...previous.iconLibraries, record],
    }));
    notify('图标库已保存');
  }
  async function toggleServer(server: ServerRecord) {
    setBusyId(server.id);
    try {
      saveServer(
        await api<CatalogWrite<ServerRecord>>(`/api/servers/${server.id}`, 'PUT', {
          version: server.version,
          enabled: !server.enabled,
          catalogRevision: data.revisions.servers,
        }),
      );
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBusyId('');
    }
  }
  async function toggleSubscription(subscription: Subscription) {
    setBusyId(subscription.id);
    try {
      saveSubscription(
        await api<Subscription>(`/api/subscriptions/${subscription.id}`, 'PUT', {
          version: subscription.version,
          enabled: !subscription.enabled,
        }),
      );
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBusyId('');
    }
  }
  const titles = {
    servers: '服务器',
    subscriptions: '订阅链接',
    icons: '图标库',
    security: '安全设置',
  };
  return (
    <div className="app-shell">
      {mobileNav && (
        <button className="nav-backdrop" aria-label="关闭导航" onClick={() => setMobileNav(false)} />
      )}
      <aside className={`sidebar ${mobileNav ? 'is-open' : ''}`}>
        <Brand />
        <div className="nav-label">我的工作台</div>
        <nav>
          {(
            [
              { id: 'servers', title: '服务器', icon: <Server size={19} />, count: data.servers.length },
              {
                id: 'subscriptions',
                title: '订阅链接',
                icon: <Link2 size={19} />,
                count: data.subscriptions.length,
              },
              { id: 'icons', title: '图标库', icon: <Images size={19} />, count: data.iconLibraries.length },
              { id: 'security', title: '安全设置', icon: <ShieldCheck size={19} /> },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={page === item.id ? 'active' : ''}
              onClick={() => {
                setPage(item.id);
                setMobileNav(false);
              }}
            >
              {item.icon}
              <span>{item.title}</span>
              {'count' in item && <em>{item.count}</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-user">
            <span className="avatar">
              <UserRound size={20} />
            </span>
            <div>
              <strong>管理员</strong>
              <small>私人媒体空间</small>
            </div>
            <IconButton
              label="退出登录"
              onClick={async () => {
                try {
                  await api('/api/auth/logout', 'POST');
                  logout();
                } catch (error) {
                  notify(errorMessage(error));
                }
              }}
            >
              <LogOut size={17} />
            </IconButton>
          </div>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              aria-label="打开导航"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={21} />
            </button>
            <span>工作台</span>
            <ChevronDown size={12} className="breadcrumb-arrow" />
            <strong>{titles[page]}</strong>
          </div>
          <div className="topbar-right">
            <span className="private-badge">
              <LockKeyhole size={13} />
              私人空间
            </span>
            <IconButton label="使用指南" onClick={() => setDialog({ kind: 'help' })}>
              <CircleHelp size={19} />
            </IconButton>
            <span className="topbar-avatar">L</span>
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <h1>
                {titles[page]}
                <span className="heading-dot">.</span>
              </h1>
            </div>
            {page !== 'security' && (
              <Button
                onClick={() =>
                  setDialog(
                    page === 'servers'
                      ? { kind: 'server' }
                      : page === 'icons'
                        ? { kind: 'iconLibrary' }
                        : { kind: 'subscription' },
                  )
                }
              >
                <Plus size={18} />
                {page === 'servers' ? '添加服务器' : page === 'icons' ? '添加图标库' : '创建订阅'}
              </Button>
            )}
          </div>
          {error && (
            <Message tone="error">
              {error}{' '}
              <button className="text-button" onClick={() => void load()}>
                重新加载
              </button>
            </Message>
          )}
          {page === 'servers' && (
            <ServersPage
              data={data}
              loading={loading}
              load={load}
              setDialog={setDialog}
              toggleServer={toggleServer}
              busyId={busyId}
            />
          )}
          {page === 'subscriptions' && (
            <SubscriptionsPage
              data={data}
              loading={loading}
              load={load}
              setDialog={setDialog}
              toggleSubscription={toggleSubscription}
              busyId={busyId}
              copy={copy}
            />
          )}
          {page === 'security' && <Security />}
          {page === 'icons' && (
            <IconLibrariesPage
              libraries={data.iconLibraries}
              loading={loading}
              load={load}
              setDialog={setDialog}
            />
          )}
          <footer className="workspace-footer">
            <span>
              Libra <i />
              你的媒体，自由连接。
            </span>
            <button onClick={() => setDialog({ kind: 'help' })}>
              使用指南
              <ArrowUpRight size={12} />
            </button>
          </footer>
        </div>
      </main>
      <Toast message={toast} />
      {dialog?.kind === 'server' && (
        <ServerEditor
          server={dialog.server}
          iconLibraries={data.iconLibraries}
          catalogRevision={data.revisions.servers}
          close={() => setDialog(null)}
          save={saveServer}
        />
      )}
      {dialog?.kind === 'subscription' && (
        <SubscriptionEditor
          subscription={dialog.subscription}
          servers={data.servers}
          close={() => setDialog(null)}
          save={saveSubscription}
        />
      )}
      {dialog?.kind === 'import' && (
        <ImportDialog
          server={dialog.server}
          close={() => setDialog(null)}
          copy={(value) => void copy(value)}
        />
      )}
      {dialog?.kind === 'json' && (
        <JsonImport
          close={() => setDialog(null)}
          save={saveServer}
          catalogRevision={data.revisions.servers}
        />
      )}
      {dialog?.kind === 'qr' && (
        <SubscriptionQR
          subscription={dialog.subscription}
          close={() => setDialog(null)}
          copy={(value) => void copy(value)}
        />
      )}
      {dialog?.kind === 'help' && <Help close={() => setDialog(null)} />}
      {dialog?.kind === 'githubSettings' && <GitHubSettings close={() => setDialog(null)} notify={notify} />}
      {dialog?.kind === 'iconLibrary' && (
        <IconLibraryEditor
          library={dialog.library}
          close={() => setDialog(null)}
          save={saveIconLibrary}
          catalogRevision={data.revisions.iconLibraries}
        />
      )}
      {dialog?.kind === 'browseIcons' && (
        <Modal title={dialog.library.name} close={() => setDialog(null)} wide>
          <div className="modal-body">
            <IconBrowser
              libraries={[dialog.library]}
              action="复制"
              onSelect={(icon) => void copy(icon.url)}
            />
          </div>
        </Modal>
      )}
      {dialog?.kind === 'deleteIconLibrary' && (
        <ConfirmDialog
          title={`删除「${dialog.library.name}」？`}
          description="删除后，这个图库将从选择列表中移除。已经保存的服务器 Logo 不受影响。"
          close={() => setDialog(null)}
          confirm={async () => {
            const result = await api<{ catalogRevision: string }>(
              `/api/icon-libraries/${dialog.library.id}`,
              'DELETE',
              {
                version: dialog.library.version,
                catalogRevision: data.revisions.iconLibraries,
              },
            );
            setData((previous) => ({
              ...previous,
              iconLibraries: previous.iconLibraries.filter((item) => item.id !== dialog.library.id),
              revisions: { ...previous.revisions, iconLibraries: result.catalogRevision },
            }));
            notify('图标库已删除');
          }}
        />
      )}
      {dialog?.kind === 'deleteServer' && (
        <ConfirmDialog
          title={`删除「${titleOf(dialog.server)}」？`}
          description="这台服务器会从工作台和后续订阅响应中移除。已经导入到播放器的配置不会被删除。"
          close={() => setDialog(null)}
          confirm={async () => {
            const result = await api<{ catalogRevision: string }>(
              `/api/servers/${dialog.server.id}`,
              'DELETE',
              { version: dialog.server.version, catalogRevision: data.revisions.servers },
            );
            setData((previous) => ({
              ...previous,
              servers: previous.servers.filter((item) => item.id !== dialog.server.id),
              revisions: { ...previous.revisions, servers: result.catalogRevision },
            }));
            notify('服务器已删除');
          }}
        />
      )}
      {dialog?.kind === 'deleteSubscription' && (
        <ConfirmDialog
          title={`删除「${dialog.subscription.name}」？`}
          description="删除后，此地址将在配置传播完成后停止返回数据。这个后缀可重新分配；仍持有旧链接的客户端届时会读到新订阅，已保存的配置不受影响。"
          close={() => setDialog(null)}
          confirm={async () => {
            await api(`/api/subscriptions/${dialog.subscription.id}`, 'DELETE', {
              version: dialog.subscription.version,
            });
            setData((previous) => ({
              ...previous,
              subscriptions: previous.subscriptions.filter((item) => item.id !== dialog.subscription.id),
            }));
            notify('订阅已删除');
          }}
        />
      )}
    </div>
  );
}
