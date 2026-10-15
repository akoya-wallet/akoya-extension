// Mining-pool views: the rigs card on the home screen, the details sheet, and the pool settings page.
// Everything shown here comes from the pool's API and is rendered as plain text only.
import { useEffect, useState } from 'react';
import { NETWORKS } from '../../core/networks.ts';
import * as W from '../../ext/wallet.ts';
import { openTab, requestOrigin } from '../../ext/platform.ts';
import { POOLS, formatHashrate, poolById, poolOrigin, type PoolStats, type PoolWorker } from '../../ext/pool.ts';
import { clockTime, dayKey, formatDay, formatFiat, formatPrl, shortAddr } from '../../ext/format.ts';
import type { PnlView, PoolConfig, SessionInfo } from '../../ext/types.ts';
import { useI18n } from '../../i18n/index.tsx';
import { Btn, Notice, Sheet, Topbar, useToast } from '../components/common.tsx';
import { IconChevron, IconExternal, IconPick } from '../components/icons.tsx';

/** pool amounts are floats in PRL: round to the grain (7.7 is 769999999.99… grains), then format as usual */
const prlText = (v: number, sign = false) => formatPrl(BigInt(Math.round(v * 1e8)), { sign, maxDecimals: 4 });

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
/** typical hashrate per GPU model across all your rigs, to spot throttling or failing cards */
export function typicalByModel(workers: PoolWorker[]): Map<string, number> {
  const by = new Map<string, number[]>();
  for (const w of workers) for (const g of w.gpus) by.set(g.name, [...(by.get(g.name) ?? []), g.hashrate]);
  return new Map([...by].map(([k, v]) => [k, median(v)]));
}
/** more than 15 % below the typical card of the same model */
const isSlow = (g: { name: string; hashrate: number }, typical: Map<string, number>) => {
  const m = typical.get(g.name) ?? 0;
  return m > 0 && g.hashrate < m * 0.85;
};

export type PoolState = { cfg: PoolConfig | null; stats?: PoolStats; error?: unknown };

