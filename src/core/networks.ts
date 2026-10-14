// Pearl network parameters, taken from the official repo:
//   node/chaincfg/params.go          (HRP, coin type, HD version bytes)
//   wallet/waddrmgr/scoped_manager.go (BIP86 key scope = only default address type)
//   apps/.../blockbook-client.ts      (public Blockbook indexers)

export const APP_NAME = 'Akoya';

export type NetworkId = 'mainnet' | 'testnet2';

export interface PearlNetwork {
  id: NetworkId;
  label: string;
  /** bech32m human-readable part; addresses look like `<hrp>1p...` */
  hrp: string;
  /** BIP44 coin type used in m/86'/<coin>'/0' */
  coinType: number;
  /** HDPublicKeyID / HDPrivateKeyID from chaincfg (zpub/zprv on mainnet, vpub/vprv on testnets) */
  xpubVersion: number;
  xprvVersion: number;
  /** Network object for @scure/btc-signer. Only `bech32` matters: Pearl has no legacy address types. */
  signerNet: { bech32: string; pubKeyHash: number; scriptHash: number; wif: number };
  /** default indexers (user can add more in settings) */
  blockbook: string[];
  /** `backend.chain` an indexer must report for this network — never trust a mismatching endpoint */
  backendChain: string;
}

export const NETWORKS: Record<NetworkId, PearlNetwork> = {
  mainnet: {
    id: 'mainnet',
    label: 'Mainnet',
    hrp: 'prl',
    coinType: 808276,
    xpubVersion: 0x04b24746,
    xprvVersion: 0x04b2430c,
    signerNet: { bech32: 'prl', pubKeyHash: 0x00, scriptHash: 0x05, wif: 0x80 },
    blockbook: ['https://blockbook.pearlresearch.ai'],
    backendChain: 'mainnet',
  },
  testnet2: {
    id: 'testnet2',
    label: 'Testnet2',
    hrp: 'tprl',
    coinType: 1,
    xpubVersion: 0x045f1cf6,
    xprvVersion: 0x045f18bc,
    signerNet: { bech32: 'tprl', pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef },
    blockbook: ['https://blockbook.testnet.pearlresearch.ai'],
    backendChain: 'testnet2',
  },
};

export const bip32Versions = (net: PearlNetwork) => ({ public: net.xpubVersion, private: net.xprvVersion });

/** BIP86 purpose — the only scope oyster hands out addresses from by default. */
export const PURPOSE_BIP86 = 86;
export const ACCOUNT = 0;
export const EXTERNAL = 0;
export const INTERNAL = 1;

/** 1 PRL = 1e8 grains */
export const GRAINS_PER_PRL = 100_000_000n;

/** node/mempool/policy.go DefaultMinRelayTxFee = 1000 grain/kvB */
export const MIN_RELAY_FEE_PER_VB = 1;

/** node/chaincfg/params.go CoinbaseMaturity */
export const COINBASE_MATURITY = 100;

/** Sanity ceiling for fee rates coming from an (untrusted) indexer, grain/vB. */
export const MAX_SANE_FEE_PER_VB = 20_000;
