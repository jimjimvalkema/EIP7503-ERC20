import { findPoWNonce } from "../hashing.ts";

self.onmessage = (e: MessageEvent) => {
  const { blindedAddressDataHash, startingValue, difficulty } = e.data;
  const powNonce = findPoWNonce({ blindedAddressDataHash, startingValue, difficulty });
  self.postMessage(powNonce);
};