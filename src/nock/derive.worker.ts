// Short-lived worker: seed in (transferred), NOCK address out, then it is terminated by the page.
// The private key only ever exists inside this worker's WebAssembly memory.
import init, { addressOf, masterPublicKey } from './wasm/akoya_nock.js';

self.onmessage = async (e: MessageEvent<Uint8Array>) => {
  const seed = e.data;
  try {
    await init();
    const address = addressOf(masterPublicKey(seed));
    self.postMessage({ address });
  } catch {
    self.postMessage({});
  } finally {
    if (seed instanceof Uint8Array) seed.fill(0);
  }
};
