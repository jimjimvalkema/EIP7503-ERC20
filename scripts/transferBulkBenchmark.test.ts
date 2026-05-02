import { describe, it } from "node:test";

import { network } from "hardhat";
import { deployPoseidon2Huff } from "@warptoad/gigabridge-js";

import {
    TransWarpTokenContractName,
    leanIMTPoseidon2ContractName,
    POW_DIFFICULTY,
    RE_MINT_LIMIT,
    MAX_TREE_DEPTH,
    GAS_LIMIT_TX,
} from "../src/constants.ts";
import { getContract, padHex, toHex, type Address, type PublicClient, type WalletClient } from "viem";
import type { KeyedClient } from "@nomicfoundation/hardhat-viem/types";

// Sizes chosen to span from well-under-cap to well-over-cap so we can see
// whether the EDR 3× overestimation bug applies to non-Honk calls too.
const BATCH_SIZES = [50, 200, 500, 1000, 1500, 2000];

describe("transferBulk gas benchmark (EDR over-cap ratio check)", async function () {
    const { viem, networkHelpers } = await network.connect();
    const publicClient = (await viem.getPublicClient()) as PublicClient;
    const [deployer, alice] = await viem.getWalletClients();

    // Deploy once — no verifiers needed for transferBulk.
    const poseidon2Create2Salt = padHex("0x00", { size: 32 });
    await deployPoseidon2Huff(publicClient, deployer, poseidon2Create2Salt);
    const leanIMTPoseidon2 = await viem.deployContract(leanIMTPoseidon2ContractName, [], {});
    const transwarpToken = await viem.deployContract(
        TransWarpTokenContractName,
        [
            toHex(POW_DIFFICULTY, { size: 32 }),
            RE_MINT_LIMIT,
            MAX_TREE_DEPTH,
            false,
            "TWRP",
            "zkTransWarpTestToken",
            "1",
            [],
            [],
        ],
        { client: { wallet: deployer } as KeyedClient, libraries: { leanIMTPoseidon2: leanIMTPoseidon2.address } },
    );
    const postDeploy = await networkHelpers.takeSnapshot();

    for (const batchSize of BATCH_SIZES) {
        it(`transferBulk batchSize=${batchSize}`, async function () {
            await postDeploy.restore();

            const tokenAlice = getContract({
                client: { public: publicClient, wallet: alice },
                abi: transwarpToken.abi,
                address: transwarpToken.address,
            });

            await tokenAlice.write.getFreeTokens([alice.account.address]);

            const recipients = Array.from({ length: batchSize }, (_, i) =>
                toHex(BigInt(i + 1), { size: 20 }) as Address
            );
            const amounts = Array<bigint>(batchSize).fill(1n);

            // Estimate FIRST — before the tx mutates the tree (insertions vs updates
            // have very different gas costs, so order matters).
            let estimatedGas: bigint | null = null;
            let overCap = false;
            try {
                estimatedGas = await tokenAlice.estimateGas.transferBulk(
                    [recipients, amounts],
                    { gas: GAS_LIMIT_TX, account: alice.account },
                );
            } catch (err: any) {
                let cur = err;
                while (cur) {
                    const det: string | undefined = cur.details ?? cur.message;
                    const m = det?.match(/transaction gas limit \((\d+)\) is greater than the cap/);
                    if (m) { estimatedGas = BigInt(m[1]); overCap = true; break; }
                    cur = cur.cause;
                }
                if (!overCap) {
                    const msg = String(err?.shortMessage ?? err?.message ?? err).slice(0, 120);
                    console.log(`  batch=${batchSize}: estimateGas unknown error — ${msg}`);
                }
            }

            // Actual tx — after the estimate so the pre-tx tree state is the same for both.
            let actualGas: bigint | null = null;
            try {
                const txHash = await tokenAlice.write.transferBulk(
                    [recipients, amounts],
                    { gas: GAS_LIMIT_TX },
                );
                const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
                actualGas = receipt.gasUsed;
            } catch (err: any) {
                const msg = String(err?.shortMessage ?? err?.message ?? err).slice(0, 120);
                console.log(`  batch=${batchSize}: tx failed — ${msg}`);
            }

            if (actualGas !== null && estimatedGas !== null) {
                const ratio = (Number(estimatedGas) / Number(actualGas)).toFixed(3);
                const flag = overCap ? " [OVER-CAP]" : "";
                console.log(`  batch=${batchSize}: actual=${actualGas} estimate=${estimatedGas} ratio=${ratio}${flag}`);
            } else if (estimatedGas !== null) {
                const flag = overCap ? " [OVER-CAP]" : "";
                console.log(`  batch=${batchSize}: actual=TX_FAILED estimate=${estimatedGas}${flag}`);
            }
        });
    }
});
