import { bytesToHex, getAddress, getContract, hexToBytes, padHex, toHex, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import type {
    BurnAccount, BurnAccountImportable, U8AsHex, U8sAsHexArrLen32, U8sAsHexArrLen64, TransWarpToken,
    AnyBurnAccount, SyncedBurnAccount, DerivedBurnAccountImportable, UnknownBurnAccountImportable,
    DerivedBurnAccountRecoverable, UnknownBurnAccountRecoverable, FullViewKeyData, UnknownBurnAccount, ExportedViewKeyData,
    BurnAccountRecoverable,
    TranswarpContractConfig,
    BurnAccountSyncData,
    BurnAccountSyncFields,
} from "./types.ts";
import type { BurnViewKeyManager } from "./BurnViewKeyManager.ts";
import { FIELD_MODULUS, VIEWING_KEY_SIG_MESSAGE } from "./constants.ts";
import { DerivedBurnAccountImportableSchema, DerivedBurnAccountRecoverableSchema, EMPTY_SYNC_FIELDS, isDerivedBurnAccount, UnknownBurnAccountImportableSchema, UnknownBurnAccountRecoverableSchema, type BurnAccountStorage } from "./schemas.ts";
import TransWarpTokenArtifact from '../artifacts/contracts/TransWarpToken.sol/TransWarpToken.json' with {"type": "json"};
import type { TransWarpToken$Type } from "../artifacts/contracts/TransWarpToken.sol/artifacts.js"
import { viemAccountNotSetErr } from "./BurnWallet.ts";
export const transwarpTokenAbi = TransWarpTokenArtifact.abi as TransWarpToken$Type["abi"]
export function padWithRandomHex({ arr, len, hexSize, dir }: { arr: Hex[], len: number, hexSize: number, dir: 'left' | 'right' }): Hex[] {
    const padding = Array.from({ length: len - arr.length }, () =>
        bytesToHex(crypto.getRandomValues(new Uint8Array(hexSize)))
    )
    return dir === 'left' ? [...padding, ...arr] : [...arr, ...padding]
}

// get random value until it fits within field limit (rejection sampling)
export function randomBN254FieldElement(): bigint {
    while (true) {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        const val = bytes.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n);
        if (val < FIELD_MODULUS) return val;
    }
}

export function getAvailableThreads() {
    if (typeof navigator !== undefined && 'hardwareConcurrency' in navigator) {
        return navigator.hardwareConcurrency ?? 1;
    } else {
        // TODO naively assumes that it runs on node if not in browser!
        return (process as any).availableParallelism()
    }
}


export function padArray<T>({ arr, size, value, dir }: { arr: T[], size: number, value?: T, dir?: "left" | "right" }): T[] {
    if (arr.length > size) { throw new Array(`array is larger then target size. Array len: ${arr.length}, target len: ${size}`) }
    dir = dir ?? "right"
    if (value === undefined) {
        if (typeof arr[0] === 'string' && arr[0].startsWith('0x')) {
            value = "0x00" as T
        } else if (typeof arr[0] === "bigint") {
            value = 0n as T
        } else {//if (typeof arr[0] === "number") {
            value = 0 as T
        }
    }

    const padding = (new Array(size - arr.length)).fill(value)
    return dir === "left" ? [...padding, ...arr] : [...arr, ...padding]
}

// ------ type utils ------
export function hexToU8sAsHexArr(hex: Hex, len: number): U8AsHex[] {
    const unPadded = hexToByteArray(hex)
    const padded = padArray({ arr: unPadded, size: len, value: "0x00", dir: "left" })
    return padded as U8AsHex[]
}

export function hexToByteArray(hex: Hex): Hex[] {
    // Remove '0x' prefix and split into pairs of characters
    const hexWithoutPrefix = hex.slice(2)
    const bytes: Hex[] = []

    for (let i = 0; i < hexWithoutPrefix.length; i += 2) {
        bytes.push(`0x${hexWithoutPrefix.slice(i, i + 2)}` as Hex)
    }

    return bytes
}

export function hexToU8AsHexLen32(hex: Hex): U8sAsHexArrLen32 {
    const unPadded = [...hexToBytes(hex)].map((v) => toHex(v))
    return padArray({ size: 32, dir: "left", arr: unPadded }) as U8sAsHexArrLen32
}

