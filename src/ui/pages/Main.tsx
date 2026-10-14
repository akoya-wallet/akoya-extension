import { useEffect, useState } from 'react';
import akoyaMark from '../assets/akoya-mark.svg';
import { APP_NAME, NETWORKS } from '../../core/networks.ts';
import * as W from '../../ext/wallet.ts';
import { openTab } from '../../ext/platform.ts';
import { formatPrl, shortAddr, shortTxid, timeAgo } from '../../ext/format.ts';
import type { Overview, SessionInfo, TxItem, WalletMeta } from '../../ext/types.ts';
import { Btn, FullAddress, Notice, PasswordField, QrCode, Sheet, Topbar, errMsg, useCopy } from '../components/common.tsx';
import { IconActivity, IconArrowDown, IconArrowUp, IconCheck, IconCopy, IconExternal, IconHome, IconLock, IconPick, IconPlus, IconRefresh, IconSettings } from '../components/icons.tsx';

const initials = (name: string) => (name.trim()[0] ?? 'N').toUpperCase();

// ------------------------------------------------------------------ unlock

export function Unlock({ wallets, initialId, onUnlocked, onAdd }: { wallets: WalletMeta[]; initialId?: string; onUnlocked: (s: SessionInfo) => void; onAdd: () => void }) {
  const [id, setId] = useState(initialId && wallets.some(w => w.id === initialId) ? initialId : wallets[0]?.id);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const w = wallets.find(x => x.id === id);
  const go = async () => {
    if (!id || !pw) return;
    setBusy(true);
    setError(null);
    try {
      onUnlocked(await W.unlock(id, pw));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
      setPw('');
    }
  };
  return (
    <div className="screen">
      <div className="scroll center hero" style={{ paddingTop: 54 }}>
        <img className="brand-mark" src={akoyaMark} alt="Akoya" />
        <h2>{APP_NAME}</h2>
        <button className="account-btn mt" style={{ margin: '12px auto 0' }} onClick={() => wallets.length > 1 && setPicking(true)}>
          <span className="avatar">{initials(w?.name ?? '')}</span>
          <span className="ellipsis">{w?.name}</span>
          <span className={`pill ${w?.network !== 'mainnet' ? 'test' : ''}`}>{w ? NETWORKS[w.network].label : ''}</span>
        </button>
        <div style={{ width: '100%', marginTop: 28, textAlign: 'left' }}>
          <PasswordField label="" value={pw} onChange={setPw} autoFocus onEnter={go} error={error} />
        </div>
      </div>
      <div className="footer col">
        <Btn className="primary block" loading={busy} disabled={!pw} onClick={go}>解锁</Btn>
        <button className="link-btn" style={{ alignSelf: 'center' }} onClick={onAdd}>忘记密码？用助记词重新导入</button>
      </div>
      {picking && (
        <Sheet onClose={() => setPicking(false)}>
          <WalletList wallets={wallets} current={id} onPick={x => { setId(x); setPicking(false); setError(null); }} onAdd={onAdd} />
        </Sheet>
      )}
    </div>
  );
}

function WalletList({ wallets, current, onPick, onAdd }: { wallets: WalletMeta[]; current?: string; onPick: (id: string) => void; onAdd: () => void }) {
  return (
    <div className="stack">
      <div className="section-title">我的钱包</div>
      <div className="list">
        {wallets.map(w => (
          <button key={w.id} className="item" onClick={() => onPick(w.id)}>
            <span className="avatar">{initials(w.name)}</span>
            <div className="grow">
              <div className="title ellipsis">{w.name}</div>
              <div className="meta">{NETWORKS[w.network].label} · {w.mode === 'oyster' ? '官方兼容' : '标准 BIP32'}</div>
            </div>
            {w.id === current && <span className="green"><IconCheck /></span>}
          </button>
        ))}
      </div>
      <Btn className="block" onClick={onAdd}><IconPlus />添加 / 导入钱包</Btn>
    </div>
  );
}

