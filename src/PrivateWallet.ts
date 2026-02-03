// PrivateWallet is a wrapper that exposes some ov viems WalletClient functions and requires them to only ever use one ethAccount

import { Address, hashMessage, Hex, hexToBytes, toBytes, toHex, WalletClient } from "viem";
import { BurnAccount, PrivateWalletData, UnsyncedBurnAccount } from "./types.js"
import { extractPubKeyFromSig, findPoWNonce, getBurnAddress, getViewingKey, verifyPowNonce } from "./hashing.js";
import { POW_DIFFICULTY, VIEWING_KEY_SIG_MESSAGE } from "./constants.js";
import { poseidon2Hash } from "@zkpassport/poseidon2"
import { syncBurnAccount } from "./syncing.js";

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

    //deterministic viewingKey Root. The same ethAccount can always recover to this key. User only needs to know their seed phrase to recover funds
    private detViewKeyRoot: Hex | undefined;
    private detViewKeyCounter = 0;

    /**
     * 
     * @param viemWallet 
     * @param privateWalletData 
     * @param viewKeySigMessage 
     */
    constructor(viemWallet: WalletClient, privateWalletData?: PrivateWalletData, viewKeySigMessage = VIEWING_KEY_SIG_MESSAGE, powDifficulty = POW_DIFFICULTY) {
        this.viemWallet = viemWallet
        this.powDifficulty = powDifficulty

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
     * @notice prompts user to sign a message if viewingKey is not set. 
     * @Warning Setting the viewing key your self is dangerous, inability to recover the viewing key will result in loss of funds
     * @returns 
     */
    async createNewBurnAccount({ blindingPow, viewingKey, difficulty = this.powDifficulty }: { blindingPow?: bigint, viewingKey?: bigint, difficulty: bigint }) {
        // assumes viewingKey is not deterministically derived, at least not the usual way. If viewingKey param is set
        const isDeterministicViewKey = viewingKey === undefined
        if (isDeterministicViewKey) {
            viewingKey = poseidon2Hash([
                BigInt(await this.getDeterministicViewKeyRoot()),
                BigInt(this.detViewKeyCounter)
            ])
            this.detViewKeyCounter += 1
        }
        const { x: pubKeyX } = await this.getPubKey()

        // TODO derive blindingPow
        if (blindingPow === undefined) {
            blindingPow = findPoWNonce({ pubKeyX, startingValue: viewingKey as bigint, difficulty: difficulty })
        }
        if (verifyPowNonce({ pubKeyX, blindingPow: BigInt(blindingPow) }) === false) { throw new Error("Provided blindingPow is not valid") }

        const burnAddress = getBurnAddress({ pubKeyX: pubKeyX, blindingPow: BigInt(blindingPow) })
        const burnAccount: UnsyncedBurnAccount = {
            viewingKey: toHex(viewingKey as bigint),
            isDeterministicViewKey: isDeterministicViewKey,
            blindingPow: toHex(blindingPow),
            burnAddress: burnAddress,
        }

        this.privateData.burnAccounts.push(burnAccount)

        return burnAccount
    }
}