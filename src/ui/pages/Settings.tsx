import { useEffect, useState, type ReactNode } from 'react';
import akoyaMark from '../assets/akoya-mark.svg';
import { APP_NAME, NETWORKS, type NetworkId } from '../../core/networks.ts';
import { passwordProblem } from '../../core/keystore.ts';
import { WalletError } from '../../core/errors.ts';
import * as W from '../../ext/wallet.ts';
import { APP_VERSION, REPO_URL } from '../../ext/app.ts';
import { openTab, requestOrigin } from '../../ext/platform.ts';
import { FIATS, FIAT_LABEL, PRICE_SOURCE } from '../../ext/price.ts';
import type { Explorer, Fiat, IndexerStatus, Language, SessionInfo, Settings as S } from '../../ext/types.ts';
import { LANGUAGES, useI18n } from '../../i18n/index.tsx';
import { Btn, Kv, Notice, PasswordField, Topbar, useToast } from '../components/common.tsx';
import { PoolSettings } from './Mining.tsx';
import { poolById } from '../../ext/pool.ts';
import { IconChevron, IconExternal, IconEye, IconLock, IconPlus } from '../components/icons.tsx';

type Sub = null | 'reveal' | 'password' | 'indexers' | 'explorers' | 'about' | 'delete' | 'rename' | 'pool';

function Row({ label, value, onClick, danger }: { label: string; value?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button className="item" onClick={onClick}>
      <div className={`grow title ${danger ? 'red' : ''}`}>{label}</div>
      {value && <span className="meta ellipsis" style={{ maxWidth: 160 }}>{value}</span>}
      <span className="faint chev"><IconChevron /></span>
    </button>
  );
}

function SelectRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="item static">
      <div className="grow title">{label}</div>
      {children}
    </div>
  );
}

