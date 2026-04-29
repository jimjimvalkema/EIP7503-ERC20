// PrivateWallet is a wrapper that exposes some of viem's WalletClient functions and requires them to only ever use one ethAccount

import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { ethAddress, getAddress, hashMessage, padHex, recoverMessageAddress, toHex } from "viem";
import type { BurnAccount, UnsyncedBurnAccount, UnsyncedDerivedBurnAccount, UnsyncedSingleUseBurnAccount, UnsyncedUnknownBurnAccount, AnyBurnAccount, BurnAccountRecoverable, DerivedBurnAccountRecoverable, BurnAccountImportable, ExportedViewKeyData, FullViewKeyData, UnknownBurnAccountRecoverable, UnknownBurnAccountImportable, DerivedBurnAccountImportable } from "./types.ts"
import { findPoWNonce, findPoWNonceAsync, getBurnAddress, hashBlindedAddressData, hashPow, hashRegularViewingKey, hashSingleUseViewingKey, isValidPowNonce } from "./hashing.ts";
import { VIEWING_KEY_SIG_MESSAGE } from "./constants.ts";
import { BurnAccountToFlatArr, BurnAccountToFlatArrExportedData, getDeterministicBurnAccounts, getTransWarpTokenContract, signViewKeyMessage, toImportableBurnAccount, toImportableDerivedBurnAccount, toImportableUnknownBurnAccount, toRecoverableBurnAccount, toRecoverableDerivedBurnAccount, toRecoverableUnknownBurnAccount } from "./utils.ts";
import { extractPubKeyFromSig, getViewingKey } from "./signing.ts";
import { BurnAccountSyncFieldsSchema, identifyBurnAccount, isDerivedBurnAccount, isSyncedBurnAccount } from "./schemas.ts";
import { syncBurnAccount } from "./syncing.ts";
import pLimit from "p-limit";
import { viemAccountNotSetErr } from "./BurnWallet.ts";
//import { findPoWNonceAsync } from "./hashingAsync.js";

/**
 * A class that wraps around a viem WalletClient to enable creation of burn accounts that all share the same pubKey.
 * This class stores all newly generated burn accounts in PrivateWallet.viewKeyData.
 *
 * Other methods like signPrivateTransfer, proofAndSelfRelay, etc. are outside the class and only consume it,
 * since those methods won't create things we need to store or cache (like pubKey, important data).
 * This is to avoid OOP as much as possible.
 * @TODO is that a good decision?
 * Pros: can change circuit and contract and keep PrivateWallet the same
 * 
 * @TODO remove default. BurnWallet will do default behavior, this should only store burnAccounts
 * @TODO rename to burnAccountManager
 * @TODO make burnAccount sync data specific per chainId=>tokenAddress, right now we will have bugs when used with multiple tokens
 */
export class BurnViewKeyManager {
    viemWallet: WalletClient
    readonly privateData: FullViewKeyData;

    /**
     * @param viemWallet
     * @param powDifficulty
     * @param options - Optional configuration object.
     * @param options.viewKeyData - Existing wallet data to import. If omitted, a fresh wallet is initialized.
     * @param options.viewKeySigMessage - Message used to derive the viewing key root. Defaults to {@link VIEWING_KEY_SIG_MESSAGE}.
     * @param options.acceptedChainIds - List of accepted chain IDs. Defaults to `[1n]`.
     * @param options.chainId - Default chain ID for operations. Inferred from `acceptedChainIds` if not provided.
     */
    constructor(
        viemWallet: WalletClient,
        { viewKeyData, acceptedChainIds = [1], chainId, ethAddress }:
            { viewKeyData?: FullViewKeyData, viewKeySigMessage?: string, acceptedChainIds?: number[], chainId?: number, ethAddress?: Address } = {}
    ) {
        if (viemWallet.account === undefined) throw new Error(viemAccountNotSetErr)
        this.viemWallet = viemWallet
        ethAddress ??= viemWallet.account?.address ? viemWallet.account?.address : "0x0000000000000000000000000000000000000000" as Address
        // only one accepted chainId? thats default!
        // more? 1n is default, if it is accepted!
        // more then 1 acceptable chainIds but no mainnet, idk what what it should be then :/, throw error.
        if (chainId === undefined) {
            if (acceptedChainIds.length === 1) {
                chainId = acceptedChainIds[0]
            } else {
                if (acceptedChainIds.includes(1)) {
                    chainId = 1
                } else {
                    throw new Error(`chainId needs to be set. example: new PrivateWallet(viemWallet,{chainId:${Number(acceptedChainIds[0])},acceptedChainIds:[${acceptedChainIds.map((v => Number(v) + "n")).toString()}]})`)
                }
            }
        }

        // init this.viewKeyData
        if (viewKeyData === undefined) {
            // set default
            this.privateData = {
                burnAccounts: {}
            }
        } else {
            // check input
            this.privateData = structuredClone(viewKeyData)
        }
        //this.#createBurnAccountsKeys({ chainId: chainId, difficulty: powDifficulty, ethAccount: ethAddress })
    }

    // prompts user to sign to create viewing keys and also store pubKey of eth account
    async #connect(ethAccount: Address, message = VIEWING_KEY_SIG_MESSAGE) {
        ethAccount = getAddress(ethAccount)
        this.privateData.burnAccounts[ethAccount] ??= { detViewKeyRoot: undefined, pubKey: undefined, detViewKeyCounter: 0, singleUseViewKeyCounter: 0, burnAccounts: {} };
        if (this.privateData.burnAccounts[ethAccount].pubKey && this.privateData.burnAccounts[ethAccount].detViewKeyRoot) {
            return { viewKeyRoot: this.privateData.burnAccounts[ethAccount].detViewKeyRoot, pubKey: this.privateData.burnAccounts[ethAccount].pubKey }
        } else {
            const { signature } = await signViewKeyMessage(this.viemWallet, ethAccount, message)
            return this.#storeSignIn(signature, message, ethAccount)
        }
    }

    async #storeSignIn(signature: Hex, message: string, ethAccount: Address) {
        ethAccount = getAddress(ethAccount)
        const hash = hashMessage(message);
        const viewKeyRoot = toHex(getViewingKey({ signature: signature }));
        const { pubKeyX, pubKeyY } = await extractPubKeyFromSig({ hash, signature })

        this.privateData.burnAccounts[ethAccount].detViewKeyRoot = viewKeyRoot

        this.privateData.burnAccounts[ethAccount].pubKey = { x: pubKeyX, y: pubKeyY }
        return { viewKeyRoot, pubKey: this.privateData.burnAccounts[ethAccount] }
    }

    async connectPreSigned(wallet: WalletClient, signature: Hex, message: string) {
        if (wallet.account === undefined) throw new Error(viemAccountNotSetErr)
        const recovered = await recoverMessageAddress({ message, signature })
        const ethAccount = getAddress(wallet.account.address)
        if (getAddress(recovered) !== ethAccount) {
            throw new Error(`connectPreSigned: signature does not match ethAccount. Recovered ${recovered}, expected ${ethAccount}`)
        }
        this.viemWallet = wallet
        await this.#storeSignIn(signature, message, ethAccount)
    }

    // Called after signingEthAccount is already resolved and after the cache check.
    async #getSignerData(signingEthAccount: Address, viewKeyMessage: string, spendingPubKeyX: Hex | undefined) {
        return {
            spendingPubKeyX: spendingPubKeyX ?? (await this.getPubKey(signingEthAccount)).x,
            viewKeyRoot: BigInt(await this.getDeterministicViewKeyRoot(signingEthAccount, viewKeyMessage)),
        }
    }

    #nextViewingKeyIndex(signingEthAccount: Address, type: 'regular' | 'singleUse'): number {
        const burnAccounts = this.privateData.burnAccounts[signingEthAccount]
        if (type === 'regular') {
            return burnAccounts.detViewKeyCounter++
        } else {
            return burnAccounts.singleUseViewKeyCounter++
        }
    }

    #getCachedBurnAccount(signingEthAccount: Address, chainId: number, difficulty: Hex, opts: { burnAddress: Address }): UnsyncedUnknownBurnAccount | undefined
    #getCachedBurnAccount(signingEthAccount: Address, chainId: number, difficulty: Hex, opts: { viewingKeyIndex: number }): UnsyncedDerivedBurnAccount | undefined
    #getCachedBurnAccount(signingEthAccount: Address, chainId: number, difficulty: Hex, opts: { viewingKeyIndex: number; tokenAddress: Address }): UnsyncedSingleUseBurnAccount | undefined
    #getCachedBurnAccount(
        signingEthAccount: Address,
        chainId: number,
        difficulty: Hex,
        opts: { tokenAddress?: Address, viewingKeyIndex?: number, burnAddress?: Address }
    ): UnsyncedDerivedBurnAccount | UnsyncedUnknownBurnAccount | UnsyncedSingleUseBurnAccount | undefined {
        const difficultyPadded = padHex(difficulty, { size: 32 })
        const chainIdHex = toHex(chainId)
        const burnAccounts = this.privateData.burnAccounts[signingEthAccount].burnAccounts[chainIdHex]?.[difficultyPadded]
        if (opts.viewingKeyIndex !== undefined) {
            if (opts.tokenAddress) {
                return burnAccounts?.singleUseBurnAccounts?.[getAddress(opts.tokenAddress)]?.[opts.viewingKeyIndex]
            } else {
                return burnAccounts?.derivedBurnAccounts[opts.viewingKeyIndex] as UnsyncedDerivedBurnAccount | undefined
            }
        } else if (opts.burnAddress) {
            return burnAccounts?.unknownBurnAccounts[opts.burnAddress] as UnsyncedUnknownBurnAccount | undefined
        }
    }

    #createBurnAccountsKeys({ chainId, difficulty, ethAccount }: { chainId: number, difficulty: Hex, ethAccount: Address }) {
        const difficultyPadded = padHex(difficulty, { size: 32 })
        const chainIdHex = toHex(chainId)
        this.#createBurnAccountsKeysHex({ chainIdHex: chainIdHex, difficultyHex: difficultyPadded, ethAccount })
    }

    #createBurnAccountsKeysHex({ chainIdHex, difficultyHex, ethAccount }: { chainIdHex: Hex, difficultyHex: Hex, ethAccount: Address }) {
        ethAccount = getAddress(ethAccount)
        this.privateData.burnAccounts[ethAccount] ??= { pubKey: undefined, detViewKeyCounter: 0, singleUseViewKeyCounter: 0, burnAccounts: {}, detViewKeyRoot: undefined };
        this.privateData.burnAccounts[ethAccount].burnAccounts[chainIdHex] ??= {};
        this.privateData.burnAccounts[ethAccount].burnAccounts[chainIdHex][difficultyHex] ??= { derivedBurnAccounts: [], unknownBurnAccounts: {}, singleUseBurnAccounts: {} };
    }

    #addSingleUseBurnAccount(burnAccount: UnsyncedSingleUseBurnAccount) {
        const difficultyPadded = padHex(burnAccount.difficulty, { size: 32 })
        const ethAccount = getAddress(burnAccount.ethAccount)
        const contractAddress = getAddress(burnAccount.tokenAddress)
        this.#createBurnAccountsKeysHex({ chainIdHex: burnAccount.chainId, difficultyHex: difficultyPadded, ethAccount })
        const burnAccounts = this.privateData.burnAccounts[ethAccount].burnAccounts[burnAccount.chainId][difficultyPadded]
        burnAccounts.singleUseBurnAccounts[contractAddress] ??= []
        burnAccounts.singleUseBurnAccounts[contractAddress][burnAccount.viewingKeyIndex] = burnAccount
    }

    #getBurnAccount(ethAccount: Address, chainId: number, difficulty: Hex, viewingKeyIndex: number, burnAddress: Address) {
        ethAccount = getAddress(ethAccount)
        const difficultyPadded = padHex(difficulty, { size: 32 })
        const chainIdHex = toHex(chainId)
        if (viewingKeyIndex) {
            return this.privateData.burnAccounts[ethAccount].burnAccounts[chainIdHex][difficultyPadded].derivedBurnAccounts[viewingKeyIndex]
        } else {
            return this.privateData.burnAccounts[ethAccount].burnAccounts[chainIdHex][difficultyPadded].unknownBurnAccounts[burnAddress]
        }
    }

    /**
     * @note does not support recoverable and importable type, since it directly writes without the full checks, and relies on `burnAddress` to know where to put the unknown derivation accounts
     * @param burnAccount 
     */
    #addBurnAccount(burnAccount: BurnAccount) {
        // extra safety, if burnAccount.difficulty is not padded this wont pad it
        // but key used for storage is because if it ins't duplicate entries can be created
        const difficultyPadded = padHex(burnAccount.difficulty, { size: 32 })
        const ethAccount = getAddress(burnAccount.ethAccount)
        this.#createBurnAccountsKeysHex({ chainIdHex: burnAccount.chainId, difficultyHex: difficultyPadded, ethAccount })
        if (isDerivedBurnAccount(burnAccount)) {
            this.privateData.burnAccounts[ethAccount].burnAccounts[burnAccount.chainId][difficultyPadded].derivedBurnAccounts[burnAccount.viewingKeyIndex] = burnAccount
        } else {
            this.privateData.burnAccounts[ethAccount].burnAccounts[burnAccount.chainId][difficultyPadded].unknownBurnAccounts[getAddress(burnAccount.burnAddress)] = burnAccount
        }
    }

    // prompts user to sign to create viewing keys and also store pubKey of eth account
    async connect(walletClient?: WalletClient) {
        walletClient ??= this.viemWallet
        this.viemWallet = walletClient
        if (walletClient.account === undefined) throw new Error(viemAccountNotSetErr)
        return await this.#connect(getAddress(walletClient.account.address))
    }

    /**
     * @notice Prompts the user to sign a message if the deterministic view key root is not stored yet.
     * @returns The deterministic view key root.
     */
    async getDeterministicViewKeyRoot(ethAccount: Address, message = VIEWING_KEY_SIG_MESSAGE): Promise<Hex> {
        ethAccount = getAddress(ethAccount)
        if (this.privateData.burnAccounts[ethAccount] === undefined || this.privateData.burnAccounts[ethAccount].detViewKeyRoot === undefined) {
            await this.#connect(ethAccount, message)
        }
        return this.privateData.burnAccounts[ethAccount].detViewKeyRoot as Hex
    }

    /**
     * @notice Prompts the user to sign a message if the public key is not stored yet.
     * @returns The wallet's spending public key as `{ x, y }`.
     */
    async getPubKey(ethAccount: Address, message = VIEWING_KEY_SIG_MESSAGE) {
        ethAccount = getAddress(ethAccount)
        if (this.privateData.burnAccounts[ethAccount] === undefined || this.privateData.burnAccounts[ethAccount].pubKey === undefined) {
            await this.#connect(ethAccount, message)
        }
        return this.privateData.burnAccounts[ethAccount].pubKey as { x: Hex, y: Hex }
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
        chainId: number, difficulty: Hex,
        { isDeterministic, spendingPubKeyX, signingEthAccount, powNonce, viewingKey, viewingKeyIndex, async = false, viewKeyMessage = VIEWING_KEY_SIG_MESSAGE }:
            { isDeterministic?: boolean, spendingPubKeyX?: Hex, signingEthAccount?: Address, powNonce?: bigint, viewingKey?: bigint, viewingKeyIndex?: number, chainId?: number, async?: boolean, viewKeyMessage?: string } = {}
    ) {
        signingEthAccount = getAddress(signingEthAccount ?? this.viemWallet.account!.address)
        this.#createBurnAccountsKeys({ chainId, difficulty, ethAccount: signingEthAccount })
        // TODO technically, if a PowNonce is provided, could not be deterministic, But we don't check for that here since it takes too long
        isDeterministic ??= viewingKey === undefined && powNonce === undefined;
        viewingKeyIndex ??= this.#nextViewingKeyIndex(signingEthAccount, 'regular')
        if (isDeterministic) {
            const cached = this.#getCachedBurnAccount(signingEthAccount, chainId, difficulty, { viewingKeyIndex })
            if (cached) return cached
        } else if (viewingKey !== undefined && powNonce !== undefined) {
            const cachedPubKeyX = spendingPubKeyX ?? this.privateData.burnAccounts[signingEthAccount]?.pubKey?.x
            if (cachedPubKeyX) {
                const blindedAddressDataHash = hashBlindedAddressData({ spendingPubKeyX: cachedPubKeyX, viewingKey, chainId: BigInt(chainId) })
                const burnAddress = getBurnAddress({ blindedAddressDataHash, powNonce })
                const cached = this.#getCachedBurnAccount(signingEthAccount, chainId, difficulty, { burnAddress })
                if (cached) return cached
            }
        }

        const { spendingPubKeyX: resolvedPubKeyX, viewKeyRoot } = await this.#getSignerData(signingEthAccount, viewKeyMessage, spendingPubKeyX)

        viewingKey ??= hashRegularViewingKey(viewKeyRoot, BigInt(viewingKeyIndex))
        const burnAccount = await createBurnAccountFromViewingKey(isDeterministic, resolvedPubKeyX, viewKeyMessage, chainId, difficulty, signingEthAccount, viewingKeyIndex, viewingKey, { powNonce, async })
        this.#addBurnAccount(burnAccount)
        return burnAccount
    }

    /**
     * Creates a single-use burn account whose viewing key is derived from both the
     * contract address and chain ID. This guarantees the burn address is unique
     * per token, so freshness only requires a single balance check on that token.
     * The ZK circuit is unaffected — viewingKey is always a private input.
     */
    async createSingleUseBurnAccount(
        tokenAddress: Address,
        chainId: number,
        difficulty: Hex,
        { spendingPubKeyX, signingEthAccount, powNonce, viewingKeyIndex, async = false, viewKeyMessage = VIEWING_KEY_SIG_MESSAGE }:
            { spendingPubKeyX?: Hex, signingEthAccount?: Address, powNonce?: bigint, viewingKey?: bigint, viewingKeyIndex?: number, chainId?: number, async?: boolean, viewKeyMessage?: string } = {}
    ): Promise<UnsyncedSingleUseBurnAccount> {
        signingEthAccount = getAddress(signingEthAccount ?? this.viemWallet.account!.address)
        this.#createBurnAccountsKeys({ chainId, difficulty, ethAccount: signingEthAccount })
        viewingKeyIndex ??= this.#nextViewingKeyIndex(signingEthAccount, 'singleUse')
        const cached = this.#getCachedBurnAccount(signingEthAccount, chainId, difficulty, { viewingKeyIndex, tokenAddress })
        if (cached) return cached

        const { spendingPubKeyX: resolvedPubKeyX, viewKeyRoot } = await this.#getSignerData(signingEthAccount, viewKeyMessage, spendingPubKeyX)

        const viewingKey = hashSingleUseViewingKey(viewKeyRoot, BigInt(viewingKeyIndex), tokenAddress, BigInt(chainId))
        const base = await createBurnAccountFromViewingKey(true, resolvedPubKeyX, viewKeyMessage, chainId, difficulty, signingEthAccount, viewingKeyIndex, viewingKey, { powNonce, async })
        const burnAccount: UnsyncedSingleUseBurnAccount = { ...base as UnsyncedDerivedBurnAccount, tokenAddress: getAddress(tokenAddress) }
        this.#addSingleUseBurnAccount(burnAccount)
        return burnAccount
    }


    async getFreshBurnAccount(
        tokenAddress: Address, fullNode: PublicClient, difficulty: Hex,
        { signingEthAccount, chainId }: { signingEthAccount?: Address, chainId?: number } = {}
    ) {
        chainId ??= await fullNode.getChainId()
        const tokenContract = getTransWarpTokenContract(tokenAddress, { public: fullNode })
        let isUsed: boolean;
        let burnAccount: UnsyncedBurnAccount;
        do {
            burnAccount = await this.createBurnAccount(chainId, difficulty, { signingEthAccount })
            const balance = await tokenContract.read.balanceOf([burnAccount.burnAddress])
            isUsed = balance !== 0n

        } while (isUsed)
        return burnAccount
    }

    /**
     * Creates single-use burn accounts until one with zero balance is found.
     * Because the address is contract-specific, a single balance check suffices.
     */
    async getFreshSingleUseBurnAccount(
        tokenAddress: Address, fullNode: PublicClient, difficulty: Hex,
        { signingEthAccount, chainId }: { signingEthAccount?: Address, chainId?: number } = {}
    ): Promise<UnsyncedSingleUseBurnAccount> {
        chainId ??= await fullNode.getChainId()
        const tokenContract = getTransWarpTokenContract(tokenAddress, { public: fullNode })
        let burnAccount: UnsyncedSingleUseBurnAccount
        do {
            burnAccount = await this.createSingleUseBurnAccount(tokenAddress, chainId, difficulty, { signingEthAccount, async: true })
            const balance = await tokenContract.read.balanceOf([burnAccount.burnAddress])
            if (balance === 0n) break
        } while (true)
        return burnAccount
    }

    // TODO figure out if we want checks here?
    updateBurnAccount(burnAccount: BurnAccount) {
        this.#addBurnAccount(burnAccount)
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
    async createBurnAccountsBulk(
        amountOfBurnAccounts: number, chainId: number, difficulty: Hex,
        { signingEthAccount, startingViewKeyIndex, async = false }:
            { signingEthAccount?: Address, startingViewKeyIndex?: number, async?: boolean } = {}
    ) {
        signingEthAccount = getAddress(signingEthAccount ?? this.viemWallet.account!.address)
        this.#createBurnAccountsKeys({ chainId, ethAccount: signingEthAccount, difficulty })
        startingViewKeyIndex ??= this.privateData.burnAccounts[signingEthAccount].detViewKeyCounter
        const burnAccountsPromises = new Array(amountOfBurnAccounts).fill(0).map((v, i) =>
            this.createBurnAccount(
                chainId, difficulty,
                { signingEthAccount, viewingKeyIndex: startingViewKeyIndex + i, async: async }
            )
        )

        const burnAccounts = await Promise.all(burnAccountsPromises)
        const lastIndex = amountOfBurnAccounts + startingViewKeyIndex
        if (lastIndex > this.privateData.burnAccounts[signingEthAccount].detViewKeyCounter) {
            this.privateData.burnAccounts[signingEthAccount].detViewKeyCounter = lastIndex
        }
        return burnAccounts
    }

    // export
    exportBurnAccounts(ethAccount: Address, chainId: number, difficulty: Hex, opts: { paranoidMode: true }): { derived: BurnAccountRecoverable[], unknown: BurnAccountRecoverable[], singleUse: Record<Address, DerivedBurnAccountRecoverable[]> };
    exportBurnAccounts(ethAccount: Address, chainId: number, difficulty: Hex, opts?: { paranoidMode?: false }): { derived: (BurnAccountRecoverable | BurnAccountImportable)[], unknown: (BurnAccountRecoverable | BurnAccountImportable)[], singleUse: Record<Address, (DerivedBurnAccountRecoverable | DerivedBurnAccountImportable)[]> };
    exportBurnAccounts(ethAccount: Address, chainId: number, difficulty: Hex, opts?: { paranoidMode: boolean }): { derived: (BurnAccountRecoverable | BurnAccountImportable)[], unknown: (BurnAccountRecoverable | BurnAccountImportable)[], singleUse: Record<Address, (DerivedBurnAccountRecoverable | DerivedBurnAccountImportable)[]> };
    /**
     * @param ethAccount 
     * @param chainId 
     * @param difficulty 
     * @param opts.paranoidMode - forces all output to {@link BurnAccountRecoverable}, excluding accountNonce and syncBlockNumber for stronger privacy
     */
    exportBurnAccounts(
        ethAccount: Address, chainId: number, difficulty: Hex, { paranoidMode = false } = {}
    ): { derived: (DerivedBurnAccountRecoverable | DerivedBurnAccountImportable)[], unknown: (UnknownBurnAccountRecoverable | UnknownBurnAccountImportable)[], singleUse: Record<Address, (DerivedBurnAccountRecoverable | DerivedBurnAccountImportable)[]> } {
        ethAccount = getAddress(ethAccount)
        const difficultyPadded = padHex(difficulty, { size: 32 });
        const chainIdHex = toHex(chainId)
        const burnAccountsObj = this.privateData.burnAccounts[ethAccount].burnAccounts[chainIdHex][difficultyPadded]
        const derived = burnAccountsObj.derivedBurnAccounts.map(
            (b) => paranoidMode === false ? toImportableDerivedBurnAccount(b) : toRecoverableDerivedBurnAccount(b)
        );
        const unknown = Object.values(burnAccountsObj.unknownBurnAccounts).map(
            (b) => paranoidMode === false ? toImportableUnknownBurnAccount(b) : toRecoverableUnknownBurnAccount(b)
        );
        const singleUse = Object.fromEntries(
            Object.keys(burnAccountsObj.singleUseBurnAccounts).map(
                (tokenAddress) =>
                    [tokenAddress,
                        burnAccountsObj.singleUseBurnAccounts[tokenAddress].map(
                            (b) => paranoidMode === false ? toImportableDerivedBurnAccount(b) : toRecoverableDerivedBurnAccount(b)
                        )
                    ]
            )
        ) //as Record<Address, (DerivedBurnAccountRecoverable | DerivedBurnAccountImportable)[]>;
        return { derived, unknown, singleUse };
    }

    exportAllBurnAccounts(paranoidMode: true): BurnAccountRecoverable[];
    exportAllBurnAccounts(paranoidMode?: false): (BurnAccountRecoverable | BurnAccountImportable)[];
    exportAllBurnAccounts(paranoidMode: boolean): (BurnAccountRecoverable | BurnAccountImportable)[];
    /**
     * @param opts.paranoidMode - forces all output to {@link BurnAccountRecoverable}, excluding accountNonce and syncBlockNumber for stronger privacy
     */
    exportAllBurnAccounts(
        paranoidMode = false
    ): (BurnAccountRecoverable | BurnAccountImportable)[] {
        const allBurnAccounts = BurnAccountToFlatArr(this.privateData)
        return allBurnAccounts.map((b) => paranoidMode === false && isSyncedBurnAccount(b) ? toImportableBurnAccount(b) : toRecoverableBurnAccount(b))
    }

    exportViewKeyData(paranoidMode: true): ExportedViewKeyData<BurnAccountRecoverable>;
    exportViewKeyData(paranoidMode?: false): ExportedViewKeyData<BurnAccountImportable | BurnAccountRecoverable>;
    exportViewKeyData(paranoidMode: boolean): ExportedViewKeyData<BurnAccountImportable | BurnAccountRecoverable>;
    exportViewKeyData(paranoidMode = false): ExportedViewKeyData<BurnAccountImportable | BurnAccountRecoverable> {
        const burnAccounts: ExportedViewKeyData<BurnAccountImportable | BurnAccountRecoverable>["burnAccounts"] = {};
        for (const rawEthAccount of Object.keys(this.privateData.burnAccounts) as Address[]) {
            const ethAccount = getAddress(rawEthAccount)
            const ethData = this.privateData.burnAccounts[ethAccount];
            burnAccounts[ethAccount] = { singleUseViewKeyCounter: ethData.singleUseViewKeyCounter, detViewKeyCounter: ethData.detViewKeyCounter, burnAccounts: {} };
            for (const chainId of Object.keys(ethData.burnAccounts) as Hex[]) {
                burnAccounts[ethAccount].burnAccounts[chainId] = {};
                for (const difficulty of Object.keys(ethData.burnAccounts[chainId]) as Hex[]) {
                    const { derived, unknown, singleUse } = this.exportBurnAccounts(ethAccount, Number(chainId as Hex), difficulty, { paranoidMode: paranoidMode });
                    burnAccounts[ethAccount].burnAccounts[chainId][difficulty] = {
                        derivedBurnAccounts: derived,
                        unknownBurnAccounts: unknown,
                        singleUseBurnAccounts: singleUse
                    };
                }
            }
        }
        const vieKeyData: ExportedViewKeyData<BurnAccountImportable | BurnAccountRecoverable> = { burnAccounts };
        return vieKeyData
    }

    /**
     * @TODO fix readability. Hard to read after claude dug in here
     * 
     * @param importedViewKeyData 
     * @param tokenAddress 
     * @param archiveNode 
     * @param param3 
     */
    async importViewKeyWalletData(
        importedViewKeyData: ExportedViewKeyData<BurnAccountImportable | BurnAccountRecoverable>, tokenAddress: Address, archiveNode: PublicClient,
        { fullSync = true, syncTillBlock, forceReSign = false, forceReHashViewKey = true, forcePow = false, async = false, fullNode, onlySignInWith, concurrency = 10, onAccountImported }: { fullSync?: boolean, syncTillBlock?: bigint, forceReSign?: boolean, forceReHashViewKey?: boolean, forcePow?: boolean, async?: boolean, fullNode?: PublicClient, onlySignInWith?: Address, concurrency?: number, onAccountImported?: () => void } = {}
    ) {
        fullNode ??= archiveNode;
        syncTillBlock ??= BigInt(await fullNode.getBlockNumber())
        const limit = pLimit(concurrency)
        const allBurnAccounts = BurnAccountToFlatArrExportedData(importedViewKeyData).filter(n => n)
        // TODO onlySignInWith not a list of addresses?
        const normalizedOnlySignInWith = onlySignInWith ? getAddress(onlySignInWith) : undefined
        const ethAccountsToImport = (Object.keys(importedViewKeyData.burnAccounts) as Address[]).map(
            (a) => getAddress(a)
        ).filter(
            (a) => normalizedOnlySignInWith === undefined || a === normalizedOnlySignInWith
        )
        console.log(`importing ${allBurnAccounts.length} burn accounts with max concurrency: ${concurrency}`)
        const startTime = Date.now()

        // ---------- sign in before import -------------
        // so the user only gets one request per ethAccount+message combo

        // seen? seen what?
        const seen = new Set<string>();
        // TODO why not use normalizedOnlySignInWith instead??
        const toConnect = allBurnAccounts.filter((b) => {
            if (onlySignInWith && b.ethAccount !== onlySignInWith) return false;
            const key = `${b.ethAccount}:${"viewKeySigMessage" in b ? b.viewKeySigMessage : ""}`;
            return !seen.has(key) && !!seen.add(key);
        });

        // try and connect all ethAccount+message combos, only only once, not every burn account (what `(accountsToImport.map((b) => this.importBurnAccount())` would do)
        const results = await Promise.allSettled(
            toConnect.map((b) => this.#connect(b.ethAccount, "viewKeySigMessage" in b ? b.viewKeySigMessage : undefined))
        );

        // get the ethAccount+message combo key who are rejected
        const rejectedKeys = new Set(
            toConnect
                .filter((_, i) => results[i].status === "rejected")
                .map((b) => `${b.ethAccount}:${"viewKeySigMessage" in b ? b.viewKeySigMessage : ""}`)
        );
        if (rejectedKeys.size > 0) console.warn(`Some accounts not imported since user rejected the request: ${[...rejectedKeys]}`);

        // remove burnAccounts with that rejected ethAccount+message combo and filter by onlySignInWith
        const burnAccountsToImport = allBurnAccounts.filter((b) => {
            if (onlySignInWith && b.ethAccount !== onlySignInWith) return false;
            const key = `${b.ethAccount}:${"viewKeySigMessage" in b ? b.viewKeySigMessage : ""}`;
            return !rejectedKeys.has(key);
        });

        await Promise.all(burnAccountsToImport.map((b) => limit(async () => {
            await this.importBurnAccount(b, tokenAddress, archiveNode, { fullSync, syncTillBlock, forceReSign, forceReHashViewKey, forcePow, async, fullNode })
            onAccountImported?.()
        })));

        // can that    const toConnect = allBurnAccounts.filter line be done here?
        // needs to stay async tho
        for (const ethAccount of ethAccountsToImport) {
            // find the source entry by case-insensitive match in case the imported JSON used a different casing
            const sourceKey = (Object.keys(importedViewKeyData.burnAccounts) as Address[])
                .find((k) => getAddress(k) === ethAccount) as Address
            const source = importedViewKeyData.burnAccounts[sourceKey]
            // only if the count is higher update it
            this.privateData.burnAccounts[ethAccount] ??= {
                detViewKeyRoot: undefined,
                pubKey: undefined,
                detViewKeyCounter: source.detViewKeyCounter,
                singleUseViewKeyCounter: source.singleUseViewKeyCounter,
                burnAccounts: {}
            }
            if (this.privateData.burnAccounts[ethAccount].detViewKeyCounter < source.detViewKeyCounter) {
                this.privateData.burnAccounts[ethAccount].detViewKeyCounter = source.detViewKeyCounter
            }
        }
        console.log(`done importing ${allBurnAccounts.length} burn accounts. It took ${Date.now() - startTime} ms`)
    }
    // { ethAccount, powNonce, viewingKey, viewingKeyIndex, chainId = this.defaults.chainId, difficulty = this.defaults.powDifficulty, async = false, viewKeyMessage = this.privateData.viewKeySigMessage }
    /**
     * forceReSign: will force recreation of spendingPubKeyX and viewing key (if the derivation is know). Will prompt the user to sign in the case rootViewingKey and/or spendingPubKeyX does not exist in storage yet
     * @param importedBurnAccount 
     * @param transwarpToken 
     * @param archiveNode 
     * @param param3 
     */
    async importBurnAccount(importedBurnAccount: AnyBurnAccount, tokenAddress: Address, archiveNode: PublicClient,
        { fullSync = true, syncTillBlock, forceReSign = false, forceReHashViewKey = true, forcePow = false, async = false, fullNode }: { fullSync?: boolean, syncTillBlock?: bigint, forceReHashViewKey?: boolean, fullNode?: PublicClient, forceReSign?: boolean, forcePow?: boolean, async?: boolean } = {}
    ) {
        fullNode ??= archiveNode
        const idBurnAccount = identifyBurnAccount(importedBurnAccount);
        let reCreatedBurnAccount: BurnAccount;
        syncTillBlock ??= BigInt(await fullNode.getBlockNumber())
        // recreate the full burn account as much as possible, even if keys are already provided. So we can check every key was correct later
        if (idBurnAccount.derivation === "Derived") {
            reCreatedBurnAccount = await this.createBurnAccount(
                Number(idBurnAccount.account.chainId),
                idBurnAccount.account.difficulty,
                {
                    isDeterministic: true,
                    signingEthAccount: idBurnAccount.account.ethAccount,
                    viewingKeyIndex: idBurnAccount.account.viewingKeyIndex,
                    viewKeyMessage: idBurnAccount.account.viewKeySigMessage,
                    powNonce: forcePow === false && "powNonce" in idBurnAccount.account ? BigInt(idBurnAccount.account.powNonce) : undefined,
                    viewingKey: forceReHashViewKey === false && "viewingKey" in idBurnAccount.account ? BigInt(idBurnAccount.account.viewingKey) : undefined,
                    async: async,
                    spendingPubKeyX: forceReSign === false && "spendingPubKeyX" in idBurnAccount.account ? idBurnAccount.account.spendingPubKeyX : undefined
                }
            )
        } else {
            // viewingKey cant be recreated, so always used from importedBurnAccount. 
            // viewingKeyIndex, viewKeyMessage, does not exist and is omitted. rest is same as above
            reCreatedBurnAccount = await this.createBurnAccount(
                Number(idBurnAccount.account.chainId),
                idBurnAccount.account.difficulty,
                {
                    isDeterministic: false,
                    signingEthAccount: idBurnAccount.account.ethAccount,
                    // viewingKeyIndex: idBurnAccount.account.viewingKeyIndex,
                    // viewKeyMessage: idBurnAccount.account.viewKeySigMessage,
                    powNonce: forcePow === false && idBurnAccount.account.powNonce ? BigInt(idBurnAccount.account.powNonce) : undefined,
                    viewingKey: BigInt(idBurnAccount.account.viewingKey),
                    async: async,
                    spendingPubKeyX: forceReSign === false && "spendingPubKeyX" in idBurnAccount.account ? idBurnAccount.account.spendingPubKeyX : undefined
                }
            )
        }

        // i hate typescript
        const castedImportedAccount = idBurnAccount.account as Record<string, unknown>
        const castedReCreatedAccount = reCreatedBurnAccount as Record<string, unknown>
        const syncingRelatedKey = ["syncData", ...Object.keys(BurnAccountSyncFieldsSchema.shape)]
        let errors = []
        for (const key of Object.keys(idBurnAccount.account)) {
            if (
                syncingRelatedKey.includes(key) === false &&
                castedImportedAccount[key] !== undefined && castedImportedAccount[key] !== castedReCreatedAccount[key]
            ) {
                errors.push(new Error(
                    `invalid burn account. Failed to recreate a value at ${key} from the imported burnAccount. \n Recreated: ${castedReCreatedAccount[key]} but imported value is ${castedImportedAccount[key]}`
                ))
            }
        }
        if (errors.length > 0) throw new AggregateError(errors, `Burn account recreation failed: ${errors.length} field(s) did not match`);

        if (idBurnAccount.state === "Importable" || idBurnAccount.state === "Synced") {
            // effectively checks if that nonce is valid. If it's too high errors, too low it just keeps it and wont sync further
            // @TODO do this for all contracts in there
            // find the accountNonce for this tokenAddress from the imported syncData
            const importedSyncData = idBurnAccount.account.syncData
            let maxNonce: bigint | undefined
            if (importedSyncData) {
                for (const chainContracts of Object.values(importedSyncData)) {
                    if (chainContracts[tokenAddress]) {
                        maxNonce = BigInt(chainContracts[tokenAddress].accountNonce) + 1n
                        break
                    }
                }
            }
            await syncBurnAccount(reCreatedBurnAccount, tokenAddress, archiveNode, { maxNonce: fullSync ? undefined : maxNonce, syncTillBlock: syncTillBlock })
        }
    }
}


// Shared base — called after the viewing key is already derived by either strategy.
async function createBurnAccountFromViewingKey(
    isDeterministic: boolean, spendingPubKeyX: Hex, viewKeySigMessage: string,
    chainId: number, difficulty: Hex, ethAccount: Address, viewingKeyIndex: number,
    viewingKey: bigint,
    { powNonce, async = false }: { powNonce?: bigint, async?: boolean } = {}
) {
    const chainIdInt = BigInt(chainId)
    const difficultyInt = BigInt(difficulty)
    const blindedAddressDataHash = hashBlindedAddressData({ spendingPubKeyX, viewingKey, chainId: chainIdInt })

    if (powNonce) {
        const isValid = isValidPowNonce({ difficulty: difficultyInt, blindedAddressDataHash, powNonce })
        if (isValid === false) {
            const powHash = hashPow({ blindedAddressDataHash, powNonce })
            throw new Error(
                `Invalid powNonce provided. Please provide a valid one or set to undefined so a new valid one can be found.` +
                `\npowNonce: ${toHex(powNonce, { size: 32 })}` +
                `\ndifficulty: ${padHex(difficulty, { size: 32 })}` +
                `\npowHash: ${toHex(powHash, { size: 32 })}`
            )
        }
    }

    if (async) {
        powNonce ??= await findPoWNonceAsync({ blindedAddressDataHash, startingValue: viewingKey, difficulty: difficultyInt }) as bigint
    } else {
        powNonce ??= findPoWNonce({ blindedAddressDataHash, startingValue: viewingKey, difficulty: difficultyInt })
    }

    const burnAddress = getBurnAddress({ blindedAddressDataHash, powNonce })
    let burnAccount: UnsyncedUnknownBurnAccount = {
        viewingKey: toHex(viewingKey, { size: 32 }),
        powNonce: toHex(powNonce, { size: 32 }),
        burnAddress,
        chainId: toHex(chainId),
        blindedAddressDataHash: toHex(blindedAddressDataHash, { size: 32 }),
        spendingPubKeyX,
        difficulty: padHex(difficulty, { size: 32 }),
        ethAccount,
    }

    if (isDeterministic) {
        burnAccount = { ...burnAccount, viewKeySigMessage, viewingKeyIndex } as UnsyncedDerivedBurnAccount
    }

    return burnAccount
}