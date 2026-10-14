import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { LANGUAGES, useI18n } from '../../i18n/index.tsx';
import type { Language } from '../../ext/types.ts';
import { IconBack, IconClose, IconInfo, IconWarn } from './icons.tsx';

// ---------- toast ----------
const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number>(0);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 1800);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast">{msg}</div>}
    </ToastCtx.Provider>
  );
}

/** Copies non-secret text (addresses, txids). Mnemonics are never copied. */
export function useCopy() {
  const toast = useToast();
  const { t } = useI18n();
  return async (text: string, label = t('common.copied')) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(label);
    } catch {
      toast(t('common.copy_failed'));
    }
  };
}

// ---------- layout ----------
export function Topbar({ title, onBack, onClose, right }: { title?: ReactNode; onBack?: () => void; onClose?: () => void; right?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="topbar">
      {onBack ? (
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>
          <IconBack />
        </button>
      ) : (
        <span style={{ width: 36 }} />
      )}
      <h1>{title}</h1>
      {right ?? (onClose ? (
        <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
          <IconClose />
        </button>
      ) : (
        <span style={{ width: 36 }} />
      ))}
    </div>
  );
}

export function Steps({ n, of }: { n: number; of: number }) {
  return (
    <div className="steps">
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={i < n ? 'on' : ''} />
      ))}
    </div>
  );
}

export function Btn({ loading, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button className={`btn ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="spinner" /> : children}
    </button>
  );
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'danger' | 'ok'; children: ReactNode }) {
  return (
    <div className={`notice ${kind}`}>
      {kind === 'info' || kind === 'ok' ? <IconInfo /> : <IconWarn />}
      <div>{children}</div>
    </div>
  );
}

export function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="grab" />
        {children}
      </div>
    </div>
  );
}

export function PasswordField({
  value,
  onChange,
  label,
  placeholder,
  autoFocus,
  onEnter,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
  error?: string | null;
}) {
  const { t } = useI18n();
  const shownLabel = label ?? t('common.password');
  return (
    <div className="field">
      {shownLabel && <label>{shownLabel}</label>}
      <input
        className={`input ${error ? 'err' : ''}`}
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder ?? t('common.password_ph')}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && onEnter?.()}
      />
      {error && <span className="hint err">{error}</span>}
    </div>
  );
}

export function Kv({ k, children }: { k: ReactNode; children: ReactNode }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className="v">{children}</span>
    </div>
  );
}

/** Highlights the network prefix and the last 8 chars to make address checks easier. */
export function FullAddress({ address, hrp }: { address: string; hrp: string }) {
  const head = hrp.length + 2;
  return (
    <span className="mono">
      <b className="green">{address.slice(0, head)}</b>
      {address.slice(head, -8)}
      <b className="green">{address.slice(-8)}</b>
    </span>
  );
}

export function QrCode({ text }: { text: string }) {
  const { t } = useI18n();
  const [src, setSrc] = useState<string>('');
  useEffect(() => {
    let alive = true;
    QRCode.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#16151b', light: '#ffffff' } })
      .then(svg => alive && setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`))
      .catch(() => alive && setSrc(''));
    return () => {
      alive = false;
    };
  }, [text]);
  return <div className="qr">{src && <img src={src} alt={t('common.qr_alt')} />}</div>;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const run = useCallback(() => {
    setState(s => ({ ...s, loading: true }));
    fn().then(
      data => setState({ data, loading: false }),
      e => setState(s => ({ ...s, error: (e as Error).message, loading: false })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(run, [run]);
  return { ...state, reload: run };
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function LangSelect({ className = '' }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <select className={`lang-select ${className}`} aria-label={t('common.language')} value={lang} onChange={e => setLang(e.target.value as Language)}>
      {LANGUAGES.map(l => (
        <option key={l.id} value={l.id}>{l.label}</option>
      ))}
    </select>
  );
}
