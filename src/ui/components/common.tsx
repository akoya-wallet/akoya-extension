import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import QRCode from 'qrcode';
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
  return async (text: string, label = '已复制') => {
    try {
      await navigator.clipboard.writeText(text);
      toast(label);
    } catch {
      toast('复制失败');
    }
  };
}

// ---------- layout ----------
export function Topbar({ title, onBack, onClose, right }: { title?: ReactNode; onBack?: () => void; onClose?: () => void; right?: ReactNode }) {
  return (
    <div className="topbar">
      {onBack ? (
        <button className="icon-btn" onClick={onBack} aria-label="返回">
          <IconBack />
        </button>
      ) : (
        <span style={{ width: 36 }} />
      )}
      <h1>{title}</h1>
      {right ?? (onClose ? (
        <button className="icon-btn" onClick={onClose} aria-label="关闭">
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
  label = '密码',
  placeholder = '输入密码',
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
  return (
    <div className="field">
      {label && <label>{label}</label>}
      <input
        className={`input ${error ? 'err' : ''}`}
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
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
  return <div className="qr">{src && <img src={src} alt="地址二维码" />}</div>;
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
