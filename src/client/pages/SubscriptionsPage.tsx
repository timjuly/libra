import {
  Copy,
  ExternalLink,
  Globe2,
  Link2,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Trash2,
  QrCode,
} from 'lucide-react';
import type { DashboardData, Subscription } from '../../shared/types';
import { Spinner, Button, IconButton, Switch, Empty } from '../components/ui';
import { feedURL } from '../helpers';
import type { DialogState } from '../types';

export function SubscriptionsPage({
  data,
  loading,
  load,
  setDialog,
  toggleSubscription,
  busyId,
  copy,
}: {
  data: DashboardData;
  loading: boolean;
  load: () => Promise<void>;
  setDialog: (value: DialogState) => void;
  toggleSubscription: (subscription: Subscription) => Promise<void>;
  busyId: string;
  copy: (value: string) => Promise<void>;
}) {
  return (
    <>
      <div className="collection-heading">
        <h2>
          我的订阅 <span>{data.subscriptions.length}</span>
        </h2>
        <IconButton label="刷新订阅" disabled={loading} onClick={() => void load()}>
          <RefreshCw size={17} className={loading ? 'spin' : ''} />
        </IconButton>
      </div>
      {loading ? (
        <div className="loading-state">
          <Spinner />
          正在加载订阅…
        </div>
      ) : data.subscriptions.length ? (
        <div className="subscriptions-list">
          {data.subscriptions.map((subscription) => (
            <article
              className={`subscription-card ${!subscription.enabled ? 'disabled-card' : ''}`}
              key={subscription.id}
            >
              <div className="subscription-top">
                <span className="subscription-icon">
                  <Link2 size={22} />
                </span>
                <div>
                  <h3>{subscription.name}</h3>
                  <p>
                    {subscription.allServers
                      ? '全部已启用服务器 · 自动包含新增'
                      : `${subscription.serverIds.filter((id) => data.servers.some((server) => server.id === id)).length} 台指定服务器`}
                  </p>
                </div>
                <span className={`status-label ${subscription.enabled ? 'enabled' : ''}`}>
                  <i />
                  {subscription.enabled ? '已启用' : '已停用'}
                </span>
                <Switch
                  checked={subscription.enabled}
                  label={`启用 ${subscription.name}`}
                  disabled={!!busyId}
                  onChange={() => void toggleSubscription(subscription)}
                />
              </div>
              <div className="subscription-url">
                <Globe2 size={16} />
                <code>{feedURL(subscription.slug)}</code>
                <IconButton
                  label={`复制 ${subscription.name} 链接`}
                  onClick={() => void copy(feedURL(subscription.slug))}
                >
                  <Copy size={17} />
                </IconButton>
              </div>
              <div className="subscription-bottom">
                <span>创建于 {new Date(subscription.createdAt).toLocaleDateString('zh-CN')}</span>
                <div>
                  <button className="text-button" onClick={() => setDialog({ kind: 'qr', subscription })}>
                    <QrCode size={15} />
                    二维码
                  </button>
                  <a
                    href={feedURL(subscription.slug)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-button"
                  >
                    <ExternalLink size={14} />
                    查看 JSON
                  </a>
                  <button
                    className="text-button"
                    onClick={() => setDialog({ kind: 'subscription', subscription })}
                  >
                    <Settings2 size={15} />
                    管理链接
                  </button>
                  <IconButton
                    label={`删除 ${subscription.name}`}
                    onClick={() => setDialog({ kind: 'deleteSubscription', subscription })}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          icon={<Link2 size={30} />}
          title="让配置，多走一步"
          description="创建一个专属订阅地址，供客户端自动拉取服务器配置。"
        >
          <Button onClick={() => setDialog({ kind: 'subscription' })}>
            <Plus size={17} />
            创建第一条订阅
          </Button>
        </Empty>
      )}
      <div className="subscription-notice">
        <ShieldCheck size={21} />
        <div>
          <strong>链接即访问权限，请谨慎分享</strong>
          <p>
            订阅会返回账号密码。停用、更换后缀或删除后的传播可能需要一分钟或更久；客户端已保存的数据不会被远程删除。
          </p>
        </div>
      </div>
    </>
  );
}
