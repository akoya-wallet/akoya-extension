import { useEffect, useMemo, useState } from 'react';
import { NETWORKS } from '../../core/networks.ts';
import { decodeAddress } from '../../core/address.ts';
import { estimateVsize } from '../../core/tx.ts';
import * as W from '../../ext/wallet.ts';
import { openTab } from '../../ext/platform.ts';
import { formatPrl, parsePrl, shortTxid } from '../../ext/format.ts';
import type { FeeEstimates, Overview, SendPreview, SessionInfo } from '../../ext/types.ts';
import { useI18n, type MsgKey } from '../../i18n/index.tsx';
import { Btn, FullAddress, Kv, Notice, PasswordField, Topbar, useCopy } from '../components/common.tsx';
import { IconCheck, IconCopy, IconExternal } from '../components/icons.tsx';

type Level = 'fast' | 'normal' | 'slow' | 'custom';
const LEVELS: { k: Exclude<Level, 'custom'>; label: MsgKey }[] = [
  { k: 'fast', label: 'send.fast' },
  { k: 'normal', label: 'send.normal' },
  { k: 'slow', label: 'send.slow' },
];

export function Send({ session, onBack, onLocked }: { session: SessionInfo; onBack: () => void; onLocked: () => void }) {
  const { t, te } = useI18n();
  const net = NETWORKS[session.network];
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [max, setMax] = useState(false);
  const [fees, setFees] = useState<FeeEstimates | null>(null);
  const [level, setLevel] = useState<Level>('normal');
  const [custom, setCustom] = useState('');
  const [ov, setOv] = useState<Overview | null>(null);
  const [preview, setPreview] = useState<SendPreview | null>(null);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const copy = useCopy();

  useEffect(() => {
    W.fees().then(setFees, e => (e instanceof W.LockedError ? onLocked() : setError(te(e))));
    W.overview().then(setOv, () => {});
  }, [onLocked, te]);

  const feeRate = useMemo(() => {
    if (level === 'custom') return Number(custom) || 0;
    return fees?.[level] ?? 1;
  }, [level, custom, fees]);

  const toTrim = to.trim();
  let addrErr: string | null = null;
  if (toTrim) {
    try {
      decodeAddress(toTrim, net);
    } catch (e) {
      addrErr = te(e);
    }
  }
  const addrOk = toTrim ? !addrErr : null;
  let amountErr: string | null = null;
  let amountGrains = 0n;
  if (!max && amount) {
    try {
      amountGrains = parsePrl(amount);
    } catch (e) {
      amountErr = te(e);
    }
  }
  const spendable = ov ? BigInt(ov.spendable) : null;
  const roughFee = BigInt(Math.ceil(estimateVsize(2, 2) * feeRate));
  if (!amountErr && spendable !== null && !max && amountGrains + roughFee > spendable) amountErr = t('send.insufficient_hint');
  const canReview = addrOk && (max || (amountGrains > 0n && !amountErr)) && feeRate >= 1;

  const review = async () => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await W.prepareSend({ to: toTrim, amount, feeRate, sendMax: max }));
    } catch (e) {
      if (e instanceof W.LockedError) return onLocked();
      setError(te(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const r = await W.confirmSend(preview.draftId, pw);
      setSent(r.txid);
    } catch (e) {
      if (e instanceof W.LockedError) return onLocked();
      setError(te(e));
    } finally {
      setPw('');
      setBusy(false);
    }
  };

  // ---------------- result
  if (sent) {
    return (
      <div className="screen">
        <Topbar title={t('send.sent_title')} onClose={onBack} />
        <div className="scroll center stack" style={{ paddingTop: 40 }}>
          <div className="tx-ic in" style={{ width: 64, height: 64, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'rgba(79,209,161,.14)', color: 'var(--green)' }}>
            <IconCheck />
          </div>
          <h2 style={{ margin: '8px 0 0' }}>{t('send.broadcast')}</h2>
          <p className="muted small" style={{ margin: 0 }}>{t('send.broadcast_sub', { amount: formatPrl(preview!.amount) })}</p>
          <div className="card" style={{ width: '100%' }}>
            <div className="label">{t('send.txid')}</div>
            <div className="mono mt">{sent}</div>
          </div>
          <div className="row">
            <Btn className="sm" onClick={() => copy(sent, t('send.txid_copied'))}><IconCopy />{t('common.copy')}</Btn>
            <Btn className="sm ghost" onClick={async () => openTab(await W.explorerUrl(session.network, 'tx', sent))}><IconExternal />{t('send.view')}</Btn>
          </div>
        </div>
        <div className="footer"><Btn className="primary" onClick={onBack}>{t('common.done')}</Btn></div>
      </div>
    );
  }

  // ---------------- review: render the full effective transaction before signing
  if (preview) {
    const expired = Date.now() > preview.expiresAt;
    return (
      <div className="screen">
        <Topbar title={t('send.confirm_title')} onBack={() => { W.discardDraft(preview.draftId); setPreview(null); setError(null); }} />
        <div className="scroll stack">
          <div className="balance" style={{ paddingTop: 4 }}>
            <span className="amount" style={{ fontSize: 30 }}>{formatPrl(preview.amount)}</span>
            <span className="unit">PRL</span>
          </div>
          <div className="card">
            <div className="label">{t('send.recipient_type', { type: preview.addressType === 'taproot' ? t('send.type_taproot') : t('send.type_p2mr') })}</div>
            <div className="mt"><FullAddress address={preview.to} hrp={preview.hrp} /></div>
          </div>
          <div className="card tight">
            <Kv k={t('send.network')}>{preview.networkLabel} ({preview.hrp})</Kv>
            <Kv k={t('send.amount_row')}>{formatPrl(preview.amount)} PRL</Kv>
            <Kv k={t('send.fee_row')}>{formatPrl(preview.fee)} PRL<div className="tiny faint">{preview.feeRate} grain/vB × {preview.vsize} vB</div></Kv>
            <Kv k={t('send.total')}><b>{formatPrl(preview.total)} PRL</b></Kv>
            <Kv k={t('send.change')}>{BigInt(preview.change) > 0n ? `${formatPrl(preview.change)} PRL` : t('send.none')}</Kv>
          </div>
          {preview.changeAddress && (
            <div className="card">
              <div className="label">{t('send.change_address', { path: preview.changePath ?? '' })}</div>
              <div className="mt"><FullAddress address={preview.changeAddress} hrp={preview.hrp} /></div>
            </div>
          )}
          <details className="card">
            <summary className="small muted" style={{ cursor: 'pointer' }}>{t('send.inputs', { count: preview.inputs.length })}</summary>
            {preview.inputs.map(i => (
              <Kv key={`${i.txid}:${i.vout}`} k={<span className="mono">{shortTxid(i.txid)}:{i.vout}</span>}>
                {formatPrl(i.value)}
                <div className="tiny faint">{i.path}</div>
              </Kv>
            ))}
          </details>
          {BigInt(preview.fee) * 10n > BigInt(preview.amount) && (
            <Notice kind="warn">{t('send.high_fee')}</Notice>
          )}
          <Notice kind="info">{t('send.sign_notice')}</Notice>
          <PasswordField label={t('send.password')} value={pw} onChange={setPw} onEnter={() => pw && !expired && confirm()} />
          {expired && <Notice kind="warn">{t('send.expired')}</Notice>}
          {error && <Notice kind="danger">{error}</Notice>}
        </div>
        <div className="footer">
          <Btn onClick={() => { W.discardDraft(preview.draftId); setPreview(null); }}>{t('common.cancel')}</Btn>
          <Btn className="primary" loading={busy} disabled={!pw || expired} onClick={confirm}>{t('send.sign')}</Btn>
        </div>
      </div>
    );
  }

  // ---------------- form
  return (
    <div className="screen">
      <Topbar title={t('send.title')} onBack={onBack} />
      <div className="scroll stack">
        <div className="field">
          <label>{t('send.to')}</label>
          <textarea
            className={`textarea ${addrOk === false ? 'err' : ''}`}
            style={{ minHeight: 64 }}
            value={to}
            autoFocus
            spellCheck={false}
            placeholder={`${net.hrp}1p…`}
            onChange={e => setTo(e.target.value.replace(/\s/g, ''))}
          />
          {addrErr && <span className="hint err">{addrErr}</span>}
          {addrOk && <span className="hint ok">{t('send.address_ok')}</span>}
        </div>
        <div className="field">
          <div className="row between">
            <label className="label">{t('send.amount')}</label>
            <span className="tiny muted">{t('send.available', { amount: spendable !== null ? formatPrl(spendable) : '…' })}</span>
          </div>
          <div className="input-wrap">
            <input
              className={`input ${amountErr ? 'err' : ''}`}
              inputMode="decimal"
              value={max ? t('send.max_value') : amount}
              disabled={max}
              placeholder="0.00"
              onChange={e => setAmount(e.target.value)}
            />
            <div className="suffix">
              <span className="small muted">PRL</span>
              <button className={`btn sm ${max ? 'primary' : ''}`} onClick={() => setMax(m => !m)}>MAX</button>
            </div>
          </div>
          {amountErr && <span className="hint err">{amountErr}</span>}
        </div>
        <div className="field">
          <label>{t('send.fee')}</label>
          <div className="seg">
            {LEVELS.map(l => (
              <button key={l.k} className={level === l.k ? 'on' : ''} onClick={() => setLevel(l.k)}>
                {t(l.label)}
                <span className="v">{fees ? (fees[l.k] ?? 1) : '…'}</span>
              </button>
            ))}
            <button className={level === 'custom' ? 'on' : ''} onClick={() => setLevel('custom')}>
              {t('send.custom')}<span className="v">grain/vB</span>
            </button>
          </div>
          {level === 'custom' && (
            <input className="input" inputMode="decimal" placeholder={t('send.custom_ph')} value={custom} onChange={e => setCustom(e.target.value.replace(/[^\d.]/g, ''))} />
          )}
          <span className="hint">{t('send.fee_hint', { rate: feeRate, fee: formatPrl(roughFee) })}</span>
        </div>
        {error && <Notice kind="danger">{error}</Notice>}
      </div>
      <div className="footer">
        <Btn className="primary" disabled={!canReview} loading={busy} onClick={review}>{t('send.review')}</Btn>
      </div>
    </div>
  );
}