export function MiningCard({ session, state, payoutAddresses, onOpen, onChanged }: {
  session: SessionInfo;
  state: PoolState;
  payoutAddresses: string[];
  onOpen: () => void;
  onChanged: () => void;
}) {
  const { t, te } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { cfg, stats } = state;
  if (session.network !== 'mainnet' || !cfg) return null;

  if (!cfg.pool) {
    // only suggest on wallets that actually receive mining income
    if (cfg.dismissed || !payoutAddresses.length) return null;
    const pool = POOLS[0];
    const connect = async () => {
      setBusy(true);
      setError(null);
      try {
        // permission prompt first, while we're still inside the click
        if (!(await requestOrigin(pool.api))) return setError(t('pool.denied', { pool: pool.name }));
        await W.setPool({ pool: pool.id, address: payoutAddresses[0] });
        onChanged();
      } catch (e) {
        setError(te(e));
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className="card mining-suggest">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <span className="tx-ic mine"><IconPick /></span>
          <div className="grow">
            <div className="title">{t('mining.suggest_title')}</div>
            <div className="tiny muted">{t('mining.suggest_body')}</div>
          </div>
        </div>
        {error && <div className="hint err mt">{error}</div>}
        <div className="row mt" style={{ justifyContent: 'flex-end' }}>
          <Btn className="sm ghost" onClick={async () => { await W.dismissPoolSuggestion(); onChanged(); }}>{t('mining.not_now')}</Btn>
          <Btn className="sm primary" loading={busy} onClick={connect}>{t('mining.connect')}</Btn>
        </div>
      </div>
    );
  }

  const pool = poolById(cfg.pool)!;
  const online = stats?.workers.length ?? 0;
  return (
    <button className="item mining-card" onClick={onOpen} disabled={!stats}>
      <span className="tx-ic mine"><IconPick /></span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="title">{pool.name}</div>
        <div className="meta ellipsis">
          {stats ? t('mining.summary', { hashrate: formatHashrate(stats.hashrate), gpus: stats.gpus }) : state.error ? <span className="red">{te(state.error)}</span> : '…'}
        </div>
      </div>
      {stats && (
        <div className="right">
          <div className={`tiny ${online ? 'green' : 'amber'}`}>{online ? <><span className="dot" />{t('mining.online', { n: online })}</> : t('mining.no_rigs')}</div>
          <div className="meta">{t('mining.pending', { amount: prlText(stats.pending) })}</div>
        </div>
      )}
      <span className="faint chev"><IconChevron /></span>
    </button>
  );
}

export function MiningSheet({ stats, price, onClose, onSettings }: { stats: PoolStats; price: PnlView | null; onClose: () => void; onSettings: () => void }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  const pool = poolById(stats.pool)!;
  const net = NETWORKS.mainnet;
  const hm = (ms: number) => new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  const day = (ms: number) => {
    const k = dayKey(ms / 1000);
    return k === 'today' ? t('common.today') : k === 'yesterday' ? t('common.yesterday') : formatDay(k, locale);
  };
  const range = (a: number | null, b: number | null, label: string) => (a === null || b === null ? label : `${dayKey(a / 1000) === 'today' ? '' : `${day(a)} `}${hm(a)}–${hm(b)}`);
  const typical = median(stats.workers.map(w => w.hashrate));
  const gpuTypical = typicalByModel(stats.workers);
  const maturing = stats.epochs.reduce((a, e) => a + e.immatureTx, 0);

  return (
    <Sheet onClose={onClose}>
      <div className="stack">
        <div className="row">
          <div className="grow">
            <div className="title">{pool.name}</div>
            <div className="tiny faint mono">{shortAddr(stats.address, net)}</div>
          </div>
          <Btn className="sm ghost" onClick={() => openTab(pool.web.replace('{address}', encodeURIComponent(stats.address)))}><IconExternal />{t('mining.open_pool', { pool: pool.name })}</Btn>
        </div>

        <div className="stat-grid">
          <div className="stat"><div className="v">{stats.workers.length}</div><div className="k">{t('mining.rigs_stat')}</div></div>
          <div className="stat"><div className="v">{stats.gpus}</div><div className="k">{t('mining.gpus_stat')}</div></div>
          <div className="stat"><div className="v">{formatHashrate(stats.hashrate)}</div><div className="k">{t('mining.hashrate_stat')}</div></div>
        </div>

        <div className="card tight">
          <div className="row">
            <div className="grow">
              <div>{t('mining.pending_title')}</div>
              <div className="tiny faint">{t('mining.pending_hint')}</div>
            </div>
            <div className="right" style={{ textAlign: 'right' }}>
              <div className="nowrap" style={{ fontWeight: 600 }}>{prlText(stats.pending)} PRL</div>
              {price && <div className="tiny faint nowrap">≈ {formatFiat(stats.pending * price.price, price.fiat, locale)}</div>}
              {maturing > 0 && <div className="tiny amber nowrap">{t('mining.maturing', { n: maturing })}</div>}
            </div>
          </div>
          {stats.epochs.length > 0 && (
            <div className="epochs">
              {stats.epochs.slice(-6).reverse().map((e, i) => (
                <div className="kv" key={i}>
                  <span className="k">{range(e.start, e.end, e.label)}</span>
                  <span className="v">+{prlText(e.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="section-title" style={{ margin: '6px 2px 0' }}>{t('mining.rigs')}</div>
        {stats.workers.length === 0 ? (
          <div className="empty">{t('mining.no_rigs')}</div>
        ) : (
          <div className="list tight">
            {[...stats.workers].sort((a, b) => a.name.localeCompare(b.name)).map(w => {
              const slow = w.gpus.filter(g => isSlow(g, gpuTypical)).length;
              const low = typical > 0 && w.hashrate < typical * 0.9;
              const models = [...new Set(w.gpus.map(g => g.name.replace(/^NVIDIA GeForce /, '')))].join(', ');
              return (
                <div key={w.id}>
                  <button className="item" onClick={() => setOpen(open === w.id ? null : w.id)} aria-expanded={open === w.id}>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="title ellipsis">{w.name || t('mining.unnamed')}</div>
                      <div className="meta ellipsis">{w.gpus.length} × {models || 'GPU'}{w.version ? ` · ${w.version}` : ''}</div>
                    </div>
                    <div className="right">
                      <div className={`amt ${low ? 'amber' : ''}`}>{formatHashrate(w.hashrate)}</div>
                      {slow > 0 && <div className="meta amber">{t('mining.slow', { n: slow })}</div>}
                    </div>
                  </button>
                  {open === w.id && (
                    <div className="gpu-list">
                      {w.gpus.map((g, i) => {
                        const slowGpu = isSlow(g, gpuTypical);
                        return (
                          <div className="kv" key={i} title={slowGpu ? t('mining.gpu_slow_hint') : undefined}>
                            <span className="k">#{i} {g.name.replace(/^NVIDIA GeForce /, '')}</span>
                            <span className={`v ${slowGpu ? 'amber' : ''}`}>{formatHashrate(g.hashrate)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {stats.activity.length > 0 && (
          <>
            <div className="section-title" style={{ margin: '6px 2px 0' }}>{t('mining.activity')}</div>
            <div className="card tight">
              {stats.activity.slice(0, 12).map((a, i) => (
                <div className="kv" key={i}>
                  <span className="k">
                    {a.kind === 'credit' ? t('mining.credit', { range: range(a.start, a.end, '') }) : a.kind === 'payout' ? t('mining.payout') : a.label}
                    <div className="tiny faint">{day(a.at)} {clockTime(a.at / 1000)}</div>
                  </span>
                  <span className={`v nowrap ${a.amount > 0 ? 'green' : ''}`}>{prlText(a.amount, true)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="tiny faint center" style={{ margin: 0 }}>{t('mining.footer', { pool: pool.name, addr: shortAddr(stats.address, net) })}</p>
        <div className="row">
          <Btn className="block" onClick={onSettings}>{t('mining.change')}</Btn>
          <Btn className="block" onClick={onClose}>{t('pnl.close')}</Btn>
        </div>
      </div>
    </Sheet>
  );
}

export function PoolSettings({ session, onBack }: { session: SessionInfo; onBack: () => void }) {
  const { t, te } = useI18n();
  const toast = useToast();
  const [cfg, setCfg] = useState<PoolConfig | null>(null);
  const [pool, setPool] = useState<string>('off');
  const [addr, setAddr] = useState<string>('');
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const net = NETWORKS[session.network];

  useEffect(() => {
    void W.poolConfig().then(c => {
      setCfg(c);
      setPool(c.pool ?? 'off');
      if (c.address && !c.candidates.includes(c.address)) {
        setAddr('other');
        setOther(c.address);
      } else setAddr(c.address ?? c.candidates[0] ?? 'other');
    });
  }, []);

  if (session.network !== 'mainnet') {
    return (
      <div className="screen">
        <Topbar title={t('pool.title')} onBack={onBack} />
        <div className="scroll"><Notice kind="info">{t('pool.mainnet_only')}</Notice></div>
      </div>
    );
  }

  const chosen = POOLS.find(p => p.id === pool);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (chosen) {
        if (!(await requestOrigin(chosen.api))) return setError(t('pool.denied', { pool: chosen.name }));
        await W.setPool({ pool: chosen.id, address: addr === 'other' ? other : addr });
      } else await W.setPool(null);
      toast(t('pool.saved'));
      onBack();
    } catch (e) {
      setError(te(e));
    } finally {
      setBusy(false);
    }
  };
  const choice = (on: boolean, onPick: () => void, title: string, meta?: string) => (
    <div className={`item choice ${on ? 'on' : ''}`} role="radio" aria-checked={on} tabIndex={0} onClick={onPick} key={title + (meta ?? '')}>
      <span className="radio" />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="title ellipsis">{title}</div>
        {meta && <div className="meta ellipsis">{meta}</div>}
      </div>
    </div>
  );

  return (
    <div className="screen">
      <Topbar title={t('pool.title')} onBack={onBack} />
      <div className="scroll">
        {!cfg ? (
          <div className="skeleton" style={{ height: 120 }} />
        ) : (
          <div className="stack">
            <div className="list">
              {choice(pool === 'off', () => setPool('off'), t('pool.off'))}
              {POOLS.map(p => choice(pool === p.id, () => setPool(p.id), p.name, new URL(p.api).host))}
            </div>
            {chosen && (
              <>
                <div className="section-title" style={{ margin: '6px 2px 0' }}>
                  <span>{t('pool.address')}</span>
                  <span className="tiny faint">{t('pool.address_hint')}</span>
                </div>
                <div className="list">
                  {cfg.candidates.map(a => choice(addr === a, () => setAddr(a), shortAddr(a, net), cfg.detected.includes(a) ? t('pool.detected') : t('pool.first')))}
                  {choice(addr === 'other', () => setAddr('other'), t('pool.other'))}
                </div>
                {addr === 'other' && (
                  <input className="input mono" value={other} placeholder={t('pool.other_placeholder')} spellCheck={false} autoComplete="off" onChange={e => setOther(e.target.value)} />
                )}
                <p className="tiny faint" style={{ margin: 0 }}>{t('pool.privacy', { pool: chosen.name, host: new URL(poolOrigin(chosen)).host })}</p>
              </>
            )}
            {error && <div className="hint err">{error}</div>}
          </div>
        )}
      </div>
      <div className="footer">
        <Btn className="primary block" loading={busy} disabled={!cfg || (!!chosen && addr === 'other' && !other.trim())} onClick={save}>{t('common.save')}</Btn>
      </div>
    </div>
  );
}
