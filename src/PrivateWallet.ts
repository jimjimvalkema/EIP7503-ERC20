// PrivateWallet is a wrapper that exposes some ov viems WalletClient functions and requires them to only ever use one ethAccount

import type { Address, Hex, WalletClient } from "viem";
import { hashMessage, hexToBytes, toBytes, toHex } from "viem";
import type { BurnAccount, noPowBurnAccount, PrivateWalletData, UnsyncedBurnAccount } from "./types.ts"
import { extractPubKeyFromSig, findPoWNonce, findPoWNonceAsync, getBurnAddress, getViewingKey, hashBlindedAddressData, verifyPowNonce } from "./hashing.ts";
import { POW_DIFFICULTY, VIEWING_KEY_SIG_MESSAGE } from "./constants.ts";
import { poseidon2Hash } from "@zkpassport/poseidon2"
//import { findPoWNonceAsync } from "./hashingAsync.js";

/**
 * A class that wraps around a viem WalletClient to enable creation of privateBurnAccounts that all have the same pubKey
 * This class stores all new generated burn accounts in PrivateWallet.privateWalletData
 * 
 * Other methods like signPrivate transfer, proofAndSelfRelay, etc are outside the class and only consume this class.
 * Since those methods wont create thing we need to store or cache. (like pubKey, important data)
 * This to avoid OOP as much as possible
 * @TODO is that a good decision?
 * Pros: can change circuit and contract and keep PrivateWallet same
 */
export class PrivateWallet {
    readonly viemWallet: WalletClient
    readonly privateData: PrivateWalletData;
    readonly powDifficulty: bigint;
    readonly acceptedChainIds: bigint[];
    readonly defaultChainId: bigint;

    //deterministic viewingKey Root. The same ethAccount can always recover to this key. User only needs to know their seed phrase to recover funds
    private detViewKeyRoot: Hex | undefined;
    private detViewKeyCounter = 0;

