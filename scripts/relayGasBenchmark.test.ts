import { beforeEach, describe, it, after } from "node:test";

import { network } from "hardhat";
import { deployPoseidon2Huff } from "@warptoad/gigabridge-js";

import {
    TransWarpTokenContractName,
    reMint3InVerifierContractName,
    reMint32InVerifierContractName,
    reMint100InVerifierContractName,
    leanIMTPoseidon2ContractName,
    ZKTranscriptLibContractName100,
    POW_DIFFICULTY,
    RE_MINT_LIMIT,
    MAX_TREE_DEPTH,
} from "../src/constants.ts";
import { relayTx } from "../src/transact.ts";
import { getContract, padHex, parseUnits, toHex, type Address, type Hash, type Hex, type PublicClient } from "viem";
import type { FeeData, RelayInputs, SelfRelayInputs } from "../src/types.ts";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BurnWallet } from "../src/BurnWallet.ts";
import { GasReport } from "../test/utils/gasReport.ts";
import type { ContractReturnType } from "@nomicfoundation/hardhat-viem/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRE_MADE_BURN_ACCOUNTS = await readFile(
    join(__dirname, "../test/data/privateDataAlice.json"),
    { encoding: "utf-8" },
);

const AMOUNT_OF_BURN_ACCOUNTS = 2;
const PROVING_THREADS = 1;
const DECIMALS_TOKEN_PRICE = 8;

const TARGET_DEPTHS = [3, 6, 10];

type RelayType = "selfRelay" | "relayRefundSeparate" | "relayRefundSameAsRecipient";
const CIRCUIT_SIZES = [3, 32, 100];
const RELAY_TYPES: RelayType[] = ["selfRelay", "relayRefundSeparate", "relayRefundSameAsRecipient"];

describe("Relay gas benchmark", async function () {
    const { viem } = await network.connect();
    const publicClient = (await viem.getPublicClient()) as PublicClient;
    const [deployer, alice, bob, , relayer] = await viem.getWalletClients();

    let transwarpToken: ContractReturnType<typeof TransWarpTokenContractName>;
    let verifiersBySize: Record<number, { address: `0x${string}`; abi: any }>;

    const gasReport = new GasReport("relay gas benchmark");
    // treeDepth -> circuitSize -> txType -> gas (written to JSON at end)
    const benchmarkData: Record<number, Record<number, Record<string, number>>> = {};

    beforeEach(async function () {
        const poseidon2Create2Salt = padHex("0x00", { size: 32 });
        await deployPoseidon2Huff(publicClient, deployer, poseidon2Create2Salt);
        const leanIMTPoseidon2 = await viem.deployContract(leanIMTPoseidon2ContractName, [], { libraries: {} });
        const ZKTranscriptLib = await viem.deployContract(ZKTranscriptLibContractName100, [], { libraries: {} });
        const reMintVerifier3 = await viem.deployContract(reMint3InVerifierContractName, [], {
            client: { wallet: deployer },
            libraries: { ZKTranscriptLib: ZKTranscriptLib.address },
        });
        const reMintVerifier32 = await viem.deployContract(reMint32InVerifierContractName, [], {
            client: { wallet: deployer },
            libraries: { ZKTranscriptLib: ZKTranscriptLib.address },
        });
        const reMintVerifier100 = await viem.deployContract(reMint100InVerifierContractName, [], {
            client: { wallet: deployer },
            libraries: { ZKTranscriptLib: ZKTranscriptLib.address },
        });
        transwarpToken = await viem.deployContract(
            TransWarpTokenContractName,
            [
                toHex(POW_DIFFICULTY, { size: 32 }),
                RE_MINT_LIMIT,
                MAX_TREE_DEPTH,
                false,
                "TWRP",
                "zkTransWarpTestToken",
                "1",
                [
                    { contractAddress: reMintVerifier3.address, size: 3 },
                    { contractAddress: reMintVerifier32.address, size: 32 },
                    { contractAddress: reMintVerifier100.address, size: 100 },
                ],
                [],
            ],
            { client: { wallet: deployer }, libraries: { leanIMTPoseidon2: leanIMTPoseidon2.address } },
        );
        verifiersBySize = {
            3: { address: reMintVerifier3.address, abi: reMintVerifier3.abi },
            32: { address: reMintVerifier32.address, abi: reMintVerifier32.abi },
            100: { address: reMintVerifier100.address, abi: reMintVerifier100.abi },
        };
    });

    after(async function () {
        await writeFile(
            join(__dirname, "../test/data/relayGasBenchmark.json"),
            JSON.stringify(benchmarkData, null, 2),
        );
        gasReport.print();
        if (PROVING_THREADS !== 1) process.exit(0);
    });

    for (const targetDepth of TARGET_DEPTHS) {
        for (const circuitSize of CIRCUIT_SIZES) {
            for (const relayType of RELAY_TYPES) {
                it(`${relayType} (circuit size ${circuitSize}, target depth ${targetDepth})`, async function () {
                    const chainId = await publicClient.getChainId();
                    const aliceBurnWallet = new BurnWallet(alice, {
                        archiveNodes: { [chainId]: publicClient },
                        acceptedChainIds: [chainId],
                    });

                    const transwarpTokenAlice = getContract({
                        client: { public: publicClient, wallet: alice },
                        abi: transwarpToken.abi,
                        address: transwarpToken.address,
                    });
                    const decimalsToken = await transwarpToken.read.decimals();

                    await transwarpTokenAlice.write.getFreeTokens([alice.account.address]);

                    await fillTreeToDepth(targetDepth, transwarpTokenAlice);

                    await aliceBurnWallet.importWallet(PRE_MADE_BURN_ACCOUNTS, transwarpToken.address);
                    const aliceBurnAccounts = await aliceBurnWallet.createBurnAccountsBulk(
                        transwarpToken.address, AMOUNT_OF_BURN_ACCOUNTS, { startingViewKeyIndex: 1 },
                    );

                    const reMintAmount = 420n * 10n ** 18n;
                    const maxFee = parseUnits("5", decimalsToken);
                    const totalBurnAmount = reMintAmount + maxFee;

                    const treeDepthBeforeBurns = (await transwarpToken.read.tree())[1];

                    for (const aliceBurnAccount of aliceBurnAccounts) {
                        const burnTx = await aliceBurnWallet.superSafeBurn(
                            transwarpToken.address,
                            totalBurnAmount / BigInt(AMOUNT_OF_BURN_ACCOUNTS) + 1n,
                            aliceBurnAccount,
                        );
                        const burnGas = await gasReport.recordTx(`burn (size ${circuitSize}, depth ${treeDepthBeforeBurns})`, burnTx, publicClient);
                        record(benchmarkData, targetDepth, circuitSize, "burn", burnGas);
                    }

                    const { syncedTree: syncedTreeProm, syncedBurnAccounts: syncedBurnAccountsProm } =
                        aliceBurnWallet.sync(transwarpToken.address);
                    await syncedBurnAccountsProm;

                    const selection = await aliceBurnWallet.selectBurnAccountsForSpend(
                        transwarpToken.address, totalBurnAmount, {
                            burnAddresses: aliceBurnAccounts.map((b) => b.burnAddress),
                            circuitSize,
                        },
                    );

                    const recipient = bob.account.address;
                    const treeDepth = (await transwarpToken.read.tree())[1];

                    let feeData: FeeData | undefined;
                    if (relayType !== "selfRelay") {
                        feeData = await buildFeeData(aliceBurnWallet, transwarpToken.address, recipient, relayType, relayer.account.address, maxFee, reMintAmount, decimalsToken, publicClient);
                    }

                    const signed = await aliceBurnWallet.signReMint(recipient, selection, { feeData, circuitSize });
                    await syncedTreeProm;
                    const proofInputs = await aliceBurnWallet.proof(signed, { threads: PROVING_THREADS, feeData, circuitSize });

                    let txHash: Hash;
                    if (relayType === "selfRelay") {
                        txHash = await aliceBurnWallet.selfRelayTx(proofInputs as SelfRelayInputs);
                    } else {
                        txHash = await relayTx(proofInputs as RelayInputs, relayer);
                    }

                    const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
                    gasReport.record(`reMint ${relayType} (size ${circuitSize}, depth ${treeDepth})`, receipt.gasUsed);
                    record(benchmarkData, targetDepth, circuitSize, relayType, receipt.gasUsed);

                    const estimatedGas = await aliceBurnWallet.estimateGas(transwarpToken.address, relayType);
                    gasReport.record(`estimate ${relayType} (size ${circuitSize})`, estimatedGas);
                    record(benchmarkData, targetDepth, circuitSize, `${relayType}Estimate`, estimatedGas);
                    const diff = receipt.gasUsed - estimatedGas;
                    const diffPct = (Number(diff) * 100 / Number(receipt.gasUsed)).toFixed(1);
                    console.log(`  estimate diff (${relayType}, size ${circuitSize}, depth ${treeDepth}): ${diff > 0n ? "+" : ""}${diff} gas (${diffPct}%)`);
                    record(benchmarkData, targetDepth, circuitSize, `${relayType}EstimateDiff`, diff);

                    const verifyGas = await estimateVerifierGas(circuitSize, proofInputs, transwarpToken, publicClient, deployer, verifiersBySize);
                    gasReport.record(`verify only (size ${circuitSize})`, verifyGas);
                    record(benchmarkData, targetDepth, circuitSize, "verifyOnly", verifyGas);
                });
            }
        }
    }
});

// Fills the tree to at least `targetDepth` by transferring 1 wei to deterministic addresses.
// transferBulk calls _updateBalanceInMerkleTree(recipients, ...) which batch-inserts all leaves
// in one leanIMT._insertMany call — much cheaper than individual inserts.
// leanIMT reaches depth D when size > 2^(D-1), so minimum targetSize = 2^(D-1) + 1.
function record(
    data: Record<number, Record<number, Record<string, number>>>,
    targetDepth: number,
    circuitSize: number,
    txType: string,
    gas: bigint,
): void {
    data[targetDepth] ??= {};
    data[targetDepth][circuitSize] ??= {};
    data[targetDepth][circuitSize][txType] = Number(gas);
}

const FILL_BATCH_SIZE = 50;

async function fillTreeToDepth(
    targetDepth: number,
    tokenAlice: ReturnType<typeof getContract>,
): Promise<void> {
    const currentSize = Number(await (tokenAlice as any).read.treeSize());
    const targetSize = (1 << (targetDepth - 1)) + 1;
    const needed = targetSize - currentSize;
    if (needed <= 0) return;

    for (let sent = 0; sent < needed; sent += FILL_BATCH_SIZE) {
        const batchSize = Math.min(FILL_BATCH_SIZE, needed - sent);
        const recipients = Array.from({ length: batchSize }, (_, i) =>
            toHex(BigInt(sent + i + 1), { size: 20 }) as Address
        );
        await (tokenAlice as any).write.transferBulk([recipients, Array<bigint>(batchSize).fill(1n)]);
    }
}

async function buildFeeData(
    aliceBurnWallet: BurnWallet,
    tokenAddress: Address,
    recipient: Address,
    relayType: RelayType,
    relayerAddress: Address,
    maxFee: bigint,
    reMintAmount: bigint,
    decimalsToken: number,
    publicClient: PublicClient,
): Promise<FeeData> {
    const refundAddress = relayType === "relayRefundSameAsRecipient"
        ? recipient
        : (await aliceBurnWallet.createSingleUseBurnAccount(tokenAddress)).burnAddress;

    return {
        tokensPerEthPrice: toHex(parseUnits("69", DECIMALS_TOKEN_PRICE)),
        maxFee: toHex(maxFee),
        amountForRecipient: toHex(reMintAmount),
        relayerBonus: toHex(parseUnits("1", decimalsToken)),
        estimatedGasCost: toHex(3_092_125n),
        estimatedPriorityFee: toHex(await publicClient.estimateMaxPriorityFeePerGas()),
        refundAddress,
        relayerAddress,
    };
}

async function estimateVerifierGas(
    circuitSize: number,
    proofInputs: SelfRelayInputs | RelayInputs,
    transwarpToken: ContractReturnType<typeof TransWarpTokenContractName>,
    publicClient: PublicClient,
    deployer: any,
    verifiersBySize: Record<number, { address: `0x${string}`; abi: any }>,
): Promise<bigint> {
    const { publicInputs: pubIn, signatureInputs: sigIn, proof } = proofInputs;
    const totalMintedLeafs = pubIn.burn_data_public.map((v) => BigInt(v.total_minted_leaf));
    const nullifiers = pubIn.burn_data_public.map((v) => BigInt(v.nullifier));
    const root = BigInt(pubIn.root);
    const chainId = BigInt(pubIn.chain_id);
    const amount = BigInt(sigIn.amountToReMint);

    const sigInputsForHash = {
        amountToReMint: amount,
        recipient: sigIn.recipient,
        callData: sigIn.callData,
        encryptedTotalMinted: sigIn.encryptedTotalMinted,
        callCanFail: sigIn.callCanFail,
        callValue: BigInt(sigIn.callValue),
    };

    let signatureHash: Hex;
    if ("feeData" in sigIn) {
        const { feeData } = sigIn;
        signatureHash = await transwarpToken.read._hashSignatureInputsRelayer([
            sigInputsForHash,
            {
                tokensPerEthPrice: BigInt(feeData.tokensPerEthPrice),
                maxFee: BigInt(feeData.maxFee),
                amountForRecipient: BigInt(feeData.amountForRecipient),
                relayerBonus: BigInt(feeData.relayerBonus),
                estimatedGasCost: BigInt(feeData.estimatedGasCost),
                estimatedPriorityFee: BigInt(feeData.estimatedPriorityFee),
                refundAddress: feeData.refundAddress,
                relayerAddress: feeData.relayerAddress,
            },
        ]);
    } else {
        signatureHash = await transwarpToken.read._hashSignatureInputs([sigInputsForHash]);
    }

    const formattedPublicInputs = (await transwarpToken.read._formatPublicInputs([
        root, chainId, amount, signatureHash, totalMintedLeafs, nullifiers,
    ])) as readonly Hex[];

    const verifier = verifiersBySize[circuitSize];
    return await publicClient.estimateContractGas({
        address: verifier.address,
        abi: verifier.abi,
        functionName: "verify",
        args: [proof as Hex, formattedPublicInputs],
        account: deployer.account,
    });
}