export function Settings({ session, initialSub, onBack, onLock, onDeleted, onRenamed }: {
  session: SessionInfo;
  initialSub?: 'pool';
  onBack: () => void;
  onLock: () => void;
  onDeleted: () => void;
  onRenamed: (s: SessionInfo) => void;
}) {
  const { t, lang, setLang } = useI18n();
  const [sub, setSub] = useState<Sub>(initialSub ?? null);
  const [poolName, setPoolName] = useState('');
  const [settings, setSettings] = useState<S | null>(null);
  const [explorerName, setExplorerName] = useState('');
  useEffect(() => void W.getSettings().then(setSettings), [sub]);
  useEffect(() => {
    void W.listExplorers(session.network).then(r => setExplorerName(r.explorers.find(e => e.id === r.selected)?.name ?? ''));
  }, [sub, session.network]);

  useEffect(() => {
    if (session.network === 'mainnet') void W.poolConfig().then(c => setPoolName(c.pool ? poolById(c.pool)?.name ?? '' : t('pool.off')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub, session.network]);

  const back = () => setSub(null);
  if (sub === 'reveal') return <Reveal onBack={back} onLocked={onLock} />;
  if (sub === 'password') return <ChangePassword onBack={back} />;
  if (sub === 'indexers' && settings) return <Indexers settings={settings} network={session.network} onBack={back} />;
  if (sub === 'explorers') return <Explorers network={session.network} onBack={back} />;
  if (sub === 'about') return <About session={session} onBack={back} />;
  if (sub === 'delete') return <Delete session={session} onBack={back} onDeleted={onDeleted} />;
  if (sub === 'rename') return <Rename session={session} onBack={back} onDone={onRenamed} />;
  if (sub === 'pool') return <PoolSettings session={session} onBack={back} />;

  return (
    <div className="screen">
      <Topbar title={t('settings.title')} onBack={onBack} />
      <div className="scroll">
        <div className="section-title">{t('settings.general')}</div>
        <div className="list">
          <SelectRow label={t('common.language')}>
            <select className="select compact" value={lang} onChange={e => setLang(e.target.value as Language)}>
              {LANGUAGES.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </SelectRow>
          <SelectRow label={t('settings.autolock')}>
            <select
              className="select compact"
              value={settings?.autoLockMinutes ?? 15}
              onChange={async e => setSettings(await W.setSettings({ autoLockMinutes: Number(e.target.value) }))}
            >
              {[5, 15, 30, 60, 240].map(m => <option key={m} value={m}>{t('settings.minutes', { n: m })}</option>)}
            </select>
          </SelectRow>
          <SelectRow label={t('settings.fiat')}>
            <select
              className="select compact"
              value={settings?.fiat ?? 'off'}
              onChange={async e => setSettings(await W.setSettings({ fiat: e.target.value as Fiat | 'off' }))}
            >
              <option value="off">{t('settings.fiat_off')}</option>
              {FIATS.map(f => <option key={f} value={f}>{FIAT_LABEL[f]}</option>)}
            </select>
          </SelectRow>
          <Row label={t('settings.indexers')} value={settings ? new URL(settings.indexers[session.network][0]).host : ''} onClick={() => setSub('indexers')} />
          <Row label={t('settings.explorer')} value={explorerName} onClick={() => setSub('explorers')} />
        </div>
        {settings && settings.fiat !== 'off' && <p className="tiny faint" style={{ margin: '8px 4px 0' }}>{t('settings.fiat_note', { source: PRICE_SOURCE })}</p>}

        <div className="section-title mt-lg">{t('settings.wallet')}</div>
        <div className="list">
          <Row label={t('settings.name')} value={session.name} onClick={() => setSub('rename')} />
          <Row label={t('settings.backup')} onClick={() => setSub('reveal')} />
          <Row label={t('settings.change_password')} onClick={() => setSub('password')} />
          {session.network === 'mainnet' && <Row label={t('settings.pool')} value={poolName} onClick={() => setSub('pool')} />}
          <Row label={t('settings.derivation')} value={session.mode === 'oyster' ? t('mode.oyster') : t('mode.standard')} onClick={() => setSub('about')} />
        </div>

        <div className="section-title mt-lg">{t('settings.danger')}</div>
        <div className="list">
          <Btn className="block" onClick={onLock}><IconLock />{t('settings.lock_now')}</Btn>
          <Row label={t('settings.delete')} danger onClick={() => setSub('delete')} />
        </div>

        <div className="app-footer">
          <img src={akoyaMark} alt="" />
          <div className="app-footer-name">{APP_NAME} <span className="faint">v{APP_VERSION}</span></div>
          <div className="tiny faint">{t('settings.footer')}</div>
          <button className="link-btn" onClick={() => openTab(REPO_URL)}><IconExternal />{t('settings.source')}</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ reveal mnemonic (explicit export flow)

function Reveal({ onBack, onLocked }: { onBack: () => void; onLocked: () => void }) {
  const { t, te } = useI18n();
  const [ack, setAck] = useState([false, false, false]);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // only held while this screen is mounted
  const [secret, setSecret] = useState<{ words: string[]; passphrase: boolean } | null>(null);
  const [shown, setShown] = useState(false);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await W.revealSecret(pw);
      setSecret({ words: s.secret.split(' '), passphrase: !!s.passphrase });
    } catch (e) {
      if (e instanceof W.LockedError) return onLocked();
      setError(te(e));
    } finally {
      setPw('');
      setBusy(false);
    }
  };
  const done = () => {
    setSecret(null);
    onBack();
  };

  if (secret) {
    const isHex = secret.words.length === 1;
    return (
      <div className="screen">
        <Topbar title={t('reveal.title')} onBack={done} />
        <div className="scroll stack">
          <Notice kind="danger">{t('reveal.danger')}</Notice>
          {isHex ? (
            <div className="card mono" style={{ filter: shown ? 'none' : 'blur(6px)' }}>{secret.words[0]}</div>
          ) : (
            <div className={`words ${shown ? '' : 'blur'}`}>
              {secret.words.map((w, i) => (
                <div className="word" key={i}><span className="n">{i + 1}</span><span>{w}</span></div>
              ))}
              {!shown && (
                <button className="reveal-cover" onClick={() => setShown(true)}>
                  <span className="row"><IconEye />{t('reveal.click')}</span>
                </button>
              )}
            </div>
          )}
          {isHex && !shown && <Btn onClick={() => setShown(true)}><IconEye />{t('reveal.show_hex')}</Btn>}
          {secret.passphrase && <Notice kind="warn">{t('reveal.passphrase_note')}</Notice>}
        </div>
        <div className="footer"><Btn className="primary" onClick={done}>{t('reveal.hide')}</Btn></div>
      </div>
    );
  }

  const items = [t('reveal.ack1'), t('reveal.ack2'), t('reveal.ack3')];
  return (
    <div className="screen">
      <Topbar title={t('settings.backup')} onBack={onBack} />
      <div className="scroll stack">
        <Notice kind="warn">{t('reveal.warn')}</Notice>
        {items.map((text, i) => (
          <label className="check" key={i}>
            <input type="checkbox" checked={ack[i]} onChange={e => setAck(a => a.map((v, j) => (j === i ? e.target.checked : v)))} />
            {text}
          </label>
        ))}
        <PasswordField value={pw} onChange={setPw} onEnter={() => ack.every(Boolean) && pw && go()} error={error} />
      </div>
      <div className="footer">
        <Btn className="primary" disabled={!ack.every(Boolean) || !pw} loading={busy} onClick={go}>{t('reveal.show')}</Btn>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ password

function ChangePassword({ onBack }: { onBack: () => void }) {
  const { t, te } = useI18n();
  const [old, setOld] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const problem = pw ? passwordProblem(pw) : null;
  const ok = old && pw && !problem && pw === pw2;
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await W.changePassword(old, pw);
      toast(t('cpw.done'));
      onBack();
    } catch (e) {
      setError(te(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="screen">
      <Topbar title={t('settings.change_password')} onBack={onBack} />
      <div className="scroll stack">
        <PasswordField label={t('cpw.current')} value={old} onChange={setOld} autoFocus />
        <PasswordField label={t('cpw.new')} value={pw} onChange={setPw} placeholder={t('pw.set_ph')} error={problem ? te(new WalletError(problem)) : null} />
        <PasswordField label={t('cpw.confirm')} value={pw2} onChange={setPw2} error={pw2 && pw !== pw2 ? t('pw.mismatch') : null} onEnter={() => ok && go()} />
        {error && <Notice kind="danger">{error}</Notice>}
      </div>
      <div className="footer"><Btn className="primary" disabled={!ok} loading={busy} onClick={go}>{t('common.save')}</Btn></div>
    </div>
  );
}

// ------------------------------------------------------------------ indexers

function NetworkTabs({ value, onChange }: { value: NetworkId; onChange: (n: NetworkId) => void }) {
  return (
    <div className="seg">
      {(Object.keys(NETWORKS) as NetworkId[]).map(id => (
        <button key={id} className={value === id ? 'on' : ''} onClick={() => onChange(id)}>{NETWORKS[id].label}</button>
      ))}
    </div>
  );
}

function Indexers({ settings, network, onBack }: { settings: S; network: NetworkId; onBack: () => void }) {
  const { t, te } = useI18n();
  const [s, setS] = useState(settings);
  const [net, setNet] = useState<NetworkId>(network);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Record<string, IndexerStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const official = new Set(NETWORKS[net].blockbook);

  useEffect(() => {
    for (const u of s.indexers[net]) void W.indexerStatus(net, u).then(r => setStatus(x => ({ ...x, [`${net}|${u}`]: r })));
  }, [s, net]);

  const save = async (list: string[]) => {
    try {
      setS(await W.setSettings({ indexers: { ...s.indexers, [net]: list } }));
    } catch (e) {
      setError(te(e));
    }
  };
  const add = async () => {
    setError(null);
    setBusy(true);
    try {
      const u = W.normalizeIndexerUrl(url);
      if (s.indexers[net].includes(u)) return setError(t('idx.exists'));
      // runtime, per-origin permission instead of a broad host permission in the manifest
      if (!(await requestOrigin(u))) return setError(t('idx.denied'));
      const st = await W.indexerStatus(net, u);
      if (!st.ok) return setError(st.error ? te(st.error) : t('idx.unavailable'));
      await save([...s.indexers[net], u]);
      setUrl('');
    } catch (e) {
      setError(te(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <Topbar title={t('idx.title')} onBack={onBack} />
      <div className="scroll stack">
        <NetworkTabs value={net} onChange={n => { setNet(n); setError(null); }} />
        <div className="list">
          {s.indexers[net].map((u, i) => {
            const st = status[`${net}|${u}`];
            const active = i === 0;
            return (
              <div className={`item choice ${active ? 'on' : ''}`} key={u} role="radio" aria-checked={active} tabIndex={0}
                onClick={() => !active && save([u, ...s.indexers[net].filter(x => x !== u)])}>
                <span className="radio" />
                <div className="grow">
                  <div className="title title-row">
                    <span className="ellipsis">{new URL(u).host}</span>
                    {official.has(u) && <span className="pill">{t('idx.official')}</span>}
                  </div>
                  <div className="meta">
                    {!st ? t('idx.checking')
                      : st.ok ? <span className="green">{t('idx.height', { height: st.height?.toLocaleString() ?? '' })} · {t('idx.latency', { ms: st.latencyMs ?? 0 })} {st.inSync ? '' : t('idx.syncing')}</span>
                      : <span className="red">{te(st.error)}</span>}
                  </div>
                </div>
                {active && <span className="tiny accent-text">{t('idx.active')}</span>}
                {!official.has(u) && s.indexers[net].length > 1 && (
                  <button className="btn sm danger" onClick={e => { e.stopPropagation(); void save(s.indexers[net].filter(x => x !== u)); }}>{t('idx.remove')}</button>
                )}
              </div>
            );
          })}
        </div>
        <p className="tiny faint" style={{ margin: 0 }}>{t('idx.tap_hint')}</p>
        <div className="field">
          <label>{t('idx.add_label')}</label>
          <div className="row">
            <input className="input" value={url} placeholder="https://your-blockbook.example" onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && url && add()} />
            <Btn className="sm" style={{ height: 44 }} disabled={!url} loading={busy} onClick={add}><IconPlus />{t('idx.add')}</Btn>
          </div>
        </div>
        {error && <Notice kind="danger">{error}</Notice>}
        <Notice kind="info">{t('idx.notice', { chain: NETWORKS[net].backendChain })}</Notice>
      </div>
    </div>
  );
}

function Explorers({ network, onBack }: { network: NetworkId; onBack: () => void }) {
  const { t, te } = useI18n();
  const [net, setNet] = useState<NetworkId>(network);
  const [data, setData] = useState<{ explorers: Explorer[]; selected: string } | null>(null);
  const [form, setForm] = useState({ name: '', tx: '', address: '' });
  const [error, setError] = useState<string | null>(null);

  const reload = () => void W.listExplorers(net).then(setData);
  useEffect(reload, [net]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setError(te(e));
    }
  };

  return (
    <div className="screen">
      <Topbar title={t('exp.title')} onBack={onBack} />
      <div className="scroll stack">
        <NetworkTabs value={net} onChange={n => { setNet(n); setError(null); }} />
        <div className="list">
          {data?.explorers.map(ex => {
            const active = ex.id === data.selected;
            return (
              <div className={`item choice ${active ? 'on' : ''}`} key={ex.id} role="radio" aria-checked={active} tabIndex={0}
                onClick={() => !active && act(() => W.selectExplorer(net, ex.id))}>
                <span className="radio" />
                <div className="grow">
                  <div className="title title-row">
                    <span className="ellipsis">{ex.name}</span>
                    {ex.builtin && <span className="pill">{t('idx.official')}</span>}
                  </div>
                  <div className="meta ellipsis">{new URL(ex.tx.replace('{txid}', 'x')).host}</div>
                </div>
                {active && <span className="tiny accent-text">{t('idx.active')}</span>}
                {!ex.builtin && (
                  <button className="btn sm danger" onClick={e => { e.stopPropagation(); void act(() => W.removeExplorer(net, ex.id)); }}>{t('idx.remove')}</button>
                )}
              </div>
            );
          })}
        </div>
        <p className="tiny faint" style={{ margin: 0 }}>{t('exp.hint')}</p>

        <div className="card stack">
          <div className="label">{t('exp.add_title')}</div>
          <input className="input" value={form.name} maxLength={32} placeholder={t('exp.name_ph')} aria-label={t('exp.name')} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <input className="input mono-input" value={form.tx} placeholder="https://…/tx/{txid}" aria-label={t('exp.tx')} onChange={e => setForm(f => ({ ...f, tx: e.target.value }))} />
          <input className="input mono-input" value={form.address} placeholder="https://…/address/{address}" aria-label={t('exp.address')} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
          <span className="hint">{t('exp.placeholders')}</span>
          <Btn className="sm" disabled={!form.name || !form.tx || !form.address}
            onClick={() => act(async () => { await W.addExplorer(net, form); setForm({ name: '', tx: '', address: '' }); })}>
            <IconPlus />{t('exp.add')}
          </Btn>
        </div>
        {error && <Notice kind="danger">{error}</Notice>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ about / rename / delete

function About({ session, onBack }: { session: SessionInfo; onBack: () => void }) {
  const { t } = useI18n();
  const net = NETWORKS[session.network];
  return (
    <div className="screen">
      <Topbar title={t('about.title')} onBack={onBack} />
      <div className="scroll stack">
        <div className="card tight">
          <Kv k={t('about.network')}>Pearl {net.label}</Kv>
          <Kv k={t('about.address_type')}>Taproot (BIP86, bech32m)</Kv>
          <Kv k={t('about.prefix')}>{net.hrp}1p…</Kv>
          <Kv k={t('about.account')}>{session.accountPath}</Kv>
          <Kv k={t('about.branches')}>…/0/i · …/1/i</Kv>
          <Kv k={t('about.mode')}>{session.mode === 'oyster' ? t('about.mode_oyster') : t('mode.standard')}</Kv>
          <Kv k={t('about.phrase')}>{t('about.phrase_v')}</Kv>
        </div>
        <Notice kind="info">{t('about.notice')}</Notice>
      </div>
    </div>
  );
}

function Rename({ session, onBack, onDone }: { session: SessionInfo; onBack: () => void; onDone: (s: SessionInfo) => void }) {
  const { t, te } = useI18n();
  const [name, setName] = useState(session.name);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="screen">
      <Topbar title={t('settings.name')} onBack={onBack} />
      <div className="scroll stack">
        <input className="input" value={name} maxLength={32} autoFocus onChange={e => setName(e.target.value)} />
        {error && <Notice kind="danger">{error}</Notice>}
      </div>
      <div className="footer">
        <Btn
          className="primary"
          disabled={!name.trim()}
          onClick={async () => {
            try {
              await W.renameWallet(name);
              const s = await W.session();
              if (s) onDone(s);
              onBack();
            } catch (e) {
              setError(te(e));
            }
          }}
        >
          {t('common.save')}
        </Btn>
      </div>
    </div>
  );
}

function Delete({ session, onBack, onDeleted }: { session: SessionInfo; onBack: () => void; onDeleted: () => void }) {
  const { t, te } = useI18n();
  const [typed, setTyped] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = typed.trim() === session.name && pw;
  return (
    <div className="screen">
      <Topbar title={t('settings.delete')} onBack={onBack} />
      <div className="scroll stack">
        <Notice kind="danger">{t('del.warn')}</Notice>
        <div className="field">
          <label>{t('del.type', { name: session.name })}</label>
          <input className="input" value={typed} onChange={e => setTyped(e.target.value)} />
        </div>
        <PasswordField value={pw} onChange={setPw} error={error} />
      </div>
      <div className="footer">
        <Btn
          className="danger"
          disabled={!ok}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await W.deleteWallet(session.walletId, pw);
              onDeleted();
            } catch (e) {
              setError(te(e));
            } finally {
              setBusy(false);
              setPw('');
            }
          }}
        >
          {t('del.button')}
        </Btn>
      </div>
    </div>
  );
}
