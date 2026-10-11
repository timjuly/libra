import { useState, type FormEvent } from 'react';
import { ArrowRight, Link2, LockKeyhole, Radio, Server, ShieldCheck } from 'lucide-react';
import { PLAYERS } from '../../shared/players';
import { validatePassword } from '../../shared/validation';
import { Brand, Button, Field, PasswordInput, Message, Strength } from '../components/ui';
import { api, errorMessage } from '../api';

export function Login({
  initialized,
  configured,
  onLogin,
}: {
  initialized: boolean;
  configured: boolean;
  onLogin: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [setupKey, setSetupKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (!initialized) {
        validatePassword(password);
        if (password !== confirm) throw new Error('两次输入的密码不一致');
      }
      await api(`/api/auth/${initialized ? 'login' : 'setup'}`, 'POST', {
        password,
        ...(!initialized ? { setupKey } : {}),
      });
      setPassword('');
      setConfirm('');
      setSetupKey('');
      onLogin();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-story">
        <Brand />
        <div className="auth-story-content">
          <span className="eyebrow">
            <i /> ONE HOME FOR YOUR MEDIA
          </span>
          <h1>
            所有热爱，
            <br />
            从这里连接。
          </h1>
          <p>
            把分散的媒体服务器整理在一起。
            <br />
            一次维护，随心打开你喜欢的播放器。
          </p>
          <div className="orbit-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit-center">
              <span className="brand-mark large">
                <span />
              </span>
            </div>
            <div className="orbit-node node-one">
              <Server size={24} />
            </div>
            <div className="orbit-node node-two">
              <Radio size={25} />
            </div>
            <div className="orbit-node node-three">
              <Link2 size={24} />
            </div>
            <span className="orbit-dot dot-one" />
            <span className="orbit-dot dot-two" />
          </div>
          <div className="auth-players">
            {PLAYERS.map((player) => (
              <span key={player.id}>{player.name}</span>
            ))}
          </div>
        </div>
        <span className="auth-footnote">少一点重复配置，多一点观影时光。</span>
      </div>
      <main className="auth-main">
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        <div className="auth-form">
          <span className="auth-lock">
            <LockKeyhole size={24} />
          </span>
          <span className="eyebrow neutral">LIBRA WORKSPACE</span>
          <h2>{initialized ? '欢迎回来' : '创建你的连接空间'}</h2>
          <p>
            {initialized
              ? '输入管理密码，回到你的媒体工作台。'
              : '先设置管理密码，让每一份配置都有安全的归处。'}
          </p>
          {!configured ? (
            <Message tone="error">
              部署还差一步：在 Cloudflare 的 Worker 设置中添加至少 32 位的 APP_SECRET
              密钥，然后刷新页面。建议使用随机生成的 64 位十六进制字符串。
            </Message>
          ) : (
            <form onSubmit={submit}>
              {!initialized && (
                <Field label="部署密钥" hint="填写部署时设置的 APP_SECRET，仅用于首次初始化。">
                  <PasswordInput
                    value={setupKey}
                    onChange={setSetupKey}
                    placeholder="验证这个空间属于你"
                    required
                  />
                </Field>
              )}
              <Field label={initialized ? '管理密码' : '设置管理密码'}>
                <PasswordInput
                  value={password}
                  onChange={setPassword}
                  autoComplete={initialized ? 'current-password' : 'new-password'}
                  placeholder={initialized ? '输入你的管理密码' : '至少 8 位，包含字母、数字和符号'}
                  required
                />
              </Field>
              {!initialized && (
                <>
                  <Strength password={password} />
                  <Field label="确认管理密码">
                    <PasswordInput
                      value={confirm}
                      onChange={setConfirm}
                      placeholder="再次输入管理密码"
                      required
                    />
                  </Field>
                </>
              )}
              {error && <Message tone="error">{error}</Message>}
              <Button type="submit" busy={busy} className="full">
                {initialized ? '进入工作台' : '创建并进入工作台'}
                <ArrowRight size={17} />
              </Button>
            </form>
          )}
          <div className="auth-assurance">
            <ShieldCheck size={15} />
            私有管理 · 加密存储 · 自由连接
          </div>
        </div>
        <div className="auth-copyright">
          LIBRA <span>为你的媒体生活，留一份秩序。</span>
        </div>
      </main>
    </div>
  );
}
