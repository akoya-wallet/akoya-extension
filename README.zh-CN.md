<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/png/lockup-white.png">
    <img src="brand/png/lockup-ink.png" alt="Akoya" width="360">
  </picture>
</p>

# Akoya — 开源 Pearl (PRL) 钱包

_由 PRLFlipBTC 开发 · [akoyawallet.app](https://akoyawallet.app)_

[English](README.md)

Akoya（阿古屋珍珠）是 **Pearl (PRL)** 的自托管 Chrome 插件钱包，可以理解为「Pearl 版的开源 MetaMask」：
私钥只在你的浏览器里，所有接触私钥的代码都公开可审计。

> **状态：Alpha，未经审计。** 请只放少量资金。Akoya 由独立团队 PRLFlipBTC 开发，**非 Pearl Research Labs 官方产品**。

**官方源码：**<https://github.com/akoya-wallet/akoya-extension> · **官方扩展 ID：**尚未发布。在这里填上之前，任何自称 Akoya 的插件都不是我们。见 [TRADEMARKS.md](TRADEMARKS.md)。

## 功能

- 创建钱包 / 导入 BIP39 助记词（也支持 oyster 导出的 hex 种子）
- **与官方 Pearl Wallet / oyster 地址完全一致**（包括 oyster 的非标准派生）
- 收款二维码；发送到 Taproot / P2MR 地址，签名前展示完整交易
- 交易记录、挖矿奖励成熟度识别，矿池结算标记为挖矿收益
- 可选的矿池关联（Pearlhash）：矿机、每张 GPU 的算力（自动标出偏慢的卡）、待结算收益和矿池打款；只向矿池发送你的挖矿地址
- 可选的法币价值和每日盈亏（USD、CNY、HKD、EUR、JPY、KRW 或 BTC/sats），本机每日记录；默认关闭，价格来自 CoinGecko，不发送任何钱包数据
- 多钱包、Mainnet / Testnet2、可自定义 Blockbook 索引节点
- 私钥只在签名瞬间存在于内存，签名完全离线

## 安装（开发者模式）

```bash
npm ci
```

```bash
npm run build
```

打开 `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选择 `dist/`。

## 关键协议事实

见英文 README 的 [How Pearl works](README.md#how-pearl-works-for-wallet-developers) 一节，要点：

- btcd 分叉、UTXO 模型；地址只有 Taproot（v1）和 P2MR（v2），bech32m，`prl1p…`
- 助记词 BIP39 英文，无密语；路径 `m/86'/808276'/0'/{0,1}/i`
- 签名为标准 BIP340/341；1 PRL = 10⁸ grain
- **oyster 用 `DeriveNonStandard` 派生**：约 1% 的助记词在官方钱包里的地址和标准 BIP86 钱包不同，Akoya 默认复刻，导入时可在「高级选项」切换

## 安全 · 贡献 · 许可证

- 威胁模型 [THREAT_MODEL.md](THREAT_MODEL.md)、漏洞报告 [SECURITY.md](SECURITY.md)、权限说明 [PERMISSIONS.md](PERMISSIONS.md)
- 贡献指南 [CONTRIBUTING.md](CONTRIBUTING.md)、路线图 [ROADMAP.md](ROADMAP.md)
- 代码采用 [MIT](LICENSE)；**Akoya 名称、Logo 及 `brand/` 目录不在授权范围内**，Fork 发布需改名换图标（[TRADEMARKS.md](TRADEMARKS.md)）
