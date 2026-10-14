import { useCallback, useEffect, useState } from 'react';
import * as W from '../ext/wallet.ts';
import { extensionUrl, isPopup, openTab } from '../ext/platform.ts';
import type { Language, Overview, SessionInfo, WalletMeta } from '../ext/types.ts';
import { I18nProvider } from '../i18n/index.tsx';
import { ToastProvider } from './components/common.tsx';
import { CreateWallet, ImportWallet, Welcome } from './pages/Onboarding.tsx';
import { MainShell, Receive, Unlock } from './pages/Main.tsx';
import { Send } from './pages/Send.tsx';
import { Settings } from './pages/Settings.tsx';

type Route =
  | { k: 'loading' }
  | { k: 'welcome' }
  | { k: 'create' }
  | { k: 'import' }
  | { k: 'unlock'; id?: string }
  | { k: 'main' }
  | { k: 'receive'; ov: Overview }
  | { k: 'send' }
  | { k: 'settings' };

const inExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.id;

export function App() {
  const [route, setRoute] = useState<Route>({ k: 'loading' });
  const [wallets, setWallets] = useState<WalletMeta[]>([]);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [lang, setLang] = useState<Language | null>(null);

  const boot = useCallback(async () => {
    const [list, settings] = await Promise.all([W.listWallets(), W.getSettings()]);
    setLang(l => l ?? settings.language);
    setWallets(list);
    if (!list.length) {
      // like Phantom: onboarding happens in a full tab so the popup can't close mid-backup
      if (inExtension && isPopup()) {
        openTab(extensionUrl('popup.html?tab=1'));
        window.close();
        return;
      }
      return setRoute({ k: 'welcome' });
    }
    const s = await W.session();
    if (s) {
      setSession(s);
      setRoute({ k: 'main' });
    } else {
      setRoute({ k: 'unlock', id: await W.lastWalletId() });
    }
  }, []);

  useEffect(() => void boot(), [boot]);

  const persistLang = useCallback((l: Language) => {
    void W.setSettings({ language: l });
  }, []);

  const addWallet = () => {
    if (inExtension && isPopup()) {
      openTab(extensionUrl('popup.html?tab=1'));
      window.close();
    } else setRoute({ k: 'welcome' });
  };

  const onSession = async (s: SessionInfo) => {
    setSession(s);
    setWallets(await W.listWallets());
    setRoute({ k: 'main' });
  };

  const lock = async () => {
    await W.lock();
    setSession(null);
    setRoute({ k: 'unlock', id: session?.walletId });
  };

  if (!lang) return <div className="screen" />;

  let view;
  switch (route.k) {
    case 'loading':
      view = <div className="screen" />;
      break;
    case 'welcome':
      view = (
        <Welcome
          onCreate={() => setRoute({ k: 'create' })}
          onImport={() => setRoute({ k: 'import' })}
          onCancel={wallets.length ? () => void boot() : undefined}
        />
      );
      break;
    case 'create':
      view = <CreateWallet onBack={() => setRoute({ k: 'welcome' })} onDone={onSession} />;
      break;
    case 'import':
      view = <ImportWallet onBack={() => setRoute({ k: 'welcome' })} onDone={onSession} />;
      break;
    case 'unlock':
      view = <Unlock wallets={wallets} initialId={route.id} onUnlocked={onSession} onAdd={addWallet} />;
      break;
    case 'main':
      view = session && (
        <MainShell
          session={session}
          wallets={wallets}
          onSend={() => setRoute({ k: 'send' })}
          onReceive={ov => setRoute({ k: 'receive', ov })}
          onSettings={() => setRoute({ k: 'settings' })}
          onLock={lock}
          onSwitch={async id => {
            await W.lock();
            setSession(null);
            setRoute({ k: 'unlock', id });
          }}
          onAdd={addWallet}
        />
      );
      break;
    case 'receive':
      view = session && <Receive session={session} overview={route.ov} onBack={() => setRoute({ k: 'main' })} />;
      break;
    case 'send':
      view = session && <Send session={session} onBack={() => setRoute({ k: 'main' })} onLocked={lock} />;
      break;
    case 'settings':
      view = session && (
        <Settings
          session={session}
          onBack={() => setRoute({ k: 'main' })}
          onLock={lock}
          onDeleted={() => {
            setSession(null);
            void boot();
          }}
          onRenamed={s => {
            setSession(s);
            void W.listWallets().then(setWallets);
          }}
        />
      );
      break;
  }

  return (
    <I18nProvider initial={lang} onChange={persistLang}>
      <ToastProvider>{view}</ToastProvider>
    </I18nProvider>
  );
}