export function hexToU8AsHexLen64(hex: Hex): U8sAsHexArrLen64 {
    const unPadded = [...hexToBytes(hex)].map((v) => toHex(v))
    return padArray({ size: 64, dir: "left", arr: unPadded }) as U8sAsHexArrLen64
}

// ------ wallet utils ------
// function filterBurnAccounts(
//     burnAccountsStorage: BurnAccountStorage, selectedDifficulties?: Hex[], selectedChainIds?: Hex[], ethAccounts?: Address[],tokenAddress?:Address, derivedBurnAccounts = true, unknownBurnAccounts = true, singleUseBurnAccounts = true): BurnAccount[] {
export function filterBurnAccounts(
    burnAccountsStorage: BurnAccountStorage,
    { difficulties, chainIds, ethAccounts, tokenAddresses, derivedAccounts = true, unknownAccounts = true, singleUseAccounts = true }:
        { tokenAddresses?: Address[], difficulties?: bigint[], chainIds?: bigint[], ethAccounts?: Address[], derivedAccounts?: boolean, unknownAccounts?: boolean, singleUseAccounts?: boolean } = {}
): BurnAccount[] {
    ethAccounts = ethAccounts ?
        // format
        ethAccounts.map((a) => getAddress(a)) :
        // select all
        Object.keys(burnAccountsStorage).map((a) => getAddress(a as Address))

    const difficultiesHex = difficulties ?
        // format
        difficulties.map((diff) => toHex(diff, { size: 32 })) :
        // select all
        ethAccounts.flatMap((ethAccAddr) =>
            Object.keys(burnAccountsStorage[ethAccAddr].burnAccounts).flatMap(
                (chainId) => Object.keys(burnAccountsStorage[ethAccAddr].burnAccounts[chainId])
            )
        ) as Hex[];

    const chainIdsHex = chainIds ?
        // format
        chainIds.map((chainId) => toHex(chainId)) :
        // select all
        ethAccounts.flatMap((addr) => Object.keys(burnAccountsStorage[addr].burnAccounts)) as Hex[];

    tokenAddresses = tokenAddresses ?
        // format
        tokenAddresses.map((a) => getAddress(a)) :
        // select all (done inside for loop since you need to do 3 keys until you can do Object.key(), cant use flatMap )
        undefined;

    let burnAccounts: BurnAccount[] = []
    for (const ethAccount of ethAccounts) {
        for (const chainId of chainIdsHex) {
            if (burnAccountsStorage[ethAccount].burnAccounts[chainId]) {
                for (const difficulty of difficultiesHex) {
                    const burnAccountsObj = burnAccountsStorage[ethAccount].burnAccounts[chainId][difficulty]
                    if (burnAccountsObj) {
                        if (derivedAccounts) {
                            burnAccounts = [...burnAccounts, ...burnAccountsObj.derivedBurnAccounts]
                        }
                        if (singleUseAccounts && burnAccountsObj.singleUseBurnAccounts !== undefined) {
                            const currentTokenAddresses = tokenAddresses ? tokenAddresses : Object.keys(burnAccountsObj.singleUseBurnAccounts)
                            for (const tokenAddress of currentTokenAddresses) {
                                if (burnAccountsObj.singleUseBurnAccounts[tokenAddress]) {
                                    burnAccounts = [...burnAccounts, ...burnAccountsObj.singleUseBurnAccounts[tokenAddress]]
                                }
                            }
                        }
                        if (unknownAccounts) {
                            burnAccounts = [...burnAccounts, ...Object.values(burnAccountsObj.unknownBurnAccounts)] as UnknownBurnAccount[]
                        }
                    }
                }

            } else {
                console.warn(`burnAccountsStorage[ethAccount].burnAccounts[chainId] was undefined TODO figure out if that is bug? ethAccount:${ethAccount}, chainId:${chainId}`)
            }

        }
    }


    return burnAccounts.filter((ba) => ba !== undefined)
}


// TODO move this into BurnViewKeyManager
// it requires every function that requires a class as input, should just use `this` instead
export function getDeterministicBurnAccounts(
    burnWallet: BurnViewKeyManager, ethAccount: Address, chainId: number, difficulty: Hex
): BurnAccount[] {
    ethAccount = getAddress(ethAccount)
    const difficultyPadded = padHex(difficulty, { size: 32 })
    const chainIdHex = toHex(chainId)
    return burnWallet.privateData.burnAccounts[ethAccount].burnAccounts[chainIdHex][difficultyPadded].derivedBurnAccounts
}

export async function getCircuitSizesFromContract(address: Address, publicClient: PublicClient): Promise<number[]> {
    const base = { address, abi: transwarpTokenAbi } as const
    const [amountOfVerifiers] = await publicClient.multicall({
        contracts: [{ ...base, functionName: "AMOUNT_OF_VERIFIERS" }] as any,
        allowFailure: false,
    }) as [number]
    return await publicClient.multicall({
        contracts: Array.from({ length: amountOfVerifiers }, (_, index) => ({ ...base, functionName: "VERIFIER_SIZES", args: [BigInt(index)] as const })) as any,
        allowFailure: false,
    }) as number[]
}


export async function getAcceptedChainIdFromContract(address: Address, publicClient: PublicClient): Promise<readonly bigint[]> {
    return await publicClient.readContract({ address, abi: transwarpTokenAbi, functionName: "getAcceptedChainIds" })
}
export function getCircuitSize(amountBurnAddresses: number, circuitSizes: number[]) {
    return circuitSizes.find((v) => v >= amountBurnAddresses) as number
}

export function toImportableBurnAccount(account: SyncedBurnAccount): BurnAccountImportable {
    if (isDerivedBurnAccount(account)) {
        return DerivedBurnAccountImportableSchema.parse(account) as DerivedBurnAccountImportable;
    }
    return UnknownBurnAccountImportableSchema.parse(account) as UnknownBurnAccountImportable;
}

export function toImportableDerivedBurnAccount(account: BurnAccount): DerivedBurnAccountImportable {
    account.syncData ??= {}
    return DerivedBurnAccountImportableSchema.parse(account) as DerivedBurnAccountImportable;
}
export function toImportableUnknownBurnAccount(account: BurnAccount): UnknownBurnAccountImportable {
    account.syncData ??= {}
    return UnknownBurnAccountImportableSchema.parse(account) as UnknownBurnAccountImportable;
}

export function toRecoverableDerivedBurnAccount(account: BurnAccount): DerivedBurnAccountRecoverable {
    return DerivedBurnAccountRecoverableSchema.parse(account) as DerivedBurnAccountImportable;
}
export function toRecoverableUnknownBurnAccount(account: BurnAccount): UnknownBurnAccountImportable {
    return UnknownBurnAccountRecoverableSchema.parse(account) as UnknownBurnAccountImportable;
}

export function toRecoverableBurnAccount(account: AnyBurnAccount): BurnAccountRecoverable {
    if (isDerivedBurnAccount(account)) {
        return DerivedBurnAccountRecoverableSchema.parse(account) as DerivedBurnAccountRecoverable;
    }
    return UnknownBurnAccountRecoverableSchema.parse(account) as UnknownBurnAccountRecoverable;
}

export function BurnAccountToFlatArr(data: FullViewKeyData): BurnAccount[] {
    return Object.values(data.burnAccounts).flatMap(ethData =>
        Object.values(ethData.burnAccounts).flatMap(byChain =>
            Object.values(byChain).flatMap(({ derivedBurnAccounts, unknownBurnAccounts }) => [
                ...derivedBurnAccounts,
                ...Object.values(unknownBurnAccounts),
            ])
        )
    );
}

export function BurnAccountToFlatArrExportedData<T>(data: ExportedViewKeyData<T>): T[] {
    return Object.values(data.burnAccounts).flatMap(ethData =>
        Object.values(ethData.burnAccounts).flatMap(byChain =>
            Object.values(byChain).flatMap(({ derivedBurnAccounts, unknownBurnAccounts }) => [
                ...derivedBurnAccounts,
                ...Object.values(unknownBurnAccounts),
            ])
        )
    );
}


export function getTransWarpTokenContract(address: Address, client: { wallet: WalletClient, public: PublicClient }): TransWarpToken<{ wallet: WalletClient, public: PublicClient }>;
export function getTransWarpTokenContract(address: Address, client: { wallet: WalletClient }): TransWarpToken<{ wallet: WalletClient }>;
export function getTransWarpTokenContract(address: Address, client: { public: PublicClient }): TransWarpToken<{ public: PublicClient }>;
export function getTransWarpTokenContract(address: Address, client: { wallet?: WalletClient, public?: PublicClient }): TransWarpToken<any> {
    return getContract({
        address,
        abi: transwarpTokenAbi,
        client: client as { public: PublicClient; wallet: WalletClient },
    });
}

