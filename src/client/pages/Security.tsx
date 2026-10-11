import { useState, type FormEvent } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { validatePassword } from '../../shared/validation';
import { Button, Field, PasswordInput, Message, Strength } from '../components/ui';
import { api, errorMessage } from '../api';

export function Security() {
  const [currentPassword, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess(false);
    try {
      validatePassword(password);
      if (password !== confirmation) throw new Error('两次输入的新密码不一致');
      await api('/api/auth/password', 'POST', { currentPassword, password });
      setCurrent('');
      setPassword('');
      setConfirmation('');
      setSuccess(true);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="security-layout">
      <section className="panel security-panel">
        <div className="panel-heading">
          <span className="feature-icon">
            <KeyRound size={20} />
          </span>
          <div>
            <h2>管理密码</h2>
            <p>为你的媒体空间换一把新钥匙。</p>
          </div>
        </div>
        <form onSubmit={submit}>
          <Field label="当前密码">
            <PasswordInput
              value={currentPassword}
              onChange={setCurrent}
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="新密码">
            <PasswordInput
              value={password}
              onChange={setPassword}
              placeholder="至少 8 位，包含字母、数字和符号"
              required
            />
          </Field>
          <Strength password={password} />
          <Field label="确认新密码">
            <PasswordInput
              value={confirmation}
              onChange={setConfirmation}
              placeholder="再次输入新密码"
              required
            />
          </Field>
          {error && <Message tone="error">{error}</Message>}
          {success && <Message tone="success">密码已更新。其他会话将在配置传播后失效。</Message>}
          <Button type="submit" busy={busy}>
            <ShieldCheck size={17} />
            更新管理密码
          </Button>
        </form>
      </section>
      <aside className="security-aside">
        <ShieldCheck size={28} />
        <h3>安全感，来自细节。</h3>
        <p>管理密码保存为加盐校验哈希；服务器配置加密存储。每一次登录都有独立的会话，有效期为 12 小时。</p>
        <div className="section-divider" />
        <strong>请保管好订阅链接</strong>
        <p>持有链接的人可以读取其中的账号密码。使用随机后缀，并在不再需要时停用链接。</p>
        <strong>保留部署密钥的备份</strong>
        <p>APP_SECRET 用于解密已有数据，重新部署时请保持不变。</p>
      </aside>
    </div>
  );
}
