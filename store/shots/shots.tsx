// Store screenshot harness (dev only — never part of the extension build).
// Renders the real UI with demo data: the public "abandon … about" test wallet and a stubbed
// indexer, so no real person's addresses or balances appear in marketing images.
//   http://localhost:5199/store/shots/index.html?scene=home|receive|send|nodes|zh|promo
import { createRoot } from 'react-dom/client';
import { App } from '../../src/ui/App.tsx';
import '../../src/ui/styles.css';
import './shots.css';
import { deriveAccount, seedBytes, AddressBook } from '../../src/core/account.ts';
import { NETWORKS } from '../../src/core/networks.ts';
import { bech32m } from '../../src/core/encoding.ts';
import { localStore, sessionStore } from '../../src/ext/platform.ts';
import lockup from '../../brand/png/lockup-white.png';
import mark from '../../brand/svg/akoya-mark-pearl.svg';

const scene = new URLSearchParams(location.search).get('scene') ?? 'home';
const net = NETWORKS.mainnet;
const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ZOO = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
const POOL = 'prl1p50ltku2jjcwdxh4nzjrw98nwdswdn25qdkr2fdtw8hsq3qu9cdhscchnnm';
// a valid but unowned demo address (fixed bytes), so nobody's real address appears in the images
const EXCHANGE = bech32m.encode('prl', [1, ...bech32m.toWords(Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff))]);

const COPY: Record<string, { title: string; sub: string }> = {
  home: { title: 'Built for Pearl miners', sub: 'Pool payouts and block rewards show up as mining income, with a running total for today.' },
  receive: { title: 'Receive in one tap', sub: 'A fresh Taproot address and QR code every time. Same addresses as the official Pearl Wallet.' },
  send: { title: 'See every detail before you sign', sub: 'Recipient, amount, fee, change and inputs — signed locally, keys never leave your device.' },
  nodes: { title: 'Your node, your explorer', sub: 'Pick or add your own RPC nodes and block explorers. Live height and latency at a glance.' },
  zh: { title: 'English & 简体中文', sub: 'Switch languages any time. Open source, reproducible builds, no tracking.' },
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 8000) {
  const t0 = Date.now();
  while (!fn() && Date.now() - t0 < ms) await sleep(50);
}
const byText = (sel: string, text: string) => [...document.querySelectorAll<HTMLElement>(sel)].find(e => e.textContent?.includes(text));
const fill = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

async function setup() {
  const a = deriveAccount(await seedBytes(ABANDON), net, 'oyster');
  const z = deriveAccount(await seedBytes(ZOO), net, 'oyster');
  const book = new AddressBook(a.xpub, net);
  const r0 = book.get(0, 0).address;
  const c0 = book.get(1, 0).address;
  const now = Math.floor(Date.now() / 1000);
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const m0 = Math.floor(midnight.getTime() / 1000);
  // today: spread across the part of the day that has already passed; yesterday: fixed clock times
  const today = (frac: number) => m0 + Math.floor((now - 120 - m0) * frac);
  const yesterday = (h: number, m: number) => m0 - 86400 + h * 3600 + m * 60;
  const h64 = (n: number) => n.toString(16).padStart(64, 'a');

  const payout = (i: number, grains: number, time: number) => ({
    txid: h64(1000 + i),
    vin: [{ n: 0, txid: h64(5000 + i), vout: 0, addresses: [POOL], isAddress: true, value: '900000000000' }],
    vout: [
      { n: 0, value: String(grains), addresses: [r0], isAddress: true, isOwn: true },
      { n: 1, value: '5000000000', addresses: [EXCHANGE], isAddress: true },
    ],
    blockHeight: 127800 - i, confirmations: 6 + i * 4, blockTime: time, value: '0', valueIn: '0', fees: '312000',
  });
  const sent = {
    txid: h64(2000),
    vin: [{ n: 0, txid: h64(6000), vout: 0, addresses: [r0], isAddress: true, isOwn: true, value: '60000000000' }],
    vout: [
      { n: 0, value: '25000000000', addresses: [EXCHANGE], isAddress: true },
      { n: 1, value: '34999972300', addresses: [c0], isAddress: true, isOwn: true },
    ],
    blockHeight: 127760, confirmations: 52, blockTime: yesterday(21, 14), value: '0', valueIn: '0', fees: '27700',
  };
  const history = [
    payout(0, 2841342563, today(0.97)),
    payout(1, 2582651234, today(0.72)),
    payout(2, 4106812345, today(0.46)),
    payout(3, 2007345678, today(0.18)),
    sent,
    payout(4, 3115870021, yesterday(19, 2)),
    payout(5, 2690412356, yesterday(16, 48)),
  ];
  const utxos = [
    { txid: h64(3001), vout: 0, value: '180000000000', confirmations: 340, path: "m/86'/808276'/0'/0/0", address: r0 },
    { txid: h64(3002), vout: 0, value: '95000000000', confirmations: 220, path: "m/86'/808276'/0'/0/0", address: r0 },
    { txid: h64(3003), vout: 1, value: '73253012385', confirmations: 160, path: "m/86'/808276'/0'/1/0", address: c0 },
  ];
  const xpubA = encodeURIComponent(`tr(${a.xpub})`);

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    let body: unknown = { error: 'unexpected' };
    if (/\/api\/v2$/.test(u)) body = { blockbook: { coin: 'Pearl', bestHeight: 127806, inSync: true }, backend: { chain: 'mainnet' } };
    else if (u.includes('/api/v2/xpub/') && u.includes(xpubA)) {
      body = {
        balance: '348253012385', unconfirmedBalance: '0', txs: 37, page: 1, totalPages: 2,
        tokens: [
          { name: r0, path: "m/86'/808276'/0'/0/0", transfers: 36, balance: '275000000000' },
          { name: c0, path: "m/86'/808276'/0'/1/0", transfers: 1, balance: '73253012385' },
        ],
        transactions: history,
      };
    } else if (u.includes('/api/v2/xpub/')) body = { balance: '0', unconfirmedBalance: '0', txs: 0, tokens: [], transactions: [] };
    else if (u.includes('/api/v2/utxo/') && u.includes(xpubA)) body = utxos;
    else if (u.includes('/api/v2/utxo/')) body = [];
    else if (u.includes('/api/v2/tx/')) {
      const id = u.split('/api/v2/tx/')[1];
      body = { txid: id, vin: [{ n: 0, isAddress: false }], vout: [], blockHeight: 127700, confirmations: 110, blockTime: now - 30000, fees: '0' };
    } else if (u.includes('/api/v2/estimatefee/1')) body = { result: '0.01802650' };
    else if (u.includes('/api/v2/estimatefee/3')) body = { result: '0.00090090' };
    else if (u.includes('/api/v2/estimatefee/')) body = { result: '0.00001000' };
    await sleep(30);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;

  const entry = (id: string, name: string, xpub: string, i: number) => ({
    version: 1, id, name, network: 'mainnet', mode: 'oyster', createdAt: `2026-10-0${i}T00:00:00.000Z`, xpub,
    kdf: { name: 'argon2id', salt: '', m: 1, t: 1, p: 1 }, cipher: { name: 'AES-GCM', iv: '', data: '' },
  });
  const idA = '11111111-1111-4111-8111-111111111111';
  await localStore.set('vault.v1', [entry(idA, 'Mining Rig', a.xpub, 1), entry('22222222-2222-4222-8222-222222222222', 'Savings', z.xpub, 2)]);
  await localStore.set('settings.v1', { language: scene === 'zh' ? 'zh-CN' : 'en' });
  await localStore.set('miningSenders.v1', [POOL]);
  await sessionStore.set('session.v1', { walletId: idA, name: 'Mining Rig', network: 'mainnet', mode: 'oyster', xpub: a.xpub, lastActive: Date.now() });
}

