import type { ReactNode } from 'react';

const I = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const IconBack = () => <I><path d="M15 18l-6-6 6-6" /></I>;
export const IconClose = () => <I><path d="M18 6L6 18M6 6l12 12" /></I>;
export const IconSettings = () => (
  <I>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </I>
);
export const IconHome = () => <I><path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></I>;
export const IconActivity = () => <I><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></I>;
export const IconArrowDown = () => <I><path d="M12 5v14M5 12l7 7 7-7" /></I>;
export const IconArrowUp = () => <I><path d="M12 19V5M5 12l7-7 7 7" /></I>;
export const IconSwap = () => <I><path d="M7 7h13l-3-3M17 17H4l3 3" /></I>;
// pickaxe: diagonal handle + curved head
export const IconPick = () => <I><path d="M4.5 19.5 13.5 10.5" /><path d="M8.5 4.5c4.6-1.6 9.6 1.4 11 6" /><path d="M11.5 6.2l6.3 6.3" /></I>;
export const IconCopy = () => <I><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></I>;
export const IconExternal = () => <I><path d="M14 3h7v7M10 14L21 3M21 14v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h6" /></I>;
export const IconLock = () => <I><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></I>;
export const IconWarn = () => <I><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" /></I>;
export const IconInfo = () => <I><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></I>;
export const IconCheck = () => <I><path d="M20 6L9 17l-5-5" /></I>;
export const IconChevron = () => <I><path d="M9 18l6-6-6-6" /></I>;
export const IconRefresh = () => <I><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5" /></I>;
export const IconEye = () => <I><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></I>;
export const IconPlus = () => <I><path d="M12 5v14M5 12h14" /></I>;
