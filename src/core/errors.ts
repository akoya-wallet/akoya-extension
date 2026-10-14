// User-facing failures carry a stable code + params; the UI localises them (src/i18n).
// Core code never formats human text, so it stays language-agnostic and easy to test.

export type ErrorParams = Record<string, string | number>;

export class WalletError extends Error {
  readonly code: string;
  readonly params: ErrorParams;
  constructor(code: string, params: ErrorParams = {}) {
    super(Object.keys(params).length ? `${code} ${JSON.stringify(params)}` : code);
    this.name = 'WalletError';
    this.code = code;
    this.params = params;
  }
}

export const isWalletError = (e: unknown): e is WalletError => e instanceof WalletError;