    /**
     * 
     * @param viemWallet 
     * @param privateWalletData 
     */
    constructor(
        viemWallet: WalletClient,
        { privateWalletData, viewKeySigMessage = VIEWING_KEY_SIG_MESSAGE, powDifficulty = POW_DIFFICULTY, acceptedChainIds = [1n], defaultChainId }:
            { privateWalletData?: PrivateWalletData, viewKeySigMessage?: string, powDifficulty?: bigint, acceptedChainIds?: bigint[], defaultChainId?: bigint } = {}
    ) {
        this.viemWallet = viemWallet
        this.powDifficulty = powDifficulty
        this.acceptedChainIds = acceptedChainIds

        // only one accepted chainId? thats default!
        // more? 1n is default, if it is accepted!
        if (defaultChainId === undefined) {
            if (this.acceptedChainIds.length === 1) {
                this.defaultChainId = this.acceptedChainIds[0]
            } else {
                if (this.acceptedChainIds.includes(1n)) {
                    this.defaultChainId = 1n
                } else {
                    throw new Error(`defaultChainId needs to be set. example: new PrivateWallet(viemWallet,{defaultChainId:${Number(acceptedChainIds[0])},acceptedChainIds:[${acceptedChainIds.map((v => Number(v) + "n")).toString()}]})`)
                }
            }
        } else {
            this.defaultChainId = defaultChainId
        }

        // init this.privateWalletData
        if (privateWalletData === undefined) {
            // set default
            this.privateData = {
                ethAccount: viemWallet.account?.address as Address,
                viewKeySigMessage: viewKeySigMessage,
                burnAccounts: [],
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
    }

    private async storePubKeyFromSig({ hash, signature }: { hash: Hex, signature: Hex }) {
        if (this.privateData.pubKey === undefined) {
            const { pubKeyX, pubKeyY } = await extractPubKeyFromSig({ hash: hash, signature: signature })
            this.privateData.pubKey = { x: pubKeyX, y: pubKeyY }
        }
    }

    private storeDetViewKeyRootFromSig({ signature }: { signature: Hex }) {
        if (this.privateData.detViewKeyRoot === undefined) {
            this.detViewKeyRoot = toHex(getViewingKey({ signature: signature }))
            return this.detViewKeyRoot
        }
    }


    /**
     * @notice prompts user to sign a message if not stored yet
     * @returns 
     */
    async getDeterministicViewKeyRoot() {
        if (this.detViewKeyRoot) {
            return this.detViewKeyRoot as Hex
        } else {
            const signature = await this.viemWallet.signMessage({ message: VIEWING_KEY_SIG_MESSAGE, account: this.privateData.ethAccount })
            const hash = hashMessage(VIEWING_KEY_SIG_MESSAGE);
            // store data
            await this.storePubKeyFromSig({ hash: hash, signature: signature })
            const detViewKeyRoot = this.storeDetViewKeyRootFromSig({ signature: signature })
            return detViewKeyRoot as Hex
        }
    }

    /**
     * @notice prompts user to sign a message if not stored yet
     * @returns 
     */
    async getPubKey(message = VIEWING_KEY_SIG_MESSAGE) {
        if (this.privateData.pubKey === undefined) {
            const signature = await this.viemWallet.signMessage({ message: message, account: this.privateData.ethAccount })
            const hash = hashMessage(VIEWING_KEY_SIG_MESSAGE);
            // store data
            await this.storePubKeyFromSig({ hash: hash, signature: signature })
            this.storeDetViewKeyRootFromSig({ signature: signature })
        }
        return this.privateData.pubKey as { x: Hex, y: Hex }
    }

    /**
     * Creates a new burn account by generating (or accepting) a viewing key,
     * deterministically finds a pow nonce,
     * and deriving the corresponding burn address.
     *
     * By default, the viewing key is deterministically derived from an internal
     * root and counter. If a custom `viewingKey` is provided, it is used as-is —
     * but note that losing a non-deterministic viewing key means permanent loss
     * of access to the associated funds.
     *
     * @param options - Optional configuration object.
     * @param options.viewingKey - A custom viewing key. If omitted, one is
     *   deterministically derived. **Warning:** providing your own key bypasses
     *   deterministic recovery — loss of this key results in loss of funds.
     * @param options.chainId - Target chain ID. Defaults to `this.defaultChainId`.
     *   Must be in `this.acceptedChainIds`.
     * @param options.powNonce - A pre-computed proof-of-work nonce. If omitted,
     *   one is computed deterministically using the specified `difficulty`. 
     *  **Warning:** providing your own powNonce bypasses
     *   deterministic recovery — loss of this key results in loss of funds.
     * @param options.difficulty - PoW difficulty override. Defaults to
     *   `this.powDifficulty`.
     * @param options.async - If `true`, uses it's own webworker thread. This helps not freezing the ui. Defaults to
     *   `false`.
     *
     * @returns The newly created {@link UnsyncedBurnAccount}, which is also
     *   appended to `this.privateData.burnAccounts`.
     *
     * @throws {Error} If `chainId` is not in `this.acceptedChainIds`.
     * @throws {Error} If a provided `powNonce` fails verification.
     */
    async createNewBurnAccount({ powNonce, viewingKey, chainId, difficulty = this.powDifficulty, async = false }: { async?: boolean, chainId?: bigint, powNonce?: bigint, viewingKey?: bigint, difficulty?: bigint } = {}) {
        // assumes viewingKey is not deterministically derived, at least not the usual way. If viewingKey param is set
        // @TODO @warptoad chainId is automatically set to mainnet, for warptoad 
        chainId ??= this.defaultChainId
        if (this.acceptedChainIds.includes(chainId) === false) { throw Error(`chainId:${chainId} is not accepted, only these chainId are valid: ${this.acceptedChainIds}`) }
        const isDeterministicViewKey = viewingKey === undefined
        if (isDeterministicViewKey) {
            viewingKey = poseidon2Hash([
                BigInt(await this.getDeterministicViewKeyRoot()),
                BigInt(this.detViewKeyCounter)
            ])
            this.detViewKeyCounter += 1
        }
        const { x: spendingPubKeyX } = await this.getPubKey()
        const blindedAddressDataHash = hashBlindedAddressData({ spendingPubKeyX, viewingKey: viewingKey as bigint, chainId })

        // TODO derive blindingPow
        if (powNonce === undefined) {
            if (async) {
                powNonce = await findPoWNonceAsync({ blindedAddressDataHash, startingValue: viewingKey as bigint, difficulty: difficulty }) as bigint
            } else {
                powNonce = findPoWNonce({ blindedAddressDataHash, startingValue: viewingKey as bigint, difficulty: difficulty })
            }
        }
        if (verifyPowNonce({ blindedAddressDataHash, powNonce: BigInt(powNonce) }) === false) { throw new Error("Provided powNonce is not valid") }

        const burnAddress = getBurnAddress({ blindedAddressDataHash: blindedAddressDataHash, powNonce: BigInt(powNonce) })
        const burnAccount: UnsyncedBurnAccount = {
            viewingKey: toHex(viewingKey as bigint, { size: 32 }),
            isDeterministicViewKey: isDeterministicViewKey,
            powNonce: toHex(powNonce, { size: 32 }),
            burnAddress: burnAddress,
            chainId: toHex(chainId),
            blindedAddressDataHash: toHex(blindedAddressDataHash, { size: 32 }),
            spendingPubKeyX: spendingPubKeyX
        }

        this.privateData.burnAccounts.push(burnAccount)

        return burnAccount
    }

    /**
     * Creates a multiple burn accounts in bulk deterministically finds a pow nonce,
     * and deriving the corresponding burn address.
     * 
     * @notice finds PoW nonces in parallel when async:true
     *
     * @param options - Optional configuration object.
     * @param options.chainId - Target chain ID. Defaults to `this.defaultChainId`.
     *   Must be in `this.acceptedChainIds`.
     * @param options.difficulty - PoW difficulty override. Defaults to
     *   `this.powDifficulty`.
     * @param options.async - If `true`, uses it's own webworker thread. This helps not freezing the ui. Defaults to
     *   `false`.
     *
     * @returns The newly created {@link UnsyncedBurnAccount}, which is also
     *   appended to `this.privateData.burnAccounts`.
     *
     * @throws {Error} If `chainId` is not in `this.acceptedChainIds`.
     * @throws {Error} If a provided `powNonce` fails verification.
     * 
     * @TODO it's probably inefficient to spawn a worker for each burn account if it exceeds available threads, but i assume most people don't need that many burn accounts at once
     */
    async createBurnAccounts(amountOfBurnAccounts: number, { chainId, difficulty = this.powDifficulty, async = false }: { async?: boolean, chainId?: bigint, difficulty?: bigint } = {}) {
        chainId ??= this.defaultChainId
        const burnAccountsPromises = new Array(amountOfBurnAccounts).fill(0).map((v,i)=>this.createBurnAccountFromViewKeyIndex({ viewingKeyIndex:this.detViewKeyCounter+i, chainId:chainId, difficulty:difficulty, async:async}))
        const burnAccounts = await Promise.all(burnAccountsPromises)
        this.detViewKeyCounter += amountOfBurnAccounts
        this.privateData.burnAccounts = [...this.privateData.burnAccounts, ...burnAccounts]
        return burnAccounts
    }

    async createBurnAccountFromViewKeyIndex({ viewingKeyIndex, chainId, difficulty = this.powDifficulty, async = false }: { viewingKeyIndex:number, async?: boolean, chainId: bigint, viewingKey?: bigint, difficulty?: bigint }) {
        chainId ??= this.defaultChainId
        const { x: spendingPubKeyX } = await this.getPubKey()
        const viewingKey = poseidon2Hash([
                BigInt(await this.getDeterministicViewKeyRoot()),
                BigInt(viewingKeyIndex)
            ])
        const blindedAddressDataHash = hashBlindedAddressData({ spendingPubKeyX, viewingKey: viewingKey as bigint, chainId: chainId })
        let powNonce:bigint;
        if (async) {
            powNonce = await findPoWNonceAsync({ blindedAddressDataHash, startingValue: viewingKey as bigint, difficulty: difficulty }) as bigint
        } else {
            powNonce = findPoWNonce({ blindedAddressDataHash, startingValue: viewingKey as bigint, difficulty: difficulty })
        }
        const burnAddress = getBurnAddress({ blindedAddressDataHash: blindedAddressDataHash, powNonce: BigInt(powNonce) })
        const burnAccount: UnsyncedBurnAccount = {
            viewingKey: toHex(viewingKey as bigint, { size: 32 }),
            isDeterministicViewKey: true,
            powNonce: toHex(powNonce, { size: 32 }),
            burnAddress: burnAddress,
            chainId: toHex(chainId),
            blindedAddressDataHash: toHex(blindedAddressDataHash, { size: 32 }),
            spendingPubKeyX: spendingPubKeyX
        }
        return burnAccount

    }
}