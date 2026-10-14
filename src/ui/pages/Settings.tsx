import { useEffect, useState, type ReactNode } from 'react';
import akoyaMark from '../assets/akoya-mark.svg';
import { APP_NAME, NETWORKS, type NetworkId } from '../../core/networks.ts';
import { passwordProblem } from '../../core/keystore.ts';
import { WalletError } from '../../core/errors.ts';
import * as W from '../../ext/wallet.ts';
import { APP_VERSION, REPO_URL } from '../../ext/app.ts';
import { openTab, requestOrigin } from '../../ext/platform.ts';
import type { IndexerStatus, Language, SessionInfo, Settings as S } from '../../ext/types.ts';
import { LANGUAGES, useI18n } from '../../i18n/index.tsx';
import { Btn, Kv, Notice, PasswordField, Topbar, useToast } from '../components/common.tsx';
import { IconChevron, IconExternal, IconEye, IconLock, IconPlus } from '../components/icons.tsx';

type Sub = null | 'reveal' | 'password' | 'indexers' | 'about' | 'delete' | 'rename';

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

export function Settings({ session, onBack, onLock, onDeleted, onRenamed }: {
  session: SessionInfo;
  onBack: () => void;
  onLock: () => void;
  onDeleted: () => void;
  onRenamed: (s: SessionInfo) => void;
}) {
  const { t, lang, setLang } = useI18n();
  const [sub, setSub] = useState<Sub>(null);
  const [settings, setSettings] = useState<S | null>(null);
  useEffect(() => void W.getSettings().then(setSettings), [sub]);

  const back = () => setSub(null);
  if (sub === 'reveal') return <Reveal onBack={back} onLocked={onLock} />;
  if (sub === 'password') return <ChangePassword onBack={back} />;
  if (sub === 'indexers' && settings) return <Indexers settings={settings} onBack={back} />;
  if (sub === 'about') return <About session={session} onBack={back} />;
  if (sub === 'delete') return <Delete session={session} onBack={back} onDeleted={onDeleted} />;
  if (sub === 'rename') return <Rename session={session} onBack={back} onDone={onRenamed} />;

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
          <Row label={t('settings.indexers')} value={settings ? new URL(settings.indexers[session.network][0]).host : ''} onClick={() => setSub('indexers')} />
        </div>

        <div className="section-title mt-lg">{t('settings.wallet')}</div>
        <div className="list">
          <Row label={t('settings.name')} value={session.name} onClick={() => setSub('rename')} />
          <Row label={t('settings.backup')} onClick={() => setSub('reveal')} />
          <Row label={t('settings.change_password')} onClick={() => setSub('password')} />
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

function Indexers({ settings, onBack }: { settings: S; onBack: () => void }) {
  const { t, te } = useI18n();
  const [s, setS] = useState(settings);
  const [net, setNet] = useState<NetworkId>('mainnet');
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<Record<string, IndexerStatus>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    for (const u of s.indexers[net]) void W.indexerStatus(net, u).then(r => setStatus(x => ({ ...x, [`${net}|${u}`]: r })));
  }, [s, net]);

  const add = async () => {
    setError(null);
    try {
      const u = W.normalizeIndexerUrl(url);
      if (s.indexers[net].includes(u)) return setError(t('idx.exists'));
      // runtime, per-origin permission instead of a broad host permission in the manifest
      if (!(await requestOrigin(u))) return setError(t('idx.denied'));
      const st = await W.indexerStatus(net, u);
      if (!st.ok) return setError(st.error ? te(st.error) : t('idx.unavailable'));
      setS(await W.setSettings({ indexers: { ...s.indexers, [net]: [...s.indexers[net], u] } }));
      setUrl('');
    } catch (e) {
      setError(te(e));
    }
  };
  const remove = async (u: string) => {
    try {
      setS(await W.setSettings({ indexers: { ...s.indexers, [net]: s.indexers[net].filter(x => x !== u) } }));
    } catch (e) {
      setError(te(e));
    }
  };
  const promote = async (u: string) => setS(await W.setSettings({ indexers: { ...s.indexers, [net]: [u, ...s.indexers[net].filter(x => x !== u)] } }));

  return (
    <div className="screen">
      <Topbar title={t('idx.title')} onBack={onBack} />
      <div className="scroll stack">
        <div className="seg">
          {(Object.keys(NETWORKS) as NetworkId[]).map(id => (
            <button key={id} className={net === id ? 'on' : ''} onClick={() => setNet(id)}>{NETWORKS[id].label}</button>
          ))}
        </div>
        <div className="list">
          {s.indexers[net].map((u, i) => {
            const st = status[`${net}|${u}`];
            return (
              <div className="item static" key={u}>
                <div className="grow">
                  <div className="title ellipsis">{new URL(u).host}{i === 0 && <span className="pill" style={{ marginLeft: 6 }}>{t('idx.primary')}</span>}</div>
                  <div className="meta">
                    {!st ? t('idx.checking') : st.ok ? <span className="green">{t('idx.height', { height: st.height?.toLocaleString() ?? '' })} {st.inSync ? '' : t('idx.syncing')}</span> : <span className="red">{te(st.error)}</span>}
                  </div>
                </div>
                {i > 0 && <button className="btn sm" onClick={() => promote(u)}>{t('idx.make_primary')}</button>}
                {s.indexers[net].length > 1 && <button className="btn sm danger" onClick={() => remove(u)}>{t('idx.remove')}</button>}
              </div>
            );
          })}
        </div>
        <div className="field">
          <label>{t('idx.add_label')}</label>
          <div className="row">
            <input className="input" value={url} placeholder="https://your-blockbook.example" onChange={e => setUrl(e.target.value)} />
            <Btn className="sm" style={{ height: 44 }} disabled={!url} onClick={add}><IconPlus /></Btn>
          </div>
        </div>
        {error && <Notice kind="danger">{error}</Notice>}
        <Notice kind="info">{t('idx.notice', { chain: NETWORKS[net].backendChain })}</Notice>
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
