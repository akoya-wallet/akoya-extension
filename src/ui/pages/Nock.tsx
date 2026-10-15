// Nockchain (NOCK), read-only: the asset row on the home screen, the receive/balance sheet, and the
// settings page that turns it on (password → address derived in an isolated worker).
import { useEffect, useState } from 'react';
import * as W from '../../ext/wallet.ts';
import { DEFAULT_NOCK_RPC, normalizeNockRpc } from '../../ext/nockrpc.ts';
import { requestOrigin } from '../../ext/platform.ts';
import { formatNock } from '../../nock/index.ts';
import type { NockConfig, NockOverview, SessionInfo } from '../../ext/types.ts';
import { useI18n } from '../../i18n/index.tsx';
import { Btn, Notice, PasswordField, QrCode, Sheet, Topbar, useCopy, useToast } from '../components/common.tsx';
import { IconChevron, IconCopy } from '../components/icons.tsx';

export type NockState = { cfg: NockConfig | null; ov?: NockOverview; error?: unknown };

export function NockCard({ state, onOpen }: { state: NockState; onOpen: () => void }) {
  const { t, te } = useI18n();
  if (!state.cfg?.address || !state.cfg.available) return null;
  const ov = state.ov;
  const immature = ov ? BigInt(ov.immature) : 0n;
  return (
    <button className="item nock-card" onClick={onOpen}>
      <span className="tx-ic nock">N</span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="title">NOCK</div>
        <div className="meta ellipsis">{state.error && !ov ? <span className="red">{te(state.error)}</span> : t('nock.card_sub')}</div>
      </div>
      <div className="right">
        <div className="amt">{ov ? formatNock(ov.spendable) : '…'}<span className="u">NOCK</span></div>
        {immature > 0n && <div className="meta amber">{t('nock.maturing', { amount: formatNock(immature) })}</div>}
      </div>
      <span className="faint chev"><IconChevron /></span>
    </button>
  );
}

export function NockSheet({ address, ov, onClose }: { address: string; ov?: NockOverview; onClose: () => void }) {
  const { t } = useI18n();
  const copy = useCopy();
  return (
    <Sheet onClose={onClose}>
      <div className="stack">
        <div className="pnl-head">
          <div className="muted">NOCK · {t('nock.balance')}</div>
          <div className="pnl-big">{ov ? formatNock(ov.spendable) : '…'} <span className="muted" style={{ fontSize: 16 }}>NOCK</span></div>
          {ov && BigInt(ov.immature) > 0n && <div className="tiny amber">{t('nock.maturing', { amount: `${formatNock(ov.immature)} NOCK` })}</div>}
        </div>
        <div className="section-title" style={{ margin: '4px 2px 0' }}>{t('nock.receive')}</div>
        <QrCode text={address} />
        <div className="addr-box mono" style={{ textAlign: 'center' }}>{address}</div>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Btn className="sm" onClick={() => copy(address, t('receive.copied'))}><IconCopy />{t('common.copy')}</Btn>
        </div>
        <Notice kind="info">{t('nock.receive_notice')}</Notice>
        {ov && <p className="tiny faint center" style={{ margin: 0 }}>{t('nock.meta', { n: ov.notes, height: Number(ov.height).toLocaleString(), host: ov.rpcHost })}</p>}
        <p className="tiny faint center" style={{ margin: 0 }}>{t('nock.readonly')}</p>
        <Btn className="block" onClick={onClose}>{t('pnl.close')}</Btn>
      </div>
    </Sheet>
  );
}

export function NockSettings({ session, onBack, onLocked }: { session: SessionInfo; onBack: () => void; onLocked: () => void }) {
  const { t, te } = useI18n();
  const toast = useToast();
  const copy = useCopy();
  const [cfg, setCfg] = useState<NockConfig | null>(null);
  const [pw, setPw] = useState('');
  const [rpc, setRpc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rpcError, setRpcError] = useState<string | null>(null);

  useEffect(() => {
    void W.nockConfig().then(c => {
      setCfg(c);
      setRpc(c.rpc);
    });
  }, []);

  const run = async (fn: () => Promise<void>, onErr = setError) => {
    setBusy(true);
    onErr(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof W.LockedError) return onLocked();
      onErr(te(e));
    } finally {
      setBusy(false);
    }
  };
  const enable = () => run(async () => {
    try {
      setCfg(await W.enableNock(pw));
      toast(t('nock.enabled_toast'));
    } finally {
      setPw('');
    }
  });
  const saveRpc = () => run(async () => {
    const url = normalizeNockRpc(rpc);
    // the default node allows cross-origin calls; any other one needs access to its origin
    if (new URL(url).origin !== new URL(DEFAULT_NOCK_RPC).origin && !(await requestOrigin(url))) throw new Error(t('idx.denied'));
    const s = await W.setNockRpc(url);
    setRpc(s.nockRpc);
    setCfg(c => (c ? { ...c, rpc: s.nockRpc } : c));
    toast(t('nock.rpc_saved'));
  }, setRpcError);

  if (session.network !== 'mainnet') {
    return (
      <div className="screen">
        <Topbar title={t('nock.title')} onBack={onBack} />
        <div className="scroll"><Notice kind="info">{t('nock.mainnet_only')}</Notice></div>
      </div>
    );
  }

  return (
    <div className="screen">
      <Topbar title={t('nock.title')} onBack={onBack} />
      <div className="scroll">
        {!cfg ? (
          <div className="skeleton" style={{ height: 120 }} />
        ) : (
          <div className="stack">
            <p className="muted" style={{ margin: 0 }}>{t('nock.intro')}</p>
            <Notice kind="info">{t('nock.readonly')}</Notice>

            {cfg.address ? (
              <>
                <div className="section-title" style={{ margin: '6px 2px 0' }}>{t('nock.address')}</div>
                <button className="addr-box mono" style={{ textAlign: 'left', cursor: 'pointer', border: 0, color: 'inherit', width: '100%' }} onClick={() => copy(cfg.address!, t('receive.copied'))}>{cfg.address}</button>
                <Btn className="block danger" loading={busy} onClick={() => run(async () => setCfg(await W.disableNock()))}>{t('nock.disable')}</Btn>
              </>
            ) : (
              <>
                <p className="tiny faint" style={{ margin: 0 }}>{t('nock.enable_hint')}</p>
                <PasswordField label="" value={pw} onChange={setPw} onEnter={enable} error={error} />
                <Btn className="primary block" loading={busy} disabled={!pw} onClick={enable}>{t('nock.enable')}</Btn>
              </>
            )}
            {error && cfg.address && <div className="hint err">{error}</div>}

            <div className="section-title" style={{ margin: '10px 2px 0' }}>
              <span>{t('nock.rpc')}</span>
              <span className="tiny faint">{t('nock.rpc_hint')}</span>
            </div>
            <div className="row">
              <input className="input mono" value={rpc} spellCheck={false} autoComplete="off" placeholder={DEFAULT_NOCK_RPC} onChange={e => setRpc(e.target.value)} />
              <Btn className="sm" loading={busy} disabled={!rpc.trim() || rpc === cfg.rpc} onClick={saveRpc}>{t('common.save')}</Btn>
            </div>
            {rpcError && <div className="hint err">{rpcError}</div>}
            <p className="tiny faint" style={{ margin: 0 }}>{t('nock.privacy', { host: safeHost(cfg.rpc) })}</p>
          </div>
        )}
      </div>
    </div>
  );
}

const safeHost = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};
