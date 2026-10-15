import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import akoyaMark from '../assets/akoya-mark.svg';
import { APP_NAME, NETWORKS } from '../../core/networks.ts';
import * as W from '../../ext/wallet.ts';
import { openTab } from '../../ext/platform.ts';
import { FIAT_LABEL, PRICE_SOURCE } from '../../ext/price.ts';
import { clockTime, dayKey, formatDay, formatFiat, formatPct, formatPrl, shortAddr, shortTxid } from '../../ext/format.ts';
import type { Overview, PnlDay, PnlView, SessionInfo, TxItem, WalletMeta } from '../../ext/types.ts';
import { useI18n } from '../../i18n/index.tsx';
import { Btn, FullAddress, Kv, LangSelect, Notice, PasswordField, QrCode, Sheet, Topbar, useCopy } from '../components/common.tsx';
import { IconActivity, IconArrowDown, IconArrowUp, IconCheck, IconChevron, IconCopy, IconExternal, IconHome, IconLock, IconPick, IconPlus, IconRefresh, IconSettings } from '../components/icons.tsx';

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
type PnlState = { kind: 'loading' | 'off' | 'unsupported' } | { kind: 'ok'; view: PnlView } | { kind: 'error'; error: unknown };

/** green / red / neutral for a fiat amount (anything that rounds to 0.00 is neutral) */
const tone = (v: number) => (Math.abs(v) < 0.005 ? '' : v > 0 ? 'green' : 'red');

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
  const { t, te, lang } = useI18n();
  const [tab, setTab] = useState<Tab>('home');
  const [ov, setOv] = useState<Overview | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pnl, setPnl] = useState<PnlState>({ kind: 'loading' });
  const [pnlOpen, setPnlOpen] = useState(false);
  const copy = useCopy();

  const loadPnl = async (o: Overview) => {
    try {
      const r = await W.pnlToday(o);
      setPnl(typeof r === 'string' ? { kind: r } : { kind: 'ok', view: r });
    } catch (e) {
      if (e instanceof W.LockedError) return;
      // keep showing the last good figures through a failed refresh
      setPnl(prev => (prev.kind === 'ok' ? prev : { kind: 'error', error: e }));
    }
  };
  const enablePnl = async () => {
    await W.setSettings({ fiat: lang === 'zh-CN' ? 'cny' : 'usd' });
    setPnl({ kind: 'loading' });
    if (ov) await loadPnl(ov);
  };

  const load = async (p = page) => {
    setLoading(true);
    try {
      const o = await W.overview(p);
      setOv(o);
      setError(null);
      if (o.page === 1) void loadPnl(o);
    } catch (e) {
      if (e instanceof W.LockedError) return onLock();
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // know up front whether a price line is coming, so the hero doesn't jump when it arrives
    setPnl({ kind: 'loading' });
    void W.getSettings().then(st => {
      const kind = session.network !== 'mainnet' ? 'unsupported' : st.fiat === 'off' ? 'off' : null;
      if (kind) setPnl(prev => (prev.kind === 'loading' ? { kind } : prev));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.walletId]);

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
            <BalanceHero ov={ov} pnl={pnl} onEnablePnl={enablePnl} onOpenPnl={() => setPnlOpen(true)} />
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
      {pnlOpen && pnl.kind === 'ok' && <PnlSheet view={pnl.view} onClose={() => setPnlOpen(false)} />}
    </div>
  );
}

/**
 * Big balance: integer part prominent, decimals and unit de-emphasised, auto-shrinks to never overflow.
 * Below it (when the user turned prices on): fiat value of the holdings and today's P&L.
 */
