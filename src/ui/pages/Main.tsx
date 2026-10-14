import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import akoyaMark from '../assets/akoya-mark.svg';
import { APP_NAME, NETWORKS } from '../../core/networks.ts';
import * as W from '../../ext/wallet.ts';
import { openTab } from '../../ext/platform.ts';
import { clockTime, dayKey, formatDay, formatPrl, shortAddr, shortTxid } from '../../ext/format.ts';
import type { Overview, SessionInfo, TxItem, WalletMeta } from '../../ext/types.ts';
import { useI18n } from '../../i18n/index.tsx';
import { Btn, FullAddress, LangSelect, Notice, PasswordField, QrCode, Sheet, Topbar, useCopy } from '../components/common.tsx';
import { IconActivity, IconArrowDown, IconArrowUp, IconCheck, IconCopy, IconExternal, IconHome, IconLock, IconPick, IconPlus, IconRefresh, IconSettings } from '../components/icons.tsx';

const initials = (name: string) => (name.trim()[0] ?? 'A').toUpperCase();

// ------------------------------------------------------------------ unlock

export function Unlock({ wallets, initialId, onUnlocked, onAdd }: { wallets: WalletMeta[]; initialId?: string; onUnlocked: (s: SessionInfo) => void; onAdd: () => void }) {
  const { t, te } = useI18n();
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
      setError(te(e));
    } finally {
      setBusy(false);
      setPw('');
    }
  };
  return (
    <div className="screen">
      <LangSelect className="lang-corner" />
      <div className="scroll center hero" style={{ paddingTop: 54 }}>
        <img className="brand-mark" src={akoyaMark} alt="Akoya" />
        <h2>{APP_NAME}</h2>
        <button className="account-btn mt" style={{ margin: '12px auto 0' }} onClick={() => wallets.length > 1 && setPicking(true)}>
          <span className="avatar">{initials(w?.name ?? '')}</span>
          <span className="ellipsis">{w?.name}</span>
          {w && <span className={`net-pill ${w.network !== 'mainnet' ? 'test' : ''}`}><i />{NETWORKS[w.network].label}</span>}
        </button>
        <div style={{ width: '100%', marginTop: 28, textAlign: 'left' }}>
          <PasswordField label="" value={pw} onChange={setPw} autoFocus onEnter={go} error={error} />
        </div>
      </div>
      <div className="footer col">
        <Btn className="primary block" loading={busy} disabled={!pw} onClick={go}>{t('unlock.button')}</Btn>
        <button className="link-btn" style={{ alignSelf: 'center' }} onClick={onAdd}>{t('unlock.forgot')}</button>
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
  const { t } = useI18n();
  return (
    <div className="stack">
      <div className="section-title">{t('wallets.title')}</div>
      <div className="list">
        {wallets.map(w => (
          <button key={w.id} className="item" onClick={() => onPick(w.id)}>
            <span className="avatar">{initials(w.name)}</span>
            <div className="grow">
              <div className="title ellipsis">{w.name}</div>
              <div className="meta">{NETWORKS[w.network].label} · {w.mode === 'oyster' ? t('mode.oyster') : t('mode.standard')}</div>
            </div>
            {w.id === current && <span className="green"><IconCheck /></span>}
          </button>
        ))}
      </div>
      <Btn className="block" onClick={onAdd}><IconPlus />{t('wallets.add')}</Btn>
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
  const { t, te } = useI18n();
  const [tab, setTab] = useState<Tab>('home');
  const [ov, setOv] = useState<Overview | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<unknown>(null);
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
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(page);
    const timer = window.setInterval(() => void load(page), 30_000);
    return () => window.clearInterval(timer);
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
        <span className={`net-pill ${session.network !== 'mainnet' ? 'test' : ''}`}><i />{session.networkLabel}</span>
        <span className="grow" />
        <button className="icon-btn" title={t('common.refresh')} onClick={() => load()} aria-label={t('common.refresh')}>
          {loading ? <span className="spinner" /> : <IconRefresh />}
        </button>
        <button className="icon-btn" title={t('common.lock')} onClick={onLock} aria-label={t('common.lock')}><IconLock /></button>
      </div>

      <div className="scroll">
        {error !== null && <div className="mt"><Notice kind="danger">{te(error)}</Notice></div>}
        {ov && ov.rejected > 0 && (
          <div className="mt"><Notice kind="warn">{t('home.rejected', { count: ov.rejected })}</Notice></div>
        )}

        {tab === 'home' ? (
          <>
            <BalanceHero ov={ov} />
            <div className="actions">
              <button className="action" onClick={() => ov && onReceive(ov)} disabled={!ov}>
                <span className="ic"><IconArrowDown /></span>{t('home.receive')}
              </button>
              <button className="action" onClick={onSend}>
                <span className="ic"><IconArrowUp /></span>{t('home.send')}
              </button>
              <button className="action" onClick={() => ov && copy(ov.receiveAddress, t('home.address_copied'))} disabled={!ov}>
                <span className="ic"><IconCopy /></span>{t('home.copy_address')}
              </button>
            </div>
            <div className="section-title">
              <span>{t('home.recent')}</span>
              {ov && ov.txCount > 0 && <button className="link-btn" onClick={() => setTab('activity')}>{t('home.see_all', { count: ov.txCount })}</button>}
            </div>
            <TxList items={ov?.history.slice(0, 6)} session={session} />
          </>
        ) : (
          <>
            <div className="section-title mt">
              <span>{t('activity.title')} {ov ? `· ${ov.txCount}` : ''}</span>
              {ov && ov.totalPages > 1 && (
                <span className="row">
                  <button className="btn sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t('activity.prev')}</button>
                  <span className="tiny">{page}/{ov.totalPages}</span>
                  <button className="btn sm" disabled={page >= ov.totalPages} onClick={() => setPage(p => p + 1)}>{t('activity.next')}</button>
                </span>
              )}
            </div>
            <TxList items={ov?.history} session={session} />
            {ov && (
              <p className="tiny faint mt center">
                {t('activity.footer', { height: ov.tip.toLocaleString(), host: new URL(ov.indexer).host, network: net.label })}
              </p>
            )}
          </>
        )}
      </div>

      <div className="tabbar">
        <button className={tab === 'home' ? 'on' : ''} onClick={() => { setTab('home'); setPage(1); }}><IconHome />{t('tab.home')}</button>
        <button className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}><IconActivity />{t('tab.activity')}</button>
        <button onClick={onSettings}><IconSettings />{t('tab.settings')}</button>
      </div>

      {picking && (
        <Sheet onClose={() => setPicking(false)}>
          <WalletList wallets={wallets} current={session.walletId} onPick={id => { setPicking(false); if (id !== session.walletId) onSwitch(id); }} onAdd={onAdd} />
        </Sheet>
      )}
    </div>
  );
}