// ------------------------------------------------------------------ main shell

type Tab = 'home' | 'activity';

export function MainShell({
  session,
  wallets,
  onSend,
  onReceive,
  onSettings,
  onLock,
  onSwitch,
  onAdd,
}: {
  session: SessionInfo;
  wallets: WalletMeta[];
  onSend: () => void;
  onReceive: (o: Overview) => void;
  onSettings: () => void;
  onLock: () => void;
  onSwitch: (id: string) => void;
  onAdd: () => void;
}) {
  const [tab, setTab] = useState<Tab>('home');
  const [ov, setOv] = useState<Overview | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState(false);
  const copy = useCopy();

  const load = async (p = page) => {
    setLoading(true);
    try {
      setOv(await W.overview(p));
      setError(null);
    } catch (e) {
      if (e instanceof W.LockedError) return onLock();
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(page);
    const t = window.setInterval(() => void load(page), 30_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.walletId, page]);

  const net = NETWORKS[session.network];

  return (
    <div className="screen">
      <div className="topbar">
        <button className="account-btn" onClick={() => setPicking(true)}>
          <span className="avatar">{initials(session.name)}</span>
          <span className="ellipsis" style={{ fontWeight: 600 }}>{session.name}</span>
        </button>
        <span className={`pill ${session.network !== 'mainnet' ? 'test' : ''}`}>{session.networkLabel}</span>
        <span className="grow" />
        <button className="icon-btn" title="刷新" onClick={() => load()} aria-label="刷新">
          {loading ? <span className="spinner" /> : <IconRefresh />}
        </button>
        <button className="icon-btn" title="锁定" onClick={onLock} aria-label="锁定"><IconLock /></button>
      </div>

      <div className="scroll">
        {error && <div className="mt"><Notice kind="danger">{error}</Notice></div>}
        {ov && ov.rejected > 0 && (
          <div className="mt"><Notice kind="warn">索引节点返回了 {ov.rejected} 条与本地派生不符的数据，已忽略。如果持续出现，请在设置中更换节点。</Notice></div>
        )}

        {tab === 'home' ? (
          <>
            <div className="balance">
              {ov ? (
                <div>
                  <span className="amount">{formatPrl(ov.spendable)}</span>
                  <span className="unit">PRL</span>
                </div>
              ) : (
                <div className="skeleton" style={{ height: 40, width: 180, margin: '0 auto' }} />
              )}
              <div className="sub">
                {ov && BigInt(ov.unconfirmed) !== 0n && <span>其中 {formatPrl(ov.unconfirmed)} 待确认</span>}
                {ov && BigInt(ov.unconfirmed) !== 0n && BigInt(ov.immature) > 0n && ' · '}
                {ov && BigInt(ov.immature) > 0n && <span className="amber">{formatPrl(ov.immature)} 挖矿奖励未成熟</span>}
              </div>
            </div>
            <div className="actions">
              <button className="action" onClick={() => ov && onReceive(ov)} disabled={!ov}>
                <span className="ic"><IconArrowDown /></span>接收
              </button>
              <button className="action" onClick={onSend}>
                <span className="ic"><IconArrowUp /></span>发送
              </button>
              <button className="action" onClick={() => ov && copy(ov.receiveAddress, '收款地址已复制')} disabled={!ov}>
                <span className="ic"><IconCopy /></span>复制地址
              </button>
            </div>
            <div className="section-title">
              <span>最近活动</span>
              {ov && ov.txCount > 0 && <button className="link-btn" onClick={() => setTab('activity')}>全部 {ov.txCount}</button>}
            </div>
            <TxList items={ov?.history.slice(0, 5)} session={session} />
          </>
        ) : (
          <>
            <div className="section-title mt">
              <span>交易记录 {ov ? `· ${ov.txCount}` : ''}</span>
              {ov && ov.totalPages > 1 && (
                <span className="row">
                  <button className="btn sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
                  <span className="tiny">{page}/{ov.totalPages}</span>
                  <button className="btn sm" disabled={page >= ov.totalPages} onClick={() => setPage(p => p + 1)}>下一页</button>
                </span>
              )}
            </div>
            <TxList items={ov?.history} session={session} />
            {ov && (
              <p className="tiny faint mt center">
                高度 {ov.tip.toLocaleString()} · {new URL(ov.indexer).host} · {net.label}
              </p>
            )}
          </>
        )}
      </div>

      <div className="tabbar">
        <button className={tab === 'home' ? 'on' : ''} onClick={() => { setTab('home'); setPage(1); }}><IconHome />首页</button>
        <button className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}><IconActivity />活动</button>
        <button onClick={onSettings}><IconSettings />设置</button>
      </div>

      {picking && (
        <Sheet onClose={() => setPicking(false)}>
          <WalletList wallets={wallets} current={session.walletId} onPick={id => { setPicking(false); if (id !== session.walletId) onSwitch(id); }} onAdd={onAdd} />
        </Sheet>
      )}
    </div>
  );
}

