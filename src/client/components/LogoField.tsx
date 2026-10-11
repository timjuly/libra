import { useState } from 'react';
import { Images, X } from 'lucide-react';
import type { IconLibrary } from '../../shared/types';
import { Button, Field } from './ui';
import { IconBrowser, IconImage } from './IconBrowser';

export function LogoField({
  value,
  onChange,
  libraries,
}: {
  value: string;
  onChange: (url: string) => void;
  libraries: IconLibrary[];
}) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="logo-field">
      <div className="logo-entry">
        <IconImage url={value} />
        <Field label="Logo 地址" optional>
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            type="url"
            placeholder="仅支持 HTTPS，例如：https://example.com/logo.png"
            maxLength={2048}
          />
        </Field>
      </div>
      <div className="logo-actions">
        <Button
          type="button"
          variant="secondary"
          aria-expanded={picking}
          onClick={() => setPicking(!picking)}
        >
          <Images size={15} />
          {picking ? '收起图库' : '从图库选择'}
        </Button>
        {value && (
          <Button type="button" variant="ghost" onClick={() => onChange('')}>
            <X size={14} />
            清除 Logo
          </Button>
        )}
      </div>
      {picking && (
        <IconBrowser
          libraries={libraries}
          selected={value}
          onSelect={(icon) => {
            onChange(icon.url);
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}
