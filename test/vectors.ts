// Every public test vector lives here (and only here — see .gitleaks.toml).
// None of these keys or phrases control funds that belong to the project. Never add a real key.

export const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// 1) Official Pearl fixture: wallet/waddrmgr/common_test.go (expectedAddrs), produced by oyster itself.
export const WADDRMGR_SEED = '2a64df085eefedd8bfdbb33176b5ba2e62e8be8b56c8837795598bb6c440c064';
export const WADDRMGR = [
  { b: 0, i: 0, addr: 'prl1psayn40fkp3f3szxztahxwszhyjfxe3u9tqxycujd6q2zcw4uc99sm7r4na', priv: '006499105900d03c7ef9cf27b87521b83848cd6836b1ddd75aa498329aaaf717' },
  { b: 0, i: 1, addr: 'prl1pvdtcl546a64kk9p06nc75vrwlqfrl3m9myhl07wd69zvfma6fq3q9aduze', priv: '040c90c18fcfb63c5fbcf05c5bcaa03d7e9a3c196eb895517583f893d2b9ff8a' },
  { b: 0, i: 2, addr: 'prl1penz3j6q2rvnh02axv4ysxp6z789qtteezuq0jnm2nr5w562uaywqp6a2pw', priv: 'f49ce36c93e23026f55d7498efd4691b06ad5d46f93a70206f55c41734567059' },
  { b: 0, i: 3, addr: 'prl1pdl6palz9pxn5zdufcx9wguuz95wruwwu2awmdkpjf5p2lvdk2snsq5kd62', priv: 'ba3b3fc97e1806b4e1aad94854d457bebe24e481b06920b003f851468f604bdb' },
  { b: 0, i: 4, addr: 'prl1p0qmn60e5r5y55ztcna3p7vnwdq5c2pp4xa69a0e7gxt5vvr5mspq9rv6jt', priv: '569510b9bacee90b32dbdb8848228bbd15cafc01c587f830cfa144f5654e0b4f' },
  { b: 1, i: 0, addr: 'prl1pya7e4s6kl2tpf5awz34687j6cngw0lgrqd3qq927w2qzusxmgcgs4yad5m', priv: 'c690dbef68034da9065f0105e8206592ab72f0d51b50c68fac48a90a15e6f19d' },
  { b: 1, i: 1, addr: 'prl1pen8y8ph9jtqzn885qv4tlczmf5kg6k9cc53kkevu3wxenaq6zy0qs6rdc5', priv: '4dffd85a035b89b0985044720704521ad827d7a1a8fbfb08e17dd3a231b77045' },
  { b: 1, i: 2, addr: 'prl1pqz2jravv8q56wx2rpu8u84sdug5rah7rkt8dzqdvdndpclza0ysserpyel', priv: '3c14dec5cab4f78a294b044b6bec19c4417c1ff5c8cb6c5af086d8a2a79b0b8d' },
  { b: 1, i: 3, addr: 'prl1pdcl4mszx3c44ywv75ff4nhk6mnvnt9gu298reyqk70p6murvvagsyt898x', priv: '4fc4cd687802340fad2f55370b09c1c66bc29773b02b22b720d5faabc4adde62' },
  { b: 1, i: 4, addr: 'prl1plv3kmy9z60d7etcmwapjjfk0g0ahy8m9llt35pucs3zjdpkvffmqcgrxkq', priv: 'cfcc43bb92fff0a6c370b6fb3deff52cd4f9f04316c6cf823cba38fbcd9f5fec' },
];

// 2) Well-known public mnemonic on both Pearl networks. Cross-checked against the Pearl
//    Blockbook indexers' own xpub derivation (an independent implementation).
export const ABANDON_VECTORS = {
  mainnet: {
    xpub: 'zpub6s66goCpFBSqGDZyyD6a1Xf8C5TseQYcPFQNpjMzFeTCZpZD6ShaEzAKqv8tDiv81N1RmPyRTu1D65iQv59c7wHZyCbQmnaARE7P6UFNJeG',
    pub00: '02e0cafb2d3590eae1a95747476dd321335ac47b9c348026f19543dc6289f4ec4e',
    r0: 'prl1pr6yuq8u2r95wjzzgpdy8cpnncpl7l8zgy6x5q0367pnc53s2famqg7pt74',
    r1: 'prl1pyx3nlscz8rvsxqhcjtyqt2g5szuk9ss7m5saszu3afwwhvn9zp2sz62rhm',
    c0: 'prl1puwagcza86exfh3cx6ur08wq7njc32e66ep0zje7le6c7cak8lqeq655gqa',
  },
  testnet2: {
    xpub: 'vpub5Zdms8TyURsNuQknxffm1XM1CcFxiqChxhkyCzZJSYXJsUZP5EBT7j45J3ngkje2bze8H6kxFQST7ZhjJq9ScUXz64F2SzCCJRGYFbFptfo',
    pub00: '0255355ca83c973f1d97ce0e3843c85d78905af16b4dc531bc488e57212d230116',
    r0: 'tprl1p8wpt9v4frpf3tkn0srd97pksgsxc5hs52lafxwru9kgeephvs7rqm5v93u',
    r1: 'tprl1p90h6z3p36n9hrzy7580h5l429uwchyg8uc9sz4jwzhdtuhqdl5eql4fqfa',
    c0: 'tprl1p6uav7en8k7zsumsqugdmg5j6930zmzy4dg7jcddshsr0fvxlqx7q64nev7',
  },
} as const;

// 3) node/btcutil/hdkeychain/extendedkey_test.go TestLeadingZero: seed = 32 bytes ending in uint32(399),
//    child m/0'/0' derived with BIP32 Derive vs. DeriveNonStandard.
export const LEADING_ZERO = {
  standard: 'a9b6b30a5b90b56ed48728c73af1d8a7ef1e9cc372ec21afcc1d9bdf269b0988',
  oyster: 'ea46d8f58eb863a2d371a938396af8b0babe85c01920f59a8044412e70e837ee',
};
