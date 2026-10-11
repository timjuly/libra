import { useEffect, useState } from 'react';
import { ArrowDownToLine, Copy, Link2 } from 'lucide-react';
import type { Subscription } from '../../shared/types';
import { Spinner, Button, Message } from '../components/ui';
import { Modal } from '../components/Modal';
import { feedURL } from '../helpers';
import QRCode from 'qrcode';

export function SubscriptionQR({
  subscription,
  close,
  copy,
}: {
  subscription: Subscription;
  close: () => void;
  copy: (value: string) => void;
}) {
  const url = feedURL(subscription.slug);
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(url, {
      width: 600,
      margin: 4,
      errorCorrectionLevel: 'M',
      color: { dark: '#252b43', light: '#ffffff' },
    })
      .then((value) => {
        if (active) setImage(value);
      })
      .catch(() => {
        if (active) setError('二维码生成失败，请关闭后重试');
      });
    return () => {
      active = false;
    };
  }, [url]);
  return (
    <Modal title="扫描，带走这份连接" subtitle={subscription.name} close={close}>
      <div className="modal-body qr-body">
        <div className="qr-frame">
          {image ? (
            <img src={image} width={260} height={260} alt={`${subscription.name} 的订阅链接二维码`} />
          ) : error ? (
            <Message tone="error">{error}</Message>
          ) : (
            <Spinner />
          )}
        </div>
        <p className="qr-caption">在客户端扫描二维码，获取订阅链接</p>
        <div className="url-preview">
          <Link2 size={15} />
          <span>{url}</span>
        </div>
        {!subscription.enabled && <Message tone="error">这条订阅已停用，请启用后再扫描获取配置。</Message>}
        <p className="field-note">二维码与订阅链接拥有相同访问权限，请只向可信的人展示。</p>
      </div>
      <div className="modal-footer">
        <Button variant="secondary" onClick={() => copy(url)}>
          <Copy size={16} />
          复制链接
        </Button>
        {image && (
          <a className="button primary" href={image} download={`libra-subscription-${subscription.slug}.png`}>
            <ArrowDownToLine size={16} />
            下载二维码
          </a>
        )}
      </div>
    </Modal>
  );
}