/** Big balance: integer part prominent, decimals and unit de-emphasised, auto-shrinks to never overflow. */
function BalanceHero({ ov }: { ov: Overview | null }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const full = ov ? formatPrl(ov.spendable) : '';
  const [int, frac] = full.split('.');
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let size = 44;
    el.style.fontSize = `${size}px`;
    while (el.scrollWidth > el.clientWidth && size > 20) {
      size -= 2;
      el.style.fontSize = `${size}px`;
    }
  }, [full]);
  const unconfirmed = ov ? BigInt(ov.unconfirmed) : 0n;
  const immature = ov ? BigInt(ov.immature) : 0n;
  const minedToday = ov ? BigInt(ov.minedToday) : 0n;
  return (
    <div className="balance-hero">
      {ov ? (
        <div className="hero-amount" ref={ref} title={`${full} PRL`}>
          {int}
          {frac && <span className="frac">.{frac}</span>}
          <span className="unit">PRL</span>
        </div>
      ) : (
        <div className="skeleton" style={{ height: 48, width: 220, margin: '0 auto' }} />
      )}
      {(unconfirmed !== 0n || immature > 0n || minedToday > 0n) && (
        <div className="hero-chips">
          {minedToday > 0n && <span className="chip mined">{t('home.mined_today', { amount: formatPrl(minedToday, { sign: true, maxDecimals: 4 }) })}</span>}
          {unconfirmed !== 0n && <span className="chip accent">{t('home.pending_chip', { amount: formatPrl(unconfirmed, { sign: true, maxDecimals: 4 }) })}</span>}
          {immature > 0n && <span className="chip amber">{t('home.immature_chip', { amount: formatPrl(immature, { maxDecimals: 4 }) })}</span>}
        </div>
      )}
    </div>
  );
}

