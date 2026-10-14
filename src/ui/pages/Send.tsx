import { useEffect, useMemo, useState } from 'react';
import { NETWORKS } from '../../core/networks.ts';
import { decodeAddress } from '../../core/address.ts';
import { estimateVsize } from '../../core/tx.ts';
import * as W from '../../ext/wallet.ts';
import { openTab } from '../../ext/platform.ts';
import { formatPrl, parsePrl, shortTxid } from '../../ext/format.ts';
import type { FeeEstimates, Overview, SendPreview, SessionInfo } from '../../ext/types.ts';
import { Btn, FullAddress, Kv, Notice, PasswordField, Topbar, errMsg, useCopy } from '../components/common.tsx';
import { IconCheck, IconCopy, IconExternal } from '../components/icons.tsx';

type Level = 'fast' | 'normal' | 'slow' | 'custom';
const LEVELS: { k: Exclude<Level, 'custom'>; label: string }[] = [
  { k: 'fast', label: '快速' },
  { k: 'normal', label: '标准' },
  { k: 'slow', label: '经济' },
];

export function Send({ session, onBack, onLocked }: { session: SessionInfo; onBack: () => void; onLocked: () => void }) {
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
    W.fees().then(setFees, e => (e instanceof W.LockedError ? onLocked() : setError(errMsg(e))));
    W.overview().then(setOv, () => {});
  }, [onLocked]);

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
      addrErr = errMsg(e);
    }
  }
  const addrOk = toTrim ? !addrErr : null;
  let amountErr: string | null = null;
  let amountGrains = 0n;
  if (!max && amount) {
    try {
      amountGrains = parsePrl(amount);
    } catch (e) {
      amountErr = errMsg(e);
    }
  }
  const spendable = ov ? BigInt(ov.spendable) : null;
  const roughFee = BigInt(Math.ceil(estimateVsize(2, 2) * feeRate));
  if (!amountErr && spendable !== null && !max && amountGrains + roughFee > spendable) amountErr = '余额不足（含手续费）';
  const canReview = addrOk && (max || (amountGrains > 0n && !amountErr)) && feeRate >= 1;

  const review = async () => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await W.prepareSend({ to: toTrim, amount, feeRate, sendMax: max }));
    } catch (e) {
      if (e instanceof W.LockedError) return onLocked();
      setError(errMsg(e));
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
      setError(errMsg(e));
    } finally {
      setPw('');
      setBusy(false);
    }
  };

  // ---------------- result
  if (sent) {
    return (
      <div className="screen">
        <Topbar title="已发送" onClose={onBack} />
        <div className="scroll center stack" style={{ paddingTop: 40 }}>
          <div className="tx-ic in" style={{ width: 64, height: 64, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'rgba(79,209,161,.14)', color: 'var(--green)' }}>
            <IconCheck />
          </div>
          <h2 style={{ margin: '8px 0 0' }}>交易已广播</h2>
          <p className="muted small" style={{ margin: 0 }}>{formatPrl(preview!.amount)} PRL 正在发送，通常 1~10 个区块确认。</p>
          <div className="card" style={{ width: '100%' }}>
            <div className="label">交易 ID</div>
            <div className="mono mt">{sent}</div>
          </div>
          <div className="row">
            <Btn className="sm" onClick={() => copy(sent, '交易 ID 已复制')}><IconCopy />复制</Btn>
            <Btn className="sm ghost" onClick={async () => openTab(await W.explorerUrl(session.network, 'tx', sent))}><IconExternal />在浏览器查看</Btn>
          </div>
        </div>
        <div className="footer"><Btn className="primary" onClick={onBack}>完成</Btn></div>
      </div>
    );
  }

  // ---------------- review: render the full effective transaction before signing
  if (preview) {
    const expired = Date.now() > preview.expiresAt;
    return (
      <div className="screen">
        <Topbar title="确认交易" onBack={() => { W.discardDraft(preview.draftId); setPreview(null); setError(null); }} />
        <div className="scroll stack">
          <div className="balance" style={{ paddingTop: 4 }}>
            <span className="amount" style={{ fontSize: 30 }}>{formatPrl(preview.amount)}</span>
            <span className="unit">PRL</span>
          </div>
          <div className="card">
            <div className="label">收款地址 · {preview.addressType === 'taproot' ? 'Taproot' : 'P2MR（抗量子）'}</div>
            <div className="mt"><FullAddress address={preview.to} hrp={preview.hrp} /></div>
          </div>
          <div className="card tight">
            <Kv k="网络">{preview.networkLabel}（{preview.hrp}）</Kv>
            <Kv k="发送金额">{formatPrl(preview.amount)} PRL</Kv>
            <Kv k="手续费">{formatPrl(preview.fee)} PRL<div className="tiny faint">{preview.feeRate} grain/vB × {preview.vsize} vB</div></Kv>
            <Kv k="合计扣除"><b>{formatPrl(preview.total)} PRL</b></Kv>
            <Kv k="找零">{BigInt(preview.change) > 0n ? `${formatPrl(preview.change)} PRL` : '无'}</Kv>
          </div>
          {preview.changeAddress && (
            <div className="card">
              <div className="label">找零地址（本钱包 {preview.changePath}）</div>
              <div className="mt"><FullAddress address={preview.changeAddress} hrp={preview.hrp} /></div>
            </div>
          )}
          <details className="card">
            <summary className="small muted" style={{ cursor: 'pointer' }}>输入 {preview.inputs.length} 个 UTXO</summary>
            {preview.inputs.map(i => (
              <Kv key={`${i.txid}:${i.vout}`} k={<span className="mono">{shortTxid(i.txid)}:{i.vout}</span>}>
                {formatPrl(i.value)}
                <div className="tiny faint">{i.path}</div>
              </Kv>
            ))}
          </details>
          {BigInt(preview.fee) * 10n > BigInt(preview.amount) && (
            <Notice kind="warn">手续费超过发送金额的 10%，请确认。</Notice>
          )}
          <Notice kind="info">签名在本机完成，交易版本 1、无锁定时间、不可替换（与官方 oyster 一致）。广播后无法撤回。</Notice>
          <PasswordField label="输入密码以签名" value={pw} onChange={setPw} onEnter={() => pw && !expired && confirm()} />
          {expired && <Notice kind="warn">草稿已过期，请返回重新确认。</Notice>}
          {error && <Notice kind="danger">{error}</Notice>}
        </div>
        <div className="footer">
          <Btn onClick={() => { W.discardDraft(preview.draftId); setPreview(null); }}>取消</Btn>
          <Btn className="primary" loading={busy} disabled={!pw || expired} onClick={confirm}>签名并广播</Btn>
        </div>
      </div>
    );
  }

  // ---------------- form
  return (
    <div className="screen">
      <Topbar title="发送 PRL" onBack={onBack} />
      <div className="scroll stack">
        <div className="field">
          <label>收款地址</label>
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
          {addrOk && <span className="hint ok">✓ 地址校验通过</span>}
        </div>
        <div className="field">
          <div className="row between">
            <label className="label">金额</label>
            <span className="tiny muted">可用 {spendable !== null ? formatPrl(spendable) : '…'} PRL</span>
          </div>
          <div className="input-wrap">
            <input
              className={`input ${amountErr ? 'err' : ''}`}
              inputMode="decimal"
              value={max ? '全部余额（扣除手续费）' : amount}
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
          <label>手续费</label>
          <div className="seg">
            {LEVELS.map(l => (
              <button key={l.k} className={level === l.k ? 'on' : ''} onClick={() => setLevel(l.k)}>
                {l.label}
                <span className="v">{fees ? (fees[l.k] ?? 1) : '…'}</span>
              </button>
            ))}
            <button className={level === 'custom' ? 'on' : ''} onClick={() => setLevel('custom')}>
              自定义<span className="v">grain/vB</span>
            </button>
          </div>
          {level === 'custom' && (
            <input className="input" inputMode="decimal" placeholder="grain/vB，最低 1" value={custom} onChange={e => setCustom(e.target.value.replace(/[^\d.]/g, ''))} />
          )}
          <span className="hint">
            {feeRate} grain/vB · 预计约 {formatPrl(roughFee)} PRL（1 PRL = 10⁸ grain）。快速/标准/经济 分别对应 1/3/10 个区块目标。
          </span>
        </div>
        {error && <Notice kind="danger">{error}</Notice>}
      </div>
      <div className="footer">
        <Btn className="primary" disabled={!canReview} loading={busy} onClick={review}>检查交易</Btn>
      </div>
    </div>
  );
}