export async function checkNullifiers(nullifiers: bigint[], tokenAddress: Address, publicClient: PublicClient, blockNumber?: bigint): Promise<bigint[]> {
    return await publicClient.multicall({
        contracts: nullifiers.map((nullifier) => ({
            address: tokenAddress,
            abi: transwarpTokenAbi,
            functionName: "nullifiers" as const,
            args: [nullifier] as const,
        })),
        blockNumber,
        allowFailure: false,
    }) as bigint[]
}

export async function getTokenPriceInEth(token: Address, fullNode: PublicClient) {
    return false
}

export async function getContractConfig(address: Address, fullNode: PublicClient) {
    const base = { address, abi: transwarpTokenAbi } as const

    const [[
        powDifficulty, reMintLimit, maxTreeDepth, isCrossChain,
        decimalsTokenPrice, deploymentBlock, tokenDecimals, tokenName,
        tokenSymbol, amountFreeTokens, eip712Domain, acceptedChainIds,
    ], verifierSizeResults] = await Promise.all([
        fullNode.multicall({
            contracts: [
                { ...base, functionName: "POW_DIFFICULTY" },
                { ...base, functionName: "RE_MINT_LIMIT" },
                { ...base, functionName: "MAX_TREE_DEPTH" },
                { ...base, functionName: "IS_CROSS_CHAIN" },
                { ...base, functionName: "decimalsTokenPrice" },
                { ...base, functionName: "DEPLOYMENT_BLOCK" },
                { ...base, functionName: "decimals" },
                { ...base, functionName: "name" },
                { ...base, functionName: "symbol" },
                { ...base, functionName: "amountFreeTokens" },
                { ...base, functionName: "eip712Domain" },
                { ...base, functionName: "getAcceptedChainIds" },
            ] as any,
            allowFailure: false,
        }) as Promise<[Hex, Hex, number, boolean, bigint, bigint, number, string, string, bigint, readonly [bigint, string, string, string, bigint, string, readonly bigint[]], readonly bigint[]]>,
        getCircuitSizesFromContract(address, fullNode),
    ])

    const verifiersPerSizeResults = await fullNode.multicall({
        contracts: verifierSizeResults.map((size) => ({ ...base, functionName: "VERIFIERS_PER_SIZE", args: [size] as const })) as any,
        allowFailure: false,
    }) as Address[]

    const config: TranswarpContractConfig = {
        VERIFIER_SIZES: verifierSizeResults,
        VERIFIERS_PER_SIZE: Object.fromEntries(verifierSizeResults.map((size, index) => [size, verifiersPerSizeResults[index]])),
        POW_DIFFICULTY: padHex(powDifficulty, { size: 32 }),
        RE_MINT_LIMIT: reMintLimit,
        MAX_TREE_DEPTH: maxTreeDepth,
        IS_CROSS_CHAIN: isCrossChain,
        ACCEPTED_CHAIN_IDS: acceptedChainIds.map((id) => toHex(id)),
        EIP712_NAME: eip712Domain[1],
        EIP712_VERSION: eip712Domain[2],
        decimalsTokenPrice: toHex(decimalsTokenPrice),
        DEPLOYMENT_BLOCK: deploymentBlock,
        tokenDecimals: tokenDecimals,
        tokenName: tokenName,
        tokenSymbol: tokenSymbol,
        amountFreeTokens: amountFreeTokens,
    }

    return config
}


export async function signViewKeyMessage(wallet: WalletClient, ethAccount?: Address, message = VIEWING_KEY_SIG_MESSAGE) {
    if (wallet.account === undefined) throw new Error(viemAccountNotSetErr)
    ethAccount = wallet.account.address
    const signature = await wallet.signMessage({ message: message, account: ethAccount })
    return { signature, message }
}

export function getBurnState(account: SyncedBurnAccount, chainId: number, tokenAddress: Address): BurnAccountSyncFields {
    tokenAddress = getAddress(tokenAddress)
    const chainIdHex = toHex(chainId)
    return account.syncData[chainIdHex]?.[tokenAddress] ?? EMPTY_SYNC_FIELDS
}