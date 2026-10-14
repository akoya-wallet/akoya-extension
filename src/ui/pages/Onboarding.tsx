import { useMemo, useState } from 'react';
import akoyaMark from '../assets/akoya-mark.svg';
import { APP_NAME, NETWORKS, type NetworkId } from '../../core/networks.ts';
import { passwordProblem } from '../../core/keystore.ts';
import * as W from '../../ext/wallet.ts';
import type { DerivationMode, ImportPreview, SessionInfo } from '../../ext/types.ts';
import { formatPrl } from '../../ext/format.ts';
import { Btn, FullAddress, Notice, PasswordField, Steps, Topbar, errMsg } from '../components/common.tsx';
import { IconEye } from '../components/icons.tsx';

type Done = (s: SessionInfo) => void;

export function Welcome({ onCreate, onImport, onCancel }: { onCreate: () => void; onImport: () => void; onCancel?: () => void }) {
  return (
    <div className="screen">
      {onCancel && <Topbar onBack={onCancel} />}
      <div className="scroll center hero">
        <img className="brand-mark" src={akoyaMark} alt="Akoya" />
        <h2>{APP_NAME}</h2>
        <p>Pearl (PRL) 自托管钱包</p>
        <p className="small faint mt">私钥只在本机加密保存 · by PRLFlipBTC，非 Pearl 官方</p>
      </div>
      <div className="footer col">
        <Btn className="primary block" onClick={onCreate}>创建新钱包</Btn>
        <Btn className="block" onClick={onImport}>导入助记词</Btn>
      </div>
    </div>
  );
}

function NetworkPicker({ value, onChange }: { value: NetworkId; onChange: (n: NetworkId) => void }) {
  return (
    <div className="field">
      <label>网络</label>
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
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [agree, setAgree] = useState(false);
  const problem = pw ? passwordProblem(pw) : null;
  const mismatch = pw2 && pw !== pw2 ? '两次输入不一致' : null;
  const ok = !problem && pw && pw === pw2 && agree;
  return (
    <div className="screen">
      <Topbar title={title} onBack={onBack} />
      <div className="scroll stack">
        <div className="field">
          <label>钱包名称</label>
          <input className="input" value={name} maxLength={32} placeholder="例如：挖矿收益" onChange={e => setName(e.target.value)} />
        </div>
        {showNetwork && <NetworkPicker value={network} onChange={setNetwork} />}
        <PasswordField label="设置密码" value={pw} onChange={setPw} placeholder="至少 8 位" error={problem} autoFocus />
        <PasswordField label="确认密码" value={pw2} onChange={setPw2} placeholder="再次输入" error={mismatch} onEnter={() => ok && onSubmit(name, pw)} />
        <Notice kind="info">密码用于在本机加密助记词（Argon2id + AES-256-GCM），解锁和每次转账都需要输入。它不能代替助记词恢复钱包。</Notice>
        <label className="check">
          <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} />
          我明白：忘记密码只能通过助记词重新导入，{APP_NAME} 无法找回。
        </label>
        {error && <Notice kind="danger">{error}</Notice>}
      </div>
      <div className="footer">
        <Btn className="primary" disabled={!ok} loading={busy} onClick={() => onSubmit(name, pw)}>继续</Btn>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ create

export function CreateWallet({ onBack, onDone }: { onBack: () => void; onDone: Done }) {
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
        title="创建钱包"
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
        <Topbar title="备份助记词" onBack={() => { setWords([]); setRevealed(false); setStep(1); }} />
        <div className="scroll stack">
          <Steps n={2} of={3} />
          <Notice kind="warn">这 12 个单词是恢复钱包的唯一方式。请手写在纸上，离线保存；不要截图、拍照、复制或发给任何人。</Notice>
          <div className={`words ${revealed ? '' : 'blur'}`}>
            {words.map((w, i) => (
              <div className="word" key={i}>
                <span className="n">{i + 1}</span>
                <span>{w}</span>
              </div>
            ))}
            {!revealed && (
              <button className="reveal-cover" onClick={() => setRevealed(true)}>
                <span className="row"><IconEye />确认周围无人后，点击显示</span>
              </button>
            )}
          </div>
          <label className="check">
            <input type="checkbox" checked={saved} disabled={!revealed} onChange={e => setSaved(e.target.checked)} />
            我已按顺序抄写好助记词
          </label>
        </div>
        <div className="footer">
          <Btn className="primary" disabled={!saved} onClick={() => setStep(3)}>下一步：验证</Btn>
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
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="screen">
      <Topbar title="验证助记词" onBack={() => { setAnswers({}); setStep(2); }} />
      <div className="scroll stack">
        <Steps n={3} of={3} />
        <p className="muted small" style={{ margin: 0 }}>请输入以下位置的单词，确认你已正确抄写。</p>
        {quiz.map(i => (
          <div className="field" key={i}>
            <label>第 {i + 1} 个单词</label>
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
        <Btn className="primary" disabled={!quizOk} loading={busy} onClick={finish}>完成创建</Btn>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ import

export function ImportWallet({ onBack, onDone }: { onBack: () => void; onDone: Done }) {
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
        setError(errMsg(e));
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className="screen">
        <Topbar title="导入助记词" onBack={() => { setText(''); onBack(); }} />
        <div className="scroll stack">
          <Steps n={1} of={3} />
          <div className="field">
            <label>助记词（12/15/18/21/24 个英文单词，空格分隔）</label>
            <textarea
              className={`textarea ${check && !check.ok && wordCount >= 12 ? 'err' : ''}`}
              value={text}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="word1 word2 word3 …"
              onChange={e => setText(e.target.value)}
            />
            <span className={`hint ${check?.ok ? 'ok' : check && wordCount >= 12 ? 'err' : ''}`}>
              {!check ? '也支持官方 oyster 导出的 hex 种子' : check.ok ? (check.kind === 'hex' ? '✓ hex 种子' : `✓ ${check.wordCount} 个单词，校验通过`) : wordCount >= 12 ? check.reason : `已输入 ${wordCount} 个单词`}
            </span>
          </div>
          <NetworkPicker value={network} onChange={setNetwork} />
          <button className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setAdvanced(a => !a)}>
            {advanced ? '收起高级选项' : '高级选项'}
          </button>
          {advanced && (
            <div className="card stack">
              <div className="field">
                <label>派生方式</label>
                <div className="seg">
                  <button className={mode === 'oyster' ? 'on' : ''} onClick={() => setMode('oyster')}>
                    官方钱包兼容<span className="v">Oyster / Pearl Wallet</span>
                  </button>
                  <button className={mode === 'standard' ? 'on' : ''} onClick={() => setMode('standard')}>
                    标准 BIP32<span className="v">其他 BIP86 钱包</span>
                  </button>
                </div>
                <span className="hint">两者只在约 1% 的助记词上产生不同地址。来自官方 Pearl Wallet / oyster 的助记词请保持默认。</span>
              </div>
              <PasswordField label="BIP39 密语（可选）" value={passphrase} onChange={setPassphrase} placeholder="官方钱包不使用密语，留空" />
            </div>
          )}
          {error && <Notice kind="danger">{error}</Notice>}
        </div>
        <div className="footer">
          <Btn className="primary" disabled={!check?.ok} loading={busy} onClick={goPreview}>下一步</Btn>
        </div>
      </div>
    );
  }

  if (step === 2 && preview) {
    const net = NETWORKS[network];
    return (
      <div className="screen">
        <Topbar title="确认钱包" onBack={() => setStep(1)} />
        <div className="scroll stack">
          <Steps n={2} of={3} />
          <div className="card">
            <div className="label">第一个收款地址（{preview.accountPath}/0/0）</div>
            <div className="mt"><FullAddress address={preview.firstAddress} hrp={net.hrp} /></div>
          </div>
          {preview.activity ? (
            preview.activity.txs > 0 ? (
              <Notice kind="ok">
                找到链上记录：{preview.activity.txs} 笔交易，{preview.activity.usedAddresses} 个已用地址，余额 {formatPrl(preview.activity.balance)} PRL。
              </Notice>
            ) : (
              <Notice kind="warn">该助记词在 {net.label} 上没有交易记录。如果你在官方钱包里有余额，请核对上面的地址是否与官方钱包「收款」中的地址一致，或检查网络/高级选项。</Notice>
            )
          ) : (
            <Notice kind="warn">暂时无法查询链上记录：{preview.activityError}</Notice>
          )}
          {preview.divergesFromBip32 && (
            <Notice kind="info">这个助记词触发了 oyster 的非标准派生，官方兼容模式与标准 BIP32 地址不同。当前使用官方兼容模式。</Notice>
          )}
        </div>
        <div className="footer">
          <Btn onClick={() => setStep(1)}>返回修改</Btn>
          <Btn className="primary" onClick={() => setStep(3)}>是我的钱包</Btn>
        </div>
      </div>
    );
  }

  return (
    <PasswordStep
      title="设置密码"
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
          setError(errMsg(e));
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}
