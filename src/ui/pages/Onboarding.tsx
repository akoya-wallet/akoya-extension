import { useMemo, useState } from 'react';
import akoyaMark from '../assets/akoya-mark.svg';
import { APP_NAME, NETWORKS, type NetworkId } from '../../core/networks.ts';
import { passwordProblem } from '../../core/keystore.ts';
import { WalletError } from '../../core/errors.ts';
import * as W from '../../ext/wallet.ts';
import type { DerivationMode, ImportPreview, SessionInfo } from '../../ext/types.ts';
import { formatPrl } from '../../ext/format.ts';
import { useI18n } from '../../i18n/index.tsx';
import { Btn, FullAddress, LangSelect, Notice, PasswordField, Steps, Topbar } from '../components/common.tsx';
import { IconEye } from '../components/icons.tsx';

type Done = (s: SessionInfo) => void;

export function Welcome({ onCreate, onImport, onCancel }: { onCreate: () => void; onImport: () => void; onCancel?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="screen">
      {onCancel ? <Topbar onBack={onCancel} right={<LangSelect />} /> : <LangSelect className="lang-corner" />}
      <div className="scroll center hero">
        <img className="brand-mark" src={akoyaMark} alt="Akoya" />
        <h2>{APP_NAME}</h2>
        <p>{t('welcome.tagline')}</p>
        <p className="small faint mt">{t('welcome.note')}</p>
      </div>
      <div className="footer col">
        <Btn className="primary block" onClick={onCreate}>{t('welcome.create')}</Btn>
        <Btn className="block" onClick={onImport}>{t('welcome.import')}</Btn>
      </div>
    </div>
  );
}

