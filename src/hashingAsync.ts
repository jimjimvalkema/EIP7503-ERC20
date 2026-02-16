import { Worker } from "node:worker_threads";
import { POW_DIFFICULTY } from "./constants.ts";


const findPowNonceWorkerLocation = "workers/findPowNonce.ts";

export async function findPoWNonceAsync({
    blindedAddressDataHash,
    startingValue,
    difficulty = POW_DIFFICULTY,
}: {
    blindedAddressDataHash: bigint;
    startingValue: bigint;
    difficulty: bigint;
}): Promise<bigint> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(
            new URL(findPowNonceWorkerLocation, import.meta.url),
            {
                workerData: { blindedAddressDataHash, startingValue, difficulty },
                execArgv: ["--experimental-transform-types"],
            } as any,
        );
        worker.on("message", resolve);
        worker.on("error", reject);
        worker.on("exit", (code) => {
            if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
        });
    });
}