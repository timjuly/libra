import React, { useState, type ReactNode } from 'react';
import { Check, CheckCheck, CircleHelp, Eye, EyeOff, LoaderCircle, ShieldCheck } from 'lucide-react';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'compact' : ''}`}>
      <span className="brand-mark">
        <span />
      </span>
      <div>
        Libra<small>你的媒体连接中心</small>
      </div>
    </div>
  );
}

export function Spinner() {
  return <LoaderCircle className="spin" size={18} aria-label="加载中" />;
}

export function Button({
  children,
  variant = 'primary',
  busy = false,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  busy?: boolean;
}) {
  return (
    <button {...props} disabled={props.disabled || busy} className={`button ${variant} ${className}`}>
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button {...props} type="button" className="icon-button" aria-label={label} title={label}>
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
  optional = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  optional?: boolean;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {optional && <em>选填</em>}
      </span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete = 'new-password',
  placeholder = '输入密码',
  required = false,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-input">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
        maxLength={1024}
      />
      <button
        type="button"
        aria-label={visible ? '隐藏密码' : '显示密码'}
        onClick={() => setVisible(!visible)}
      >
        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}

export function Message({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'error' | 'success';
}) {
  return (
    <div className={`message ${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      {tone === 'error' ? (
        <CircleHelp size={17} />
      ) : tone === 'success' ? (
        <CheckCheck size={17} />
      ) : (
        <ShieldCheck size={17} />
      )}
      <span>{children}</span>
    </div>
  );
}

export function Strength({ password }: { password: string }) {
  const checks = [
    password.length >= 8,
    /[A-Za-z]/.test(password),
    /[0-9]/.test(password),
    /[^\p{L}\p{N}\s]/u.test(password),
  ];
  return (
    <div className="strength">
      <div className="strength-bars">
        {checks.map((valid, index) => (
          <i key={index} className={valid ? 'valid' : ''} />
        ))}
      </div>
      <p>
        {['至少 8 位', '字母', '数字', '符号'].map((label, index) => (
          <span key={label} className={checks[index] ? 'valid' : ''}>
            {checks[index] && <Check size={11} />}
            {label}
          </span>
        ))}
      </p>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`switch ${checked ? 'on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
    >
      <span />
    </button>
  );
}

export function Empty({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        {icon}
        <span>+</span>
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