function NetworkPicker({ value, onChange }: { value: NetworkId; onChange: (n: NetworkId) => void }) {
  const { t } = useI18n();
  return (
    <div className="field">
      <label>{t('onboard.network')}</label>
      <div className="seg">
        {(Object.keys(NETWORKS) as NetworkId[]).map(id => (
          <button key={id} className={value === id ? 'on' : ''} onClick={() => onChange(id)}>
            {NETWORKS[id].label}
            <span className="v">{NETWORKS[id].hrp}1p…</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PasswordStep({ title, onBack, onSubmit, busy, error, network, setNetwork, showNetwork }: {
  title: string;
  onBack: () => void;
  onSubmit: (name: string, pw: string) => void;
  busy: boolean;
  error: string | null;
  network: NetworkId;
  setNetwork: (n: NetworkId) => void;
  showNetwork: boolean;
}) {
  const { t, te } = useI18n();
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [agree, setAgree] = useState(false);
  const problem = pw ? passwordProblem(pw) : null;
  const mismatch = pw2 && pw !== pw2 ? t('pw.mismatch') : null;
  const ok = !problem && pw && pw === pw2 && agree;
  return (
    <div className="screen">
      <Topbar title={title} onBack={onBack} />
      <div className="scroll stack">
        <div className="field">
          <label>{t('pw.wallet_name')}</label>
          <input className="input" value={name} maxLength={32} placeholder={t('pw.wallet_name_ph')} onChange={e => setName(e.target.value)} />
        </div>
        {showNetwork && <NetworkPicker value={network} onChange={setNetwork} />}
        <PasswordField label={t('pw.set')} value={pw} onChange={setPw} placeholder={t('pw.set_ph')} error={problem ? te(new WalletError(problem)) : null} autoFocus />
        <PasswordField label={t('pw.confirm')} value={pw2} onChange={setPw2} placeholder={t('pw.confirm_ph')} error={mismatch} onEnter={() => ok && onSubmit(name, pw)} />
        <Notice kind="info">{t('pw.info')}</Notice>
        <label className="check">
          <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} />
          {t('pw.ack', { app: APP_NAME })}
        </label>
        {error && <Notice kind="danger">{error}</Notice>}
      </div>
      <div className="footer">
        <Btn className="primary" disabled={!ok} loading={busy} onClick={() => onSubmit(name, pw)}>{t('common.continue')}</Btn>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ create

export function CreateWallet({ onBack, onDone }: { onBack: () => void; onDone: Done }) {
  const { t, te } = useI18n();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [network, setNetwork] = useState<NetworkId>('mainnet');
  const [creds, setCreds] = useState<{ name: string; pw: string } | null>(null);
  // the phrase lives only in this component's state for the duration of the flow
  const [words, setWords] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const quiz = useMemo(() => {
    if (!words.length) return [];
    const picks = new Set<number>();
    const r = new Uint32Array(16);
    crypto.getRandomValues(r);
    for (const x of r) {
      picks.add(x % words.length);
      if (picks.size === 3) break;
    }
    return [...picks].sort((a, b) => a - b);
  }, [words]);
  const [answers, setAnswers] = useState<Record<number, string>>({});

  if (step === 1) {
    return (
      <PasswordStep
        title={t('create.title')}
        onBack={onBack}
        busy={false}
        error={null}
        network={network}
        setNetwork={setNetwork}
        showNetwork
        onSubmit={(name, pw) => {
          setCreds({ name, pw });
          setWords(W.generateMnemonic(12).split(' '));
          setStep(2);
        }}
      />
    );
  }

  if (step === 2) {
    return (
      <div className="screen">
        <Topbar title={t('create.backup_title')} onBack={() => { setWords([]); setRevealed(false); setStep(1); }} />
        <div className="scroll stack">
          <Steps n={2} of={3} />
          <Notice kind="warn">{t('create.backup_warn')}</Notice>
          <div className={`words ${revealed ? '' : 'blur'}`}>
            {words.map((w, i) => (
              <div className="word" key={i}>
                <span className="n">{i + 1}</span>
                <span>{w}</span>
              </div>
            ))}
            {!revealed && (
              <button className="reveal-cover" onClick={() => setRevealed(true)}>
                <span className="row"><IconEye />{t('create.reveal')}</span>
              </button>
            )}
          </div>
          <label className="check">
            <input type="checkbox" checked={saved} disabled={!revealed} onChange={e => setSaved(e.target.checked)} />
            {t('create.saved')}
          </label>
        </div>
        <div className="footer">
          <Btn className="primary" disabled={!saved} onClick={() => setStep(3)}>{t('create.next_verify')}</Btn>
        </div>
      </div>
    );
  }

  const quizOk = quiz.every(i => (answers[i] ?? '').trim().toLowerCase() === words[i]);
  const finish = async () => {
    if (!creds) return;
    setBusy(true);
    setError(null);
    try {
      const s = await W.createWallet({ secret: words.join(' '), passphrase: '', network, mode: 'oyster', name: creds.name, password: creds.pw });
      setWords([]);
      setCreds(null);
      onDone(s);
    } catch (e) {
      setError(te(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="screen">
      <Topbar title={t('create.verify_title')} onBack={() => { setAnswers({}); setStep(2); }} />
      <div className="scroll stack">
        <Steps n={3} of={3} />
        <p className="muted small" style={{ margin: 0 }}>{t('create.verify_hint')}</p>
        {quiz.map(i => (
          <div className="field" key={i}>
            <label>{t('create.word_n', { n: i + 1 })}</label>
            <input
              className="input"
              autoComplete="off"
              spellCheck={false}
              value={answers[i] ?? ''}
              onChange={e => setAnswers(a => ({ ...a, [i]: e.target.value }))}
            />
          </div>
        ))}
        {error && <Notice kind="danger">{error}</Notice>}
      </div>
      <div className="footer">
        <Btn className="primary" disabled={!quizOk} loading={busy} onClick={finish}>{t('create.finish')}</Btn>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ import

export function ImportWallet({ onBack, onDone }: { onBack: () => void; onDone: Done }) {
  const { t, te } = useI18n();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [text, setText] = useState('');
  const [network, setNetwork] = useState<NetworkId>('mainnet');
  const [advanced, setAdvanced] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [mode, setMode] = useState<DerivationMode>('oyster');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useMemo(() => (text.trim() ? W.checkSeed(text) : null), [text]);
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const args = () => ({ secret: text, passphrase, network, mode });

  if (step === 1) {
    const goPreview = async () => {
      setBusy(true);
      setError(null);
      try {
        setPreview(await W.previewImport(args()));
        setStep(2);
      } catch (e) {
        setError(te(e));
      } finally {
        setBusy(false);
      }
    };
    const hint = !check
      ? t('import.hint_hex')
      : check.ok
        ? check.kind === 'hex' ? t('import.ok_hex') : t('import.ok_words', { count: check.wordCount ?? 0 })
        : wordCount >= 12 && check.reason
          ? te(new WalletError(check.reason.code, check.reason.params))
          : t('import.typed', { count: wordCount });
    return (
      <div className="screen">
        <Topbar title={t('import.title')} onBack={() => { setText(''); onBack(); }} />
        <div className="scroll stack">
          <Steps n={1} of={3} />
          <div className="field">
            <label>{t('import.label')}</label>
            <textarea
              className={`textarea ${check && !check.ok && wordCount >= 12 ? 'err' : ''}`}
              value={text}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder={t('import.ph')}
              onChange={e => setText(e.target.value)}
            />
            <span className={`hint ${check?.ok ? 'ok' : check && wordCount >= 12 ? 'err' : ''}`}>{hint}</span>
          </div>
          <NetworkPicker value={network} onChange={setNetwork} />
          <button className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setAdvanced(a => !a)}>
            {advanced ? t('import.advanced_hide') : t('import.advanced_show')}
          </button>
          {advanced && (
            <div className="card stack">
              <div className="field">
                <label>{t('import.derivation')}</label>
                <div className="seg">
                  <button className={mode === 'oyster' ? 'on' : ''} onClick={() => setMode('oyster')}>
                    {t('import.mode_oyster')}<span className="v">{t('import.mode_oyster_sub')}</span>
                  </button>
                  <button className={mode === 'standard' ? 'on' : ''} onClick={() => setMode('standard')}>
                    {t('import.mode_std')}<span className="v">{t('import.mode_std_sub')}</span>
                  </button>
                </div>
                <span className="hint">{t('import.mode_hint')}</span>
              </div>
              <PasswordField label={t('import.passphrase')} value={passphrase} onChange={setPassphrase} placeholder={t('import.passphrase_ph')} />
            </div>
          )}
          {error && <Notice kind="danger">{error}</Notice>}
        </div>
        <div className="footer">
          <Btn className="primary" disabled={!check?.ok} loading={busy} onClick={goPreview}>{t('common.next')}</Btn>
        </div>
      </div>
    );
  }

  if (step === 2 && preview) {
    const net = NETWORKS[network];
    return (
      <div className="screen">
        <Topbar title={t('import.confirm_title')} onBack={() => setStep(1)} />
        <div className="scroll stack">
          <Steps n={2} of={3} />
          <div className="card">
            <div className="label">{t('import.first_address', { path: preview.accountPath })}</div>
            <div className="mt"><FullAddress address={preview.firstAddress} hrp={net.hrp} /></div>
          </div>
          {preview.activity ? (
            preview.activity.txs > 0 ? (
              <Notice kind="ok">
                {t('import.found', { txs: preview.activity.txs, used: preview.activity.usedAddresses, balance: formatPrl(preview.activity.balance) })}
              </Notice>
            ) : (
              <Notice kind="warn">{t('import.not_found', { network: net.label })}</Notice>
            )
          ) : (
            <Notice kind="warn">{t('import.lookup_failed', { detail: te(preview.activityError) })}</Notice>
          )}
          {preview.divergesFromBip32 && <Notice kind="info">{t('import.diverges')}</Notice>}
        </div>
        <div className="footer">
          <Btn onClick={() => setStep(1)}>{t('import.edit')}</Btn>
          <Btn className="primary" onClick={() => setStep(3)}>{t('import.mine')}</Btn>
        </div>
      </div>
    );
  }

  return (
    <PasswordStep
      title={t('import.set_password')}
      onBack={() => setStep(2)}
      busy={busy}
      error={error}
      network={network}
      setNetwork={setNetwork}
      showNetwork={false}
      onSubmit={async (name, pw) => {
        setBusy(true);
        setError(null);
        try {
          const s = await W.createWallet({ ...args(), name, password: pw });
          setText('');
          setPassphrase('');
          onDone(s);
        } catch (e) {
          setError(te(e));
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}