function TxList({ items, session }: { items?: TxItem[]; session: SessionInfo }) {
  const net = NETWORKS[session.network];
  if (!items) {
    return (
      <div className="list">
        {[0, 1, 2].map(i => <div key={i} className="skeleton" style={{ height: 56 }} />)}
      </div>
    );
  }
  if (!items.length) return <div className="empty">还没有交易。点「接收」获取你的地址。</div>;
  const open = async (txid: string) => openTab(await W.explorerUrl(session.network, 'tx', txid));
  return (
    <div className="list">
      {items.map(t => {
        const n = BigInt(t.net);
        const label = t.coinbase ? '挖矿奖励' : t.direction === 'in' ? '收到' : t.direction === 'out' ? '发送' : '内部转账';
        return (
          <button key={t.txid} className="item" onClick={() => open(t.txid)} title={t.txid}>
            <span className={`tx-ic ${t.coinbase ? 'mine' : t.direction === 'in' ? 'in' : t.direction === 'out' ? 'out' : ''}`}>
              {t.coinbase ? <IconPick /> : t.direction === 'in' ? <IconArrowDown /> : <IconArrowUp />}
            </span>
            <div className="grow">
              <div className="title">{label}</div>
              <div className="meta ellipsis">
                {t.counterparty ? shortAddr(t.counterparty, net) : shortTxid(t.txid)}
              </div>
            </div>
            <div>
              <div className={`amt ${n > 0n ? 'green' : ''}`}>{formatPrl(n, { sign: true })} PRL</div>
              <div className="meta" style={{ textAlign: 'right' }}>
                {t.confirmations === 0 ? <span className="amber">待确认</span> : t.coinbase && t.confirmations < 100 ? <span className="amber">{t.confirmations}/100 确认</span> : timeAgo(t.time)}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ receive

export function Receive({ session, overview, onBack }: { session: SessionInfo; overview: Overview; onBack: () => void }) {
  const copy = useCopy();
  const net = NETWORKS[session.network];
  const open = async () => openTab(await W.explorerUrl(session.network, 'address', overview.receiveAddress));
  return (
    <div className="screen">
      <Topbar title="接收 PRL" onBack={onBack} />
      <div className="scroll stack">
        <QrCode text={overview.receiveAddress} />
        <div className="addr-box"><FullAddress address={overview.receiveAddress} hrp={net.hrp} /></div>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Btn className="sm" onClick={() => copy(overview.receiveAddress, '地址已复制')}><IconCopy />复制</Btn>
          <Btn className="sm ghost" onClick={open}><IconExternal />浏览器</Btn>
        </div>
        <Notice kind="info">
          仅接收 Pearl {net.label} 的 PRL（地址以 <b>{net.hrp}1p</b> 开头）。收到款项后会自动切换到新地址，旧地址仍然有效。
        </Notice>
        <p className="tiny faint center" style={{ margin: 0 }}>派生路径 {overview.receivePath}</p>
      </div>
    </div>
  );
}