function TxList({ items, session }: { items?: TxItem[]; session: SessionInfo }) {
  const { t, locale } = useI18n();
  const net = NETWORKS[session.network];
  if (!items) {
    return (
      <div className="list tight">
        {[0, 1, 2].map(i => <div key={i} className="skeleton" style={{ height: 58 }} />)}
      </div>
    );
  }
  if (!items.length) return <div className="empty">{t('activity.empty')}</div>;
  const open = async (txid: string) => openTab(await W.explorerUrl(session.network, 'tx', txid));

  const groups: { label: string; items: TxItem[] }[] = [];
  for (const tx of items) {
    let label: string;
    if (tx.confirmations === 0) label = t('common.pending');
    else {
      const k = dayKey(tx.time);
      label = k === 'today' ? t('common.today') : k === 'yesterday' ? t('common.yesterday') : formatDay(k, locale);
    }
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(tx);
    else groups.push({ label, items: [tx] });
  }

  return (
    <div>
      {groups.map(g => (
        <div key={g.label}>
          <div className="day">{g.label}</div>
          <div className="list tight">
            {g.items.map(tx => {
              const n = BigInt(tx.net);
              const mined = tx.coinbase || tx.poolPayout;
              const kind = mined ? 'mine' : tx.direction === 'in' ? 'in' : tx.direction === 'out' ? 'out' : '';
              const label = tx.coinbase ? t('tx.mined') : tx.poolPayout ? t('tx.pool_payout') : tx.direction === 'in' ? t('tx.received') : tx.direction === 'out' ? t('tx.sent') : t('tx.self');
              const sub = tx.counterparty ? shortAddr(tx.counterparty, net) : shortTxid(tx.txid);
              const status =
                tx.confirmations === 0 ? <span className="amber">{t('common.pending')}</span>
                : tx.coinbase && tx.confirmations < 100 ? <span className="amber">{t('tx.confirmations', { n: tx.confirmations })}</span>
                : clockTime(tx.time);
              return (
                <button key={tx.txid} className="item" onClick={() => open(tx.txid)} title={`${formatPrl(n, { sign: true })} PRL · ${tx.txid}`}>
                  <span className={`tx-ic ${kind}`}>
                    {mined ? <IconPick /> : tx.direction === 'in' ? <IconArrowDown /> : <IconArrowUp />}
                  </span>
                  <div className="grow">
                    <div className="title">{label}</div>
                    <div className="meta ellipsis">{tx.poolPayout && tx.counterparty ? t('tx.via_pool', { addr: sub }) : sub}</div>
                  </div>
                  <div className="right">
                    <div className={`amt ${n > 0n ? 'green' : ''}`}>
                      {formatPrl(n, { sign: true, maxDecimals: 4 })}
                      <span className="u">PRL</span>
                    </div>
                    <div className="meta">{status}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ receive

export function Receive({ session, overview, onBack }: { session: SessionInfo; overview: Overview; onBack: () => void }) {
  const { t } = useI18n();
  const copy = useCopy();
  const net = NETWORKS[session.network];
  const open = async () => openTab(await W.explorerUrl(session.network, 'address', overview.receiveAddress));
  return (
    <div className="screen">
      <Topbar title={t('receive.title')} onBack={onBack} />
      <div className="scroll stack">
        <QrCode text={overview.receiveAddress} />
        <div className="addr-box"><FullAddress address={overview.receiveAddress} hrp={net.hrp} /></div>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Btn className="sm" onClick={() => copy(overview.receiveAddress, t('receive.copied'))}><IconCopy />{t('common.copy')}</Btn>
          <Btn className="sm ghost" onClick={open}><IconExternal />{t('common.explorer')}</Btn>
        </div>
        <Notice kind="info">{t('receive.notice', { network: net.label, prefix: `${net.hrp}1p` })}</Notice>
        <p className="tiny faint center" style={{ margin: 0 }}>{t('receive.path', { path: overview.receivePath })}</p>
      </div>
    </div>
  );
}
