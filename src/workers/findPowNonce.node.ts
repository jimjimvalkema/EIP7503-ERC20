import { findPoWNonce } from "../hashing.ts"
import { parentPort, workerData } from "node:worker_threads";

const { blindedAddressDataHash, startingValue, difficulty } = workerData as { blindedAddressDataHash:bigint, startingValue:bigint, difficulty:bigint };
const powNonce = findPoWNonce({ blindedAddressDataHash, startingValue, difficulty })

parentPort?.postMessage(powNonce);