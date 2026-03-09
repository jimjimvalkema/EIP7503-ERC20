// PrivateWallet is a wrapper that exposes some of viem's WalletClient functions and requires them to only ever use one ethAccount

import type { Address, Hex, WalletClient } from "viem";
import { hashMessage, padHex, toHex } from "viem";
import type { BurnAccount, BurnAccountDet, PrivateWalletData, UnsyncedBurnAccountNonDet, UnsyncedBurnAccountDet } from "./types.ts"
import { extractPubKeyFromSig, findPoWNonce, findPoWNonceAsync, getBurnAddress, getViewingKey, hashBlindedAddressData, verifyPowNonce } from "./hashing.ts";
import { VIEWING_KEY_SIG_MESSAGE } from "./constants.ts";
import { poseidon2Hash } from "@zkpassport/poseidon2"
//import { findPoWNonceAsync } from "./hashingAsync.js";


/**
 * A class that wraps around a viem WalletClient to enable creation of burn accounts that all share the same pubKey.
 * This class stores all newly generated burn accounts in PrivateWallet.privateWalletData.
 *
 * Other methods like signPrivateTransfer, proofAndSelfRelay, etc. are outside the class and only consume it,
 * since those methods won't create things we need to store or cache (like pubKey, important data).
 * This is to avoid OOP as much as possible.
 * @TODO is that a good decision?
 * Pros: can change circuit and contract and keep PrivateWallet the same
 */
export class BurnWallet {
    readonly viemWallet: WalletClient
    readonly privateData: PrivateWalletData;

    readonly defaults: {
        acceptedChainIds: bigint[];
        chainId: bigint;
        powDifficulty: bigint;
    }

    /**
     * @param viemWallet
     * @param powDifficulty
     * @param options - Optional configuration object.
     * @param options.privateWalletData - Existing wallet data to import. If omitted, a fresh wallet is initialized.
     * @param options.viewKeySigMessage - Message used to derive the viewing key root. Defaults to {@link VIEWING_KEY_SIG_MESSAGE}.
     * @param options.acceptedChainIds - List of accepted chain IDs. Defaults to `[1n]`.
     * @param options.chainId - Default chain ID for operations. Inferred from `acceptedChainIds` if not provided.
     */
    constructor(
        viemWallet: WalletClient, powDifficulty: bigint,
        { privateWalletData, viewKeySigMessage = VIEWING_KEY_SIG_MESSAGE, acceptedChainIds = [1n], chainId }:
            { privateWalletData?: PrivateWalletData, viewKeySigMessage?: string, powDifficulty?: bigint, acceptedChainIds?: bigint[], chainId?: bigint } = {}
    ) {
        this.viemWallet = viemWallet
        // only one accepted chainId? thats default!
        // more? 1n is default, if it is accepted!
        // more then 1 acceptable chainIds but no mainnet, idk what what it should be then :/, throw error.
        if (chainId === undefined) {
            if (acceptedChainIds.length === 1) {
                chainId = acceptedChainIds[0]
            } else {
                if (acceptedChainIds.includes(1n)) {
                    chainId = 1n
                } else {
                    throw new Error(`chainId needs to be set. example: new PrivateWallet(viemWallet,{chainId:${Number(acceptedChainIds[0])},acceptedChainIds:[${acceptedChainIds.map((v => Number(v) + "n")).toString()}]})`)
                }
            }
        }

        this.defaults = {
            acceptedChainIds: acceptedChainIds,
            chainId: chainId,
            powDifficulty: powDifficulty
        }

        // init this.privateWalletData
        if (privateWalletData === undefined) {
            // set default
            this.privateData = {
                ethAccount: viemWallet.account?.address as Address,
                viewKeySigMessage: viewKeySigMessage,
                detBurnAccounts: {},
                nonDetBurnAccounts: {},
                detViewKeyCounter: 0,
            }
        } else {
            // check input
            if (viemWallet.account?.address !== privateWalletData.ethAccount) {
                throw new Error(`privateWallet import failed, expected eth account: ${privateWalletData.ethAccount} not connected`)
            }
            if (viewKeySigMessage !== privateWalletData.viewKeySigMessage) {
                throw new Error(`cant change viewKey message of a imported account`)
            }
            this.privateData = privateWalletData
        }
        this.#createBurnAccountsKeys({ chainId: chainId, difficulty: powDifficulty })
    }

    async #storePubKeyFromSig(hash: Hex, signature: Hex) {
        if (this.privateData.pubKey === undefined) {
            const { pubKeyX, pubKeyY } = await extractPubKeyFromSig({ hash, signature })
            this.privateData.pubKey = { x: pubKeyX, y: pubKeyY }
        }
    }

    #storeDetViewKeyRootFromSig(signature: Hex) {
        if (this.privateData.detViewKeyRoot === undefined) {
            this.privateData.detViewKeyRoot = toHex(getViewingKey({ signature: signature }));
            return this.privateData.detViewKeyRoot
        }
    }

    /**
     * @notice Prompts the user to sign a message if the deterministic view key root is not stored yet.
     * @returns The deterministic view key root.
     */
    async getDeterministicViewKeyRoot() {
        if (this.privateData.detViewKeyRoot) {
            return this.privateData.detViewKeyRoot as Hex
        } else {
            const signature = await this.viemWallet.signMessage({ message: this.privateData.viewKeySigMessage, account: this.privateData.ethAccount })
            const hash = hashMessage(this.privateData.viewKeySigMessage);
            await this.#storePubKeyFromSig(hash, signature)
            const detViewKeyRoot = this.#storeDetViewKeyRootFromSig(signature)
            return detViewKeyRoot as Hex
        }
    }

    /**
     * @notice Prompts the user to sign a message if the public key is not stored yet.
     * @returns The wallet's spending public key as `{ x, y }`.
     */
    async getPubKey(message = this.privateData.viewKeySigMessage) {
        if (this.privateData.pubKey === undefined) {
            const signature = await this.viemWallet.signMessage({ message: message, account: this.privateData.ethAccount })
            const hash = hashMessage(message);
            await this.#storePubKeyFromSig(hash, signature)
            this.#storeDetViewKeyRootFromSig(signature)
        }
        return this.privateData.pubKey as { x: Hex, y: Hex }
    }

    /**
     * Creates a new burn account by generating (or accepting) a viewing key,
     * deterministically finding a PoW nonce, and deriving the corresponding
     * burn address.
     *
     * By default, both the viewing key and PoW nonce are deterministically derived,
     * enabling account recovery from the internal root and counter. If either
     * `viewingKey` or `powNonce` is provided manually, recovery is no longer
     * deterministic losing either value means permanent loss of access to
     * associated funds.
     *
     * @param options - Optional configuration object.
     * @param options.viewingKey - A custom viewing key. If omitted, one is
     *   deterministically derived from the internal root and `viewingKeyIndex`.
     *   **Warning:** providing your own key bypasses deterministic recovery 
     *   loss of this value results in loss of funds.
     * @param options.viewingKeyIndex - Index used for deterministic viewing key
     *   derivation. Defaults to `this.privateData.detViewKeyCounter`, which is
     *   then incremented.
     * @param options.chainId - Target chain ID. Defaults to `this.defaults.chainId`.
     *   Must be in `this.acceptedChainIds`.
     * @param options.powNonce - A pre-computed proof-of-work nonce. If omitted,
     *   one is computed deterministically using the specified `difficulty`.
     *   **Warning:** providing your own nonce bypasses deterministic recovery 
     *   both the viewing key and nonce are required to recover an account;
     *   losing either results in loss of funds.
     * @param options.difficulty - PoW difficulty override. Defaults to
     *   `this.defaults.powDifficulty`.
     * @param options.async - If `true`, computes the PoW nonce on its own worker
     *   thread, avoiding UI freezes. Defaults to `false`.
     *
     * @returns The newly created {@link BurnAccount} (either {@link UnsyncedBurnAccountDet}
     *   or {@link UnsyncedBurnAccountNonDet} depending on whether custom inputs were provided),
     *   also appended to the appropriate burn accounts store.
     *
     * @throws {Error} If `chainId` is not in `this.acceptedChainIds`.
     * @throws {Error} If a provided `powNonce` fails verification.
     */
    async createBurnAccount(
        { powNonce, viewingKey, viewingKeyIndex, chainId = this.defaults.chainId, difficulty = this.defaults.powDifficulty, async = false }:
            { powNonce?: bigint, viewingKey?: bigint, viewingKeyIndex?: number, chainId?: bigint, difficulty?: bigint, async?: boolean } = {}
    ) {
        chainId ??= this.defaults.chainId
        const isDeterministic = powNonce === undefined && viewingKey === undefined;
        const { x: spendingPubKeyX } = await this.getPubKey()

        if (viewingKeyIndex === undefined) {
            viewingKeyIndex = this.privateData.detViewKeyCounter++
        }

        viewingKey ??= poseidon2Hash([
            BigInt(await this.getDeterministicViewKeyRoot()),
            BigInt(viewingKeyIndex)
        ])

        const blindedAddressDataHash = hashBlindedAddressData({ spendingPubKeyX, viewingKey: viewingKey as bigint, chainId: chainId })

        if (async) {
            powNonce ??= await findPoWNonceAsync({ blindedAddressDataHash, startingValue: viewingKey as bigint, difficulty: difficulty }) as bigint
        } else {
            powNonce ??= findPoWNonce({ blindedAddressDataHash, startingValue: viewingKey as bigint, difficulty: difficulty })
        }

        const burnAddress = getBurnAddress({ blindedAddressDataHash: blindedAddressDataHash, powNonce: powNonce })
        let burnAccount: UnsyncedBurnAccountNonDet = {
            viewingKey: toHex(viewingKey as bigint, { size: 32 }),
            powNonce: toHex(powNonce, { size: 32 }),
            burnAddress: burnAddress,
            chainId: toHex(chainId),
            blindedAddressDataHash: toHex(blindedAddressDataHash, { size: 32 }),
            spendingPubKeyX: spendingPubKeyX,
            difficulty: toHex(difficulty, { size: 32 }),
        }

        if (isDeterministic) {
            burnAccount = {
                ...burnAccount,
                ethAccount: this.privateData.ethAccount,
                viewKeySigMessage: this.privateData.viewKeySigMessage,
                viewingKeyIndex: viewingKeyIndex
            } as UnsyncedBurnAccountDet;
        }

        this.#addBurnAccount(burnAccount)

        return burnAccount
    }

    importBurnAccount(burnAccount: BurnAccount) {
        // TODO do checks
        this.#addBurnAccount(burnAccount)
    }

    #createBurnAccountsKeys({ chainId, difficulty }: { chainId: bigint, difficulty: bigint }) {
        const difficultyPadded = toHex(difficulty, { size: 32 })
        const chainIdPadded = toHex(chainId, { size: 32 })
        this.#createDetBurnAccountsKeysHex({ chainIdHex: chainIdPadded, difficultyHex: difficultyPadded })
        this.#createNonDetBurnAccountsKeysHex({ chainIdHex: chainIdPadded, difficultyHex: difficultyPadded })

    }

    #createDetBurnAccountsKeysHex({ chainIdHex, difficultyHex }: { chainIdHex: Hex, difficultyHex: Hex }) {
        this.privateData.detBurnAccounts[chainIdHex] ??= {};
        this.privateData.detBurnAccounts[chainIdHex][difficultyHex] ??= [];
    }

    #createNonDetBurnAccountsKeysHex({ chainIdHex, difficultyHex }: { chainIdHex: Hex, difficultyHex: Hex }) {
        this.privateData.nonDetBurnAccounts[chainIdHex] ??= {};
        this.privateData.nonDetBurnAccounts[chainIdHex][difficultyHex] ??= [];
    }

    #addBurnAccount(burnAccount: BurnAccount) {
        const difficultyPadded = padHex(burnAccount.difficulty, { size: 32 })
        const chainIdPadded = padHex(burnAccount.chainId, { size: 32 })
        if ("viewingKeyIndex" in burnAccount) {
            this.#createDetBurnAccountsKeysHex({ chainIdHex: chainIdPadded, difficultyHex: difficultyPadded })
            this.privateData.detBurnAccounts[chainIdPadded][difficultyPadded][burnAccount.viewingKeyIndex] = burnAccount
        } else {
            this.#createNonDetBurnAccountsKeysHex({ chainIdHex: chainIdPadded, difficultyHex: difficultyPadded })
            this.privateData.nonDetBurnAccounts[chainIdPadded][difficultyPadded].push(burnAccount)
        }
    }

    /**
     * Creates multiple burn accounts in bulk, deterministically deriving a PoW
     * nonce and burn address for each.
     *
     * @notice PoW nonces are found in parallel when `async: true`.
     *
     * @param amountOfBurnAccounts - Number of burn accounts to create.
     * @param options - Optional configuration object.
     * @param options.chainId - Target chain ID. Defaults to `this.defaults.chainId`.
     *   Must be in `this.acceptedChainIds`.
     * @param options.difficulty - PoW difficulty override. Defaults to
     *   `this.defaults.powDifficulty`.
     * @param options.async - If `true`, each account's PoW nonce is computed on
     *   its own worker thread, avoiding UI freezes. Defaults to `false`.
     *
     * @returns An array of newly created {@link BurnAccount} objects (either det or non-det
     *   depending on inputs), also appended to `this.privateData.detBurnAccounts`.
     *
     * @throws {Error} If `chainId` is not in `this.acceptedChainIds`.
     *
     * @TODO spawning one worker per account may be inefficient beyond available
     *   thread count  assumes most callers don't need large batches.
     */
    async createBurnAccountsBulk(amountOfBurnAccounts: number, { chainId, difficulty = this.defaults.powDifficulty, async = false }: { async?: boolean, chainId?: bigint, difficulty?: bigint } = {}) {
        chainId ??= this.defaults.chainId
        const burnAccountsPromises = new Array(amountOfBurnAccounts).fill(0).map((v, i) =>
            this.createBurnAccount(
                { viewingKeyIndex: this.privateData.detViewKeyCounter + i, chainId: chainId, difficulty: difficulty, async: async }
            )
        )

        const burnAccounts = await Promise.all(burnAccountsPromises)
        this.privateData.detViewKeyCounter += amountOfBurnAccounts;
        return burnAccounts
    }

}

function filterBurnAccounts(burnAccounts: Record<Hex, Record<Hex, BurnAccount[]>>, selectedDifficulties?: Hex[], selectedChainIds?: Hex[]): BurnAccount[] {
    selectedChainIds ??= Object.keys(burnAccounts) as Hex[];

    return selectedChainIds.flatMap(chainId => {
        const burnAccountsPerDiff = burnAccounts[chainId];
        if (!burnAccountsPerDiff) return [];

        // remember: can't use ??= here  it would assign on the first iteration and
        // carry over to all subsequent chainIds, ignoring their actual difficulties.
        const difficulties = selectedDifficulties ?? Object.keys(burnAccountsPerDiff) as Hex[];

        return difficulties.flatMap(difficulty => burnAccountsPerDiff[difficulty] ?? []);
    });
}

/**
 * 
 * Retrieves stored burn accounts, with optional filtering by chain ID, difficulty,
 * and account type.
 *
 * @param options - Optional filter configuration.
 * @param options.difficulties - If provided, only returns accounts matching these PoW difficulties.
 *   Defaults to all difficulties.
 * @param options.chainIds - If provided, only returns accounts matching these chain IDs.
 *   Defaults to all chain IDs.
 * @param options.deterministicAccounts - Whether to include deterministic accounts. Defaults to `true`.
 * @param options.nonDeterministicAccounts - Whether to include non-deterministic accounts. Defaults to `true`.
 *
 * @returns A flat array of matching {@link BurnAccount} objects.
 */
export function getAllBurnAccounts(privateData: PrivateWalletData,
    { difficulties, chainIds, deterministicAccounts = true, nonDeterministicAccounts = true }:
        { difficulties?: bigint[], chainIds?: bigint[], deterministicAccounts?: boolean, nonDeterministicAccounts?: boolean } = {}
): BurnAccount[] {
    const difficultiesHex = difficulties !== undefined ? difficulties.map((diff) => padHex(toHex(diff), { size: 32 })) : undefined;
    const chainIdsHex = chainIds !== undefined ? chainIds.map((chainId) => padHex(toHex(chainId), { size: 32 })) : undefined;

    return [
        ...(deterministicAccounts ? filterBurnAccounts(privateData.detBurnAccounts, difficultiesHex, chainIdsHex) : []),
        ...(nonDeterministicAccounts ? filterBurnAccounts(privateData.nonDetBurnAccounts, difficultiesHex, chainIdsHex) : []),
    ];
}

export function getDeterministicBurnAccounts(burnWallet: BurnWallet,
    { difficulty = burnWallet.defaults.powDifficulty, chainId = burnWallet.defaults.chainId }:
        { difficulty?: bigint, chainId?: bigint } = {}

): BurnAccount[] {
    const difficultyPadded = toHex(difficulty, { size: 32 })
    const chainIdPadded = toHex(chainId, { size: 32 })
    console.log({ burnAccounts: burnWallet.privateData.detBurnAccounts[chainIdPadded][difficultyPadded] })
    return burnWallet.privateData.detBurnAccounts[chainIdPadded][difficultyPadded]

}