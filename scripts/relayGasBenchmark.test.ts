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
import { getAddress, getContract, padHex, parseUnits, toHex, type Account, type Address, type Chain, type Client, type Hash, type Hex, type PublicClient, type WalletClient } from "viem";
import type { BurnAccount, FeeData, RelayInputs, SelfRelayInputs } from "../src/types.ts";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BurnWallet } from "../src/BurnWallet.ts";
import { GasReport } from "../test/utils/gasReport.ts";
import type { ContractReturnType, HardhatViemHelpers, KeyedClient } from "@nomicfoundation/hardhat-viem/types";
import { transwarpTokenAbi } from "../src/utils.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRE_MADE_BURN_ACCOUNTS = await readFile(
    join(__dirname, "../test/data/privateDataAlice.json"),
    { encoding: "utf-8" },
);

const AMOUNT_OF_BURN_ACCOUNTS = 2;
const PROVING_THREADS = 1;
const DECIMALS_TOKEN_PRICE = 8;

// @notice needs to be an multiple of the first 
const TARGET_DEPTHS = [3, 6, 10, 30];

type RelayType = "selfRelay" | "relayRefundSeparate" | "relayRefundSameAsRecipient";
const CIRCUIT_SIZES = [3, 32, 100];
const RELAY_TYPES: RelayType[] = ["selfRelay", "relayRefundSeparate", "relayRefundSameAsRecipient"];

describe("Relay gas benchmark", async function () {
    const { viem, networkHelpers } = await network.connect();
    const cleanState = await networkHelpers.takeSnapshot()
    const publicClient = (await viem.getPublicClient()) as PublicClient;
    const [deployer, alice, bob, , relayer] = await viem.getWalletClients();

    let transwarpToken: ContractReturnType<typeof TransWarpTokenContractName>;
    let verifiersBySize: Record<number, { address: `0x${string}`; abi: any }>;

    const gasReport = new GasReport("relay gas benchmark");
    // treeDepth -> circuitSize -> txType -> gas (written to JSON at end)
    const benchmarkData: Record<number, Record<number, Record<string, number>>> = {};

    // Per-circuitSize snapshot taken AFTER burns. Outer-looped by circuitSize so we
    // never `cleanState.restore()` between two restores of the same snapshot
    // (which would invalidate it via Hardhat's evm_revert semantics).
    type PostBurnSetup = {
        snapshot: Awaited<ReturnType<typeof networkHelpers.takeSnapshot>>;
        transwarpToken: ContractReturnType<typeof TransWarpTokenContractName>;
        verifiersBySize: Record<number, { address: `0x${string}`; abi: any }>;
        burnAddresses: Address[];
        treeDepthBeforeBurns: bigint;
        burnGases: bigint[];
    };
    let postBurn: PostBurnSetup | null = null;

    after(async function () {
        await writeFile(
            join(__dirname, "../test/data/relayGasBenchmark.json"),
            JSON.stringify(benchmarkData, null, 2),
        );
        gasReport.print();
        if (PROVING_THREADS !== 1) process.exit(0);
    });

    const chainId = await publicClient.getChainId();

    for (const circuitSize of CIRCUIT_SIZES) {
        // Reset the per-size cache when we move to a new circuitSize. The first
        // test in this group will repopulate it from a clean chain.
        postBurn = null;
        for (const targetDepth of TARGET_DEPTHS) {
            for (const relayType of RELAY_TYPES) {
                it(`${relayType} (circuit size ${circuitSize}, target depth ${targetDepth})`, async function () {
                    // Always create a fresh BurnWallet — the shared one accumulates
                    // syncData across iterations that doesn't get rolled back when
                    // we revert the chain via snapshot.restore().
                    const aliceBurnWallet = new BurnWallet(alice, {
                        archiveNodes: { [chainId]: publicClient },
                        acceptedChainIds: [chainId],
                    });

                    let aliceBurnAccounts: BurnAccount[];
                    let treeDepthBeforeBurns: bigint;
                    let burnGases: bigint[];

                    if (postBurn) {
                        await postBurn.snapshot.restore();
                        transwarpToken = postBurn.transwarpToken;
                        verifiersBySize = postBurn.verifiersBySize;
                        treeDepthBeforeBurns = postBurn.treeDepthBeforeBurns;
                        burnGases = postBurn.burnGases;
                        await aliceBurnWallet.importWallet(PRE_MADE_BURN_ACCOUNTS, transwarpToken.address);
                        aliceBurnAccounts = await aliceBurnWallet.createBurnAccountsBulk(
                            transwarpToken.address, AMOUNT_OF_BURN_ACCOUNTS, { startingViewKeyIndex: 1 },
                        );
                    } else {
                        await cleanState.restore();
                        const out = await deployTransWarpTest(publicClient, deployer, viem);
                        verifiersBySize = out.verifiersBySize;
                        transwarpToken = out.transwarpToken;

                        await aliceBurnWallet.importWallet(PRE_MADE_BURN_ACCOUNTS, transwarpToken.address);

                        const transwarpTokenAlice = getContract({
                            client: { public: publicClient, wallet: alice },
                            abi: transwarpToken.abi,
                            address: transwarpToken.address,
                        });
                        aliceBurnAccounts = await aliceBurnWallet.createBurnAccountsBulk(
                            transwarpToken.address, AMOUNT_OF_BURN_ACCOUNTS, { startingViewKeyIndex: 1 },
                        );
                        treeDepthBeforeBurns = (await transwarpToken.read.tree())[1];

                        await transwarpTokenAlice.write.getFreeTokens([alice.account.address]);
                        await fillTreeToDepth(targetDepth, transwarpTokenAlice);

                        const decimalsTokenSetup = await transwarpToken.read.decimals();
                        const reMintAmountSetup = 420n * 10n ** 18n;
                        const maxFeeSetup = parseUnits("5", decimalsTokenSetup);
                        const totalBurnAmountSetup = reMintAmountSetup + maxFeeSetup;

                        burnGases = [];
                        for (const aliceBurnAccount of aliceBurnAccounts) {
                            const burnTx = await aliceBurnWallet.superSafeBurn(
                                transwarpToken.address,
                                totalBurnAmountSetup / BigInt(AMOUNT_OF_BURN_ACCOUNTS) + 1n,
                                aliceBurnAccount,
                            );
                            const burnGas = await gasReport.recordTx(`burn (size ${circuitSize}, depth ${treeDepthBeforeBurns})`, burnTx, publicClient);
                            burnGases.push(burnGas);
                        }

                        postBurn = {
                            snapshot: await networkHelpers.takeSnapshot(),
                            transwarpToken,
                            verifiersBySize,
                            burnAddresses: aliceBurnAccounts.map((b) => b.burnAddress),
                            treeDepthBeforeBurns,
                            burnGases,
                        };
                    }

                    for (const burnGas of burnGases) {
                        record(benchmarkData, targetDepth, circuitSize, "burn", burnGas);
                    }

                    const decimalsToken = await transwarpToken.read.decimals();
                    const reMintAmount = 420n * 10n ** 18n;
                    const maxFee = parseUnits("5", decimalsToken);
                    const totalBurnAmount = reMintAmount + maxFee;
                    const treeDepth = (await transwarpToken.read.tree())[1];

                    const proofInputs = await getCachedRealProof(publicClient, aliceBurnWallet, aliceBurnAccounts, relayer, bob, transwarpToken.address, circuitSize, relayType, maxFee, reMintAmount, decimalsToken, totalBurnAmount)

                    let txHash: Hash;
                    if (relayType === "selfRelay") {
                        txHash = await aliceBurnWallet.selfRelayTx(proofInputs as SelfRelayInputs);
                    } else {
                        txHash = await relayTx(proofInputs as RelayInputs, relayer);
                    }

                    const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
                    gasReport.record(`reMint ${relayType} (size ${circuitSize}, depth ${treeDepth})`, receipt.gasUsed);
                    record(benchmarkData, targetDepth, circuitSize, relayType, receipt.gasUsed);
                    //-----------------

                    // Seed wallet fakeProofs from module-level cache so the fake proof isn't
                    // regenerated on every test (BurnWallet instance is fresh per test).
                    const normTokenAddr = getAddress(transwarpToken.address) as Address;
                    aliceBurnWallet.fakeProofs[chainId] ??= {};
                    aliceBurnWallet.fakeProofs[chainId][normTokenAddr] ??= {};
                    if (fakeProofCache[circuitSize]?.[relayType] !== undefined) {
                        (aliceBurnWallet.fakeProofs[chainId][normTokenAddr][circuitSize] ??= {})[relayType] =
                            fakeProofCache[circuitSize][relayType]!;
                    }

                    const estimatedGas = await aliceBurnWallet.estimateGas(transwarpToken.address, relayType, circuitSize);

                    // Persist the just-generated fake proof to the module-level cache so
                    // the next test's fresh wallet can reuse it without re-generating.
                    fakeProofCache[circuitSize] ??= {};
                    fakeProofCache[circuitSize][relayType] ??= aliceBurnWallet.fakeProofs[chainId]?.[normTokenAddr]?.[circuitSize]?.[relayType];

                    gasReport.record(`estimate ${relayType} (size ${circuitSize})`, estimatedGas);
                    record(benchmarkData, targetDepth, circuitSize, `${relayType}Estimate`, estimatedGas);
                    const diff = receipt.gasUsed - estimatedGas;
                    const ratio = (Number(estimatedGas) / Number(receipt.gasUsed)).toFixed(3);
                    console.log(`  estimate (${relayType}, size ${circuitSize}, depth ${treeDepth}): actual=${receipt.gasUsed} estimate=${estimatedGas} ratio=${ratio}`);
                    record(benchmarkData, targetDepth, circuitSize, `${relayType}EstimateDiff`, diff);
                    record(benchmarkData, targetDepth, circuitSize, `${relayType}EstimateRatioMilli`, BigInt(Math.round(Number(estimatedGas) * 1000 / Number(receipt.gasUsed))));

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
        const recipients = Array.from({ length: FILL_BATCH_SIZE }, (_, i) =>
            toHex(BigInt(sent + i + 1), { size: 20 }) as Address
        );
        await (tokenAlice as any).write.transferBulk([recipients, Array<bigint>(FILL_BATCH_SIZE).fill(1n)]);
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

export async function deployTransWarpTest(publicClient: PublicClient, deployer: WalletClient, viem: HardhatViemHelpers<"generic">) {
    const poseidon2Create2Salt = padHex("0x00", { size: 32 });
    await deployPoseidon2Huff(publicClient, deployer, poseidon2Create2Salt);
    const leanIMTPoseidon2 = await viem.deployContract(leanIMTPoseidon2ContractName, [], { libraries: {} });
    const ZKTranscriptLib = await viem.deployContract(ZKTranscriptLibContractName100, [], { libraries: {} });
    const reMintVerifier3 = await viem.deployContract(reMint3InVerifierContractName, [], {
        client: { wallet: deployer } as KeyedClient,
        libraries: { ZKTranscriptLib: ZKTranscriptLib.address },
    });
    const reMintVerifier32 = await viem.deployContract(reMint32InVerifierContractName, [], {
        client: { wallet: deployer } as KeyedClient,
        libraries: { ZKTranscriptLib: ZKTranscriptLib.address },
    });
    const reMintVerifier100 = await viem.deployContract(reMint100InVerifierContractName, [], {
        client: { wallet: deployer } as KeyedClient,
        libraries: { ZKTranscriptLib: ZKTranscriptLib.address },
    });
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
            [
                { contractAddress: reMintVerifier3.address, size: 3 },
                { contractAddress: reMintVerifier32.address, size: 32 },
                { contractAddress: reMintVerifier100.address, size: 100 },
            ],
            [],
        ],
        { client: { wallet: deployer } as KeyedClient, libraries: { leanIMTPoseidon2: leanIMTPoseidon2.address } },
    );
    const verifiersBySize = {
        3: { address: reMintVerifier3.address, abi: reMintVerifier3.abi },
        32: { address: reMintVerifier32.address, abi: reMintVerifier32.abi },
        100: { address: reMintVerifier100.address, abi: reMintVerifier100.abi },
    };
    return { transwarpToken, verifiersBySize }
}

const realProofCache: Record<number,Record<RelayType, RelayInputs | SelfRelayInputs>> = {}
const fakeProofCache: Record<number, Partial<Record<RelayType, SelfRelayInputs | RelayInputs>>> = {};
async function getCachedRealProof(
    publicClient: PublicClient, aliceBurnWallet: BurnWallet, aliceBurnAccounts: BurnAccount[],
    relayer: WalletClient & { account: Account },
    bob: WalletClient & { account: Account },
    transwarpTokenAddress: Address,
    circuitSize: number, relayType: RelayType,

    maxFee: bigint, reMintAmount: bigint, decimalsToken: number,
    totalBurnAmount: bigint,

) {
    if (realProofCache[circuitSize] && realProofCache[circuitSize][relayType]) {
        return realProofCache[circuitSize][relayType]
    } else {
        console.log(`   no cache for circuitSize: ${circuitSize} and relayType: ${relayType}`)
        const { syncedTree: syncedTreeProm, syncedBurnAccounts: syncedBurnAccountsProm } = aliceBurnWallet.sync(transwarpTokenAddress);
        await syncedBurnAccountsProm;

        const selection = await aliceBurnWallet.selectBurnAccountsForSpend(
            transwarpTokenAddress, totalBurnAmount, {
            burnAddresses: aliceBurnAccounts.map((b) => b.burnAddress),
            circuitSize,
        },
        );

        const recipient = bob.account.address;

        let feeData: FeeData | undefined;
        if (relayType !== "selfRelay") {
            feeData = await buildFeeData(aliceBurnWallet, transwarpTokenAddress, recipient, relayType, relayer.account.address, maxFee, reMintAmount, decimalsToken, publicClient);
        }

        const signed = await aliceBurnWallet.signReMint(recipient, selection, { feeData, circuitSize });
        await syncedTreeProm;
        const proofInputs = await aliceBurnWallet.proof(signed, { threads: PROVING_THREADS, feeData, circuitSize });
        realProofCache[circuitSize] ??= {} as Record<RelayType, RelayInputs | SelfRelayInputs>;
        realProofCache[circuitSize][relayType] = proofInputs
        return proofInputs
    }
}