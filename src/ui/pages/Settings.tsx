import { useEffect, useState } from 'react';
import { APP_NAME, NETWORKS, type NetworkId } from '../../core/networks.ts';
import { passwordProblem } from '../../core/keystore.ts';
import * as W from '../../ext/wallet.ts';
import { requestOrigin } from '../../ext/platform.ts';
import type { IndexerStatus, SessionInfo, Settings as S } from '../../ext/types.ts';
import { Btn, Kv, Notice, PasswordField, Topbar, errMsg, useToast } from '../components/common.tsx';
import { IconChevron, IconEye, IconLock, IconPlus } from '../components/icons.tsx';

type Sub = null | 'reveal' | 'password' | 'indexers' | 'about' | 'delete' | 'rename';

export function Settings({ session, onBack, onLock, onDeleted, onRenamed }: {
  session: SessionInfo;
  onBack: () => void;
  onLock: () => void;
  onDeleted: () => void;
  onRenamed: (s: SessionInfo) => void;
}) {
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

  const Row = ({ label, value, onClick, danger }: { label: string; value?: string; onClick: () => void; danger?: boolean }) => (
    <button className="item" onClick={onClick}>
      <div className={`grow title ${danger ? 'red' : ''}`}>{label}</div>
      {value && <span className="meta">{value}</span>}
      <span className="faint" style={{ width: 16 }}><IconChevron /></span>
    </button>
  );

  return (
    <div className="screen">
      <Topbar title="设置" onBack={onBack} />
      <div className="scroll stack">
        <div className="section-title">当前钱包</div>
        <div className="list">
          <Row label="钱包名称" value={session.name} onClick={() => setSub('rename')} />
          <Row label="备份助记词" onClick={() => setSub('reveal')} />
          <Row label="修改密码" onClick={() => setSub('password')} />
          <Row label="派生信息" value={session.mode === 'oyster' ? '官方兼容' : '标准 BIP32'} onClick={() => setSub('about')} />
        </div>
        <div className="section-title">通用</div>
        <div className="list">
          <Row label="索引节点" value={settings ? new URL(settings.indexers[session.network][0]).host : ''} onClick={() => setSub('indexers')} />
          <div className="item" style={{ cursor: 'default' }}>
            <div className="grow title">自动锁定</div>
            <select
              className="select"
              style={{ width: 120, padding: '6px 8px' }}
              value={settings?.autoLockMinutes ?? 15}
              onChange={async e => setSettings(await W.setSettings({ autoLockMinutes: Number(e.target.value) }))}
            >
              {[5, 15, 30, 60, 240].map(m => <option key={m} value={m}>{m} 分钟</option>)}
            </select>
          </div>
        </div>
        <div className="list mt">
          <Btn className="block" onClick={onLock}><IconLock />立即锁定</Btn>
          <Row label="删除此钱包" danger onClick={() => setSub('delete')} />
        </div>
        <p className="tiny faint center">{APP_NAME} v0.1.0 · by PRLFlipBTC · 非 Pearl Research Labs 官方产品</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ reveal mnemonic (explicit export flow)

function Reveal({ onBack, onLocked }: { onBack: () => void; onLocked: () => void }) {
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
      setError(errMsg(e));
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
        <Topbar title="助记词" onBack={done} />
        <div className="scroll stack">
          <Notice kind="danger">任何看到这些内容的人都能拿走你的全部资产。不要截图、不要复制、不要输入到任何网站。</Notice>
          {isHex ? (
            <div className="card mono" style={{ filter: shown ? 'none' : 'blur(6px)' }}>{secret.words[0]}</div>
          ) : (
            <div className={`words ${shown ? '' : 'blur'}`}>
              {secret.words.map((w, i) => (
                <div className="word" key={i}><span className="n">{i + 1}</span><span>{w}</span></div>
              ))}
              {!shown && (
                <button className="reveal-cover" onClick={() => setShown(true)}>
                  <span className="row"><IconEye />点击显示</span>
                </button>
              )}
            </div>
          )}
          {isHex && !shown && <Btn onClick={() => setShown(true)}><IconEye />显示 hex 种子</Btn>}
          {secret.passphrase && <Notice kind="warn">此钱包还设置了 BIP39 密语，恢复时需要同时提供（密语不在此显示）。</Notice>}
        </div>
        <div className="footer"><Btn className="primary" onClick={done}>我已抄好，隐藏</Btn></div>
      </div>
    );
  }

  const items = ['助记词是恢复钱包的唯一凭证，泄露即丢币。', '任何人（包括「客服」）索要助记词都是骗子。', '我会在无人、无摄像头的环境下查看并手写保存。'];
  return (
    <div className="screen">
      <Topbar title="备份助记词" onBack={onBack} />
      <div className="scroll stack">
        <Notice kind="warn">即将显示你的助记词。请确认以下事项：</Notice>
        {items.map((t, i) => (
          <label className="check" key={i}>
            <input type="checkbox" checked={ack[i]} onChange={e => setAck(a => a.map((v, j) => (j === i ? e.target.checked : v)))} />
            {t}
          </label>
        ))}
        <PasswordField value={pw} onChange={setPw} onEnter={() => ack.every(Boolean) && pw && go()} error={error} />
      </div>
      <div className="footer">
        <Btn className="primary" disabled={!ack.every(Boolean) || !pw} loading={busy} onClick={go}>显示助记词</Btn>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ password

function ChangePassword({ onBack }: { onBack: () => void }) {
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
      toast('密码已修改');
      onBack();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="screen">
      <Topbar title="修改密码" onBack={onBack} />
      <div className="scroll stack">
        <PasswordField label="当前密码" value={old} onChange={setOld} autoFocus />
        <PasswordField label="新密码" value={pw} onChange={setPw} placeholder="至少 8 位" error={problem} />
        <PasswordField label="确认新密码" value={pw2} onChange={setPw2} error={pw2 && pw !== pw2 ? '两次输入不一致' : null} onEnter={() => ok && go()} />
        {error && <Notice kind="danger">{error}</Notice>}
      </div>
      <div className="footer"><Btn className="primary" disabled={!ok} loading={busy} onClick={go}>保存</Btn></div>
    </div>
  );
}

// ------------------------------------------------------------------ indexers

function Indexers({ settings, onBack }: { settings: S; onBack: () => void }) {
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
      if (s.indexers[net].includes(u)) throw new Error('已存在');
      // runtime, per-origin permission instead of a broad host permission in the manifest
      if (!(await requestOrigin(u))) throw new Error('未授予该节点的访问权限');
      const st = await W.indexerStatus(net, u);
      if (!st.ok) throw new Error(st.error ?? '节点不可用');
      setS(await W.setSettings({ indexers: { ...s.indexers, [net]: [...s.indexers[net], u] } }));
      setUrl('');
    } catch (e) {
      setError(errMsg(e));
    }
  };
  const remove = async (u: string) => {
    try {
      setS(await W.setSettings({ indexers: { ...s.indexers, [net]: s.indexers[net].filter(x => x !== u) } }));
    } catch (e) {
      setError(errMsg(e));
    }
  };
  const promote = async (u: string) => setS(await W.setSettings({ indexers: { ...s.indexers, [net]: [u, ...s.indexers[net].filter(x => x !== u)] } }));

  return (
    <div className="screen">
      <Topbar title="索引节点" onBack={onBack} />
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
              <div className="item" key={u} style={{ cursor: 'default' }}>
                <div className="grow">
                  <div className="title ellipsis">{new URL(u).host}{i === 0 && <span className="pill" style={{ marginLeft: 6 }}>首选</span>}</div>
                  <div className="meta">
                    {!st ? '检测中…' : st.ok ? <span className="green">高度 {st.height?.toLocaleString()}{st.inSync ? '' : '（同步中）'}</span> : <span className="red">{st.error}</span>}
                  </div>
                </div>
                {i > 0 && <button className="btn sm" onClick={() => promote(u)}>设为首选</button>}
                {s.indexers[net].length > 1 && <button className="btn sm danger" onClick={() => remove(u)}>移除</button>}
              </div>
            );
          })}
        </div>
        <div className="field">
          <label>添加 Blockbook 节点（HTTPS）</label>
          <div className="row">
            <input className="input" value={url} placeholder="https://your-blockbook.example" onChange={e => setUrl(e.target.value)} />
            <Btn className="sm" style={{ height: 44 }} disabled={!url} onClick={add}><IconPlus /></Btn>
          </div>
        </div>
        {error && <Notice kind="danger">{error}</Notice>}
        <Notice kind="info">节点只用于查询余额/UTXO 和广播交易，永远拿不到你的私钥。节点会知道你的地址（xpub），注重隐私可自建 Blockbook。返回的链名必须与 {NETWORKS[net].backendChain} 一致才会被使用。</Notice>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ about / rename / delete

function About({ session, onBack }: { session: SessionInfo; onBack: () => void }) {
  const net = NETWORKS[session.network];
  return (
    <div className="screen">
      <Topbar title="派生信息" onBack={onBack} />
      <div className="scroll stack">
        <div className="card tight">
          <Kv k="网络">Pearl {net.label}</Kv>
          <Kv k="地址类型">Taproot (BIP86, bech32m)</Kv>
          <Kv k="地址前缀">{net.hrp}1p…</Kv>
          <Kv k="账户路径">{session.accountPath}</Kv>
          <Kv k="收款 / 找零">…/0/i · …/1/i</Kv>
          <Kv k="派生方式">{session.mode === 'oyster' ? '官方兼容（hdkeychain DeriveNonStandard）' : '标准 BIP32'}</Kv>
          <Kv k="助记词">BIP39 英文词表</Kv>
        </div>
        <Notice kind="info">与官方 Pearl Wallet / oyster 使用相同的路径和派生方式：同一助记词在两边得到相同地址，可以互相导入。</Notice>
      </div>
    </div>
  );
}

function Rename({ session, onBack, onDone }: { session: SessionInfo; onBack: () => void; onDone: (s: SessionInfo) => void }) {
  const [name, setName] = useState(session.name);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="screen">
      <Topbar title="钱包名称" onBack={onBack} />
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
              setError(errMsg(e));
            }
          }}
        >
          保存
        </Btn>
      </div>
    </div>
  );
}

function Delete({ session, onBack, onDeleted }: { session: SessionInfo; onBack: () => void; onDeleted: () => void }) {
  const [typed, setTyped] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = typed.trim() === session.name && pw;
  return (
    <div className="screen">
      <Topbar title="删除钱包" onBack={onBack} />
      <div className="scroll stack">
        <Notice kind="danger">删除后，本机上该钱包的加密数据会被移除。没有助记词备份将永久失去资产。链上资产不受影响，可用助记词重新导入。</Notice>
        <div className="field">
          <label>输入钱包名称「{session.name}」以确认</label>
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
              setError(errMsg(e));
            } finally {
              setBusy(false);
              setPw('');
            }
          }}
        >
          永久删除
        </Btn>
      </div>
    </div>
  );
}
