// Build-time app metadata. __APP_VERSION__ is injected by vite.config.ts from package.json,
// which scripts/release.sh keeps in lockstep with public/manifest.json.
declare const __APP_VERSION__: string;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';
export const REPO_URL = 'https://github.com/akoya-wallet/akoya-extension';