function BalanceHero({ ov, pnl, onEnablePnl, onOpenPnl }: { ov: Overview | null; pnl: PnlState; onEnablePnl: () => void; onOpenPnl: () => void }) {
  const { t, te, locale } = useI18n();
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
      {ov && pnl.kind === 'ok' && (
        <>
          <div className="hero-fiat" title={t('home.value_title', { amount: formatPrl(pnl.view.holdings, { maxDecimals: 4 }) })}>
            ≈ {formatFiat(pnl.view.valueNow, pnl.view.fiat, locale)}
          </div>
          <button className={`hero-pnl ${tone(pnl.view.pnl)}`} onClick={onOpenPnl}>
            {t('home.pnl_today', {
              pnl: formatFiat(pnl.view.pnl, pnl.view.fiat, locale, { sign: true }) + (pnl.view.pnlPct !== null ? ` (${formatPct(pnl.view.pnlPct, locale)})` : ''),
            })}
            {pnl.view.partial && ' ~'}
            <IconChevron />
          </button>
        </>
      )}
      {ov && pnl.kind === 'loading' && (
        <>
          <div className="skeleton" style={{ height: 18, width: 110, margin: '8px auto 0' }} />
          <div className="skeleton" style={{ height: 16, width: 150, margin: '6px auto 0' }} />
        </>
      )}
      {ov && pnl.kind === 'error' && <div className="hero-fiat tiny faint">{te(pnl.error)}</div>}
      {ov && pnl.kind === 'off' && (
        <button className="link-btn hero-enable" title={t('home.show_value_hint', { source: PRICE_SOURCE })} onClick={onEnablePnl}>
          {t('home.show_value')}
        </button>
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

function PnlSheet({ view, onClose }: { view: PnlView; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [days, setDays] = useState<PnlDay[] | null>(null);
  useEffect(() => void W.pnlHistory().then(setDays, () => setDays([])), []);
  const f = (v: number, sign = false) => formatFiat(v, view.fiat, locale, { sign });
  const price = (v: number) => formatFiat(v, view.fiat, locale, { price: true });
  const dayLabel = (day: string) => {
    const [y, m, d] = day.split('-').map(Number);
    const k = dayKey(new Date(y, m - 1, d).getTime() / 1000);
    return k === 'today' ? t('common.today') : k === 'yesterday' ? t('common.yesterday') : formatDay(k, locale);
  };
  return (
    <Sheet onClose={onClose}>
      <div className="stack">
        <div className="pnl-head">
          <div className="muted">{t('pnl.title')}</div>
          <div className={`pnl-big ${tone(view.pnl)}`}>{f(view.pnl, true)}</div>
          <div className="tiny faint">
            {view.pnlPct !== null && <span className={tone(view.pnl)}>{formatPct(view.pnlPct, locale)} · </span>}
            {t('pnl.since_midnight')}
          </div>
        </div>
        {view.partial && <Notice kind="warn">{t('pnl.partial')}</Notice>}
        <div className="card tight">
          <Kv k={<>{t('pnl.price')}<div className="tiny faint">{t('pnl.price_hint')}</div></>}>
            <span className={`nowrap ${tone(view.pnlPrice)}`}>{f(view.pnlPrice, true)}</span>
          </Kv>
          <Kv k={<>{t('pnl.mined')}<div className="tiny faint">{t('pnl.mined_hint', { amount: formatPrl(view.minedToday, { maxDecimals: 4 }) })}</div></>}>
            <span className={`nowrap ${tone(view.pnlMined)}`}>{f(view.pnlMined, true)}</span>
          </Kv>
        </div>
        <div className="card tight">
          <Kv k={t('pnl.value_now')}><span className="nowrap">{f(view.valueNow)}</span></Kv>
          <Kv k={t('pnl.price_now')}>
            <span className="nowrap">{price(view.price)}</span>
            {view.change24h !== null && <div className={`tiny ${tone(view.change24h)}`}>24h {formatPct(view.change24h, locale)}</div>}
          </Kv>
          <Kv k={t('pnl.price_open')}><span className="nowrap">{price(view.priceOpen)}</span></Kv>
          {view.fiat === 'sats' && view.flip !== null && (
            <Kv k={<>{t('pnl.flip')}<div className="tiny faint">{t('pnl.flip_hint')}</div></>}>
              {new Intl.NumberFormat(locale, { style: 'percent', maximumSignificantDigits: 3 }).format(view.flip)}
              <div className="flip-bar"><i style={{ width: `${Math.min(Math.max(view.flip * 100, 1.5), 100)}%` }} /></div>
            </Kv>
          )}
          <Kv k={t('pnl.hold_open')}>{formatPrl(view.balanceOpen, { maxDecimals: 4 })} PRL</Kv>
          <Kv k={t('pnl.hold_now')}>{formatPrl(view.holdings, { maxDecimals: 4 })} PRL</Kv>
        </div>
        <p className="tiny faint" style={{ margin: 0 }}>{t('pnl.transfers_note')}</p>

        <div className="section-title" style={{ margin: '6px 2px 0' }}>{t('pnl.history')}</div>
        {days === null ? (
          <div className="skeleton" style={{ height: 52 }} />
        ) : days.length === 0 ? (
          <div className="empty">{t('pnl.history_empty')}</div>
        ) : (
          <div className="list tight">
            {days.slice(0, 30).map(d => (
              <div key={d.day} className="item static">
                <div className="grow">
                  <div className="title">{dayLabel(d.day)}</div>
                  <div className="meta">≈ {f(d.value)} · {formatPrl(d.bal, { maxDecimals: 2 })} PRL</div>
                </div>
                <div className="right">
                  <div className={`amt ${tone(d.pnl)}`}>{f(d.pnl, true)}</div>
                  <div className="meta">
                    {d.pnlPct !== null ? formatPct(d.pnlPct, locale) : ''}
                    {BigInt(d.mined) > 0n && <span className="green"> · {formatPrl(d.mined, { sign: true, maxDecimals: 2 })} PRL</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="tiny faint center" style={{ margin: 0 }}>
          {t('pnl.history_note')}
          <br />
          {t('pnl.source', { source: PRICE_SOURCE, fiat: FIAT_LABEL[view.fiat] })}
        </p>
        <Btn className="block" onClick={onClose}>{t('pnl.close')}</Btn>
      </div>
    </Sheet>
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