async function drive() {
  await until(() => !!byText('.action', 'Receive') || !!byText('.action', '接收'));
  await sleep(600);
  if (scene === 'receive') byText('.action', 'Receive')!.click();
  if (scene === 'send') {
    byText('.action', 'Send')!.click();
    await until(() => !!document.querySelector('.own-chip'));
    (document.querySelector('.own-chip') as HTMLElement).click();
    await sleep(100);
    fill(document.querySelector('.input-wrap input') as HTMLInputElement, '250');
    await until(() => !!byText('.seg button', '90.09'));
    byText('button.btn.primary', 'Review')!.click();
    await until(() => !!byText('h1', 'Confirm transaction'));
  }
  if (scene === 'nodes') {
    byText('.tabbar button', 'Settings')!.click();
    await until(() => !!byText('.item', 'RPC node'));
    byText('.item', 'RPC node')!.click();
    await until(() => !!byText('.meta', 'ms'));
  }
  await sleep(400);
  document.title = 'ready';
}

function Frame() {
  if (scene === 'marquee') {
    return (
      <div className="marquee">
        <div className="copy">
          <img className="lockup" src={lockup} alt="Akoya" />
          <h1>The open-source wallet for Pearl miners</h1>
          <p>Self-custody · Same addresses as the official Pearl Wallet · Reproducible, verifiable builds</p>
        </div>
        <div className="device">
          <div id="root">
            <App />
          </div>
        </div>
      </div>
    );
  }
  const c = COPY[scene];
  if (scene === 'promo') {
    return (
      <div className="promo">
        <img className="promo-mark" src={mark} alt="" />
        <div>
          <div className="promo-name">Akoya</div>
          <div className="promo-tag">Open-source wallet<br />for Pearl (PRL)</div>
        </div>
      </div>
    );
  }
  return (
    <div className="shot">
      <div className="copy">
        <img className="lockup" src={lockup} alt="Akoya" />
        <h1>{c.title}</h1>
        <p>{c.sub}</p>
        <div className="foot">Open source · Self-custody · Pearl (PRL)</div>
      </div>
      <div className="device">
        <div id="root">
          <App />
        </div>
      </div>
    </div>
  );
}

if (scene === 'promo') {
  document.body.className = 'promo-body';
  createRoot(document.getElementById('frame')!).render(<Frame />);
  document.title = 'ready';
} else {
  document.body.className = scene === 'marquee' ? 'marquee-body' : 'shot-body';
  await setup();
  createRoot(document.getElementById('frame')!).render(<Frame />);
  void drive();
}
