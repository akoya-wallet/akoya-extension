import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isWalletError } from '../core/errors.ts';
import en, { type MsgKey } from './en.ts';
import zhCN from './zh-CN.ts';
import type { Language } from '../ext/types.ts';

export type { MsgKey };
export type Vars = Record<string, string | number>;

const DICTS: Record<Language, Record<MsgKey, string>> = { en, 'zh-CN': zhCN };

export const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'zh-CN', label: '简体中文' },
];

export function translate(lang: Language, key: MsgKey, vars?: Vars): string {
  const s = DICTS[lang][key] ?? en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

const isKey = (k: string): k is MsgKey => k in en;

/** Localised text for anything thrown by core/ext code. */
export function errorText(lang: Language, e: unknown): string {
  if (isWalletError(e)) {
    const key = `err.${e.code}`;
    return isKey(key) ? translate(lang, key, e.params) : e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

interface I18n {
  lang: Language;
  setLang: (l: Language) => void;
  t: (key: MsgKey, vars?: Vars) => string;
  te: (e: unknown) => string;
  locale: string;
}

const Ctx = createContext<I18n>({
  lang: 'en',
  setLang: () => {},
  t: (k, v) => translate('en', k, v),
  te: e => errorText('en', e),
  locale: 'en',
});

export function I18nProvider({ initial, onChange, children }: { initial: Language; onChange: (l: Language) => void; children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(initial);
  useEffect(() => setLangState(initial), [initial]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback(
    (l: Language) => {
      setLangState(l);
      onChange(l);
    },
    [onChange],
  );
  const value = useMemo<I18n>(
    () => ({
      lang,
      setLang,
      t: (k, v) => translate(lang, k, v),
      te: e => errorText(lang, e),
      locale: lang === 'zh-CN' ? 'zh-CN' : 'en-US',
    }),
    [lang, setLang],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
