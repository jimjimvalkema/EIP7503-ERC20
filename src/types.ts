import { Address, GetContractReturnType, hashMessage, Hex, PublicClient, toHex, WalletClient } from "viem";
import { WormholeToken$Type } from "../artifacts/contracts/WormholeToken.sol/artifacts.js";
import { SignMessageReturnType } from "viem/accounts";
import { InputMap } from "@noir-lang/noir_js";
import { ProofData } from "@aztec/bb.js";
import { LeanIMT } from "@zk-kit/lean-imt";
import { VIEWING_KEY_SIG_MESSAGE } from "./constants.js";
import { poseidon2Hash } from "@zkpassport/poseidon2"
import { extractPubKeyFromSig, getPrivateAddress as getBurnAddress, getViewingKey, verifyPowNonce } from "./hashing.js";

export type WormholeToken = GetContractReturnType<WormholeToken$Type["abi"], Required<{ public?: PublicClient; wallet?: WalletClient; }>>

// we could use import type { FixedLengthArray } from 'type-fest';
// but for now i just do branded types so it yells at you if you do something stupid, but it doesn't check the length
export type u8sAsHexArrLen32 = Hex[] & { __brand: 'u8sAsHexArrLen32' }
export type u8sAsHexArrLen64 = Hex[] & { __brand: 'u8sAsHexArrLen64' }
export type u32AsHex = Hex & { __brand: 'u32AsHex' }
export type u1AsHexArr = Hex[] & { __brand: 'u1AsHexArr' }

export interface SignatureData extends InputMap {
    /** Must be exactly 32 bytes */
    public_key_x: u8sAsHexArrLen32;
    /** Must be exactly 32 bytes */
    public_key_y: u8sAsHexArrLen32;
    /** Must be exactly 64 bytes */
    signature: u8sAsHexArrLen64;
}

export interface MerkleData extends InputMap {
    depth: u32AsHex,
    // TODO maybe we can save on memory computing indices on the spot instead?
    indices: u1AsHexArr,
    siblings: Hex[],
}


export interface BurnDataPublic extends InputMap {
    account_note_hash: Hex,
    account_note_nullifier: Hex,
}

export interface BurnDataPrivate extends InputMap {
    //-----very privacy sensitive data -----
    total_received: Hex,
    prev_total_spent: Hex,
    prev_account_nonce: Hex,
    prev_account_note_merkle: MerkleData,
    total_received_merkle: MerkleData,
    amount: Hex,
    blinding_pow: Hex,
}

export interface PublicProofInputs extends InputMap {
    root: Hex,
    amount: Hex,
    signature_hash: u8sAsHexArrLen32,
    burn_data_public: BurnDataPublic[],
}

export interface PrivateProofInputs extends InputMap {
    signature_data: SignatureData,
    viewing_key: Hex,
    burn_data_private: BurnDataPrivate[],
    amount_burn_addresses: u32AsHex
}

interface ProofInputs extends PublicProofInputs, PrivateProofInputs, InputMap { }

export interface ProofInputs1n extends ProofInputs {
    amount_burn_addresses: '0x0' & u32AsHex | '0x1' & u32AsHex;
}

export interface ProofInputs4n extends ProofInputs {
    amount_burn_addresses: '0x0' & u32AsHex | '0x1' & u32AsHex | '0x2' & u32AsHex | '0x3' & u32AsHex | '0x4' & u32AsHex;
}


export interface UnsyncedBurnAccount {
    viewingKey: Hex,
    isDeterministicViewKey: Boolean,
    blindingPow: Hex;
    burnAddress: Address,
}

export interface SyncedBurnAccount extends UnsyncedBurnAccount {
    accountNonce: Hex;
    totalSpent: Hex;
    totalReceived: Hex;
    spendableBalance: Hex;
}

// one wallet has one priv pub key pair, but can have multiple burn address, and spent from all of them at once
// export interface PrivateWallet {
//     viem: { wallet: WalletClient, ethAddress:Address };
//     pubKey: { x: Hex, y: Hex };
//     burnWallets: (UnsyncedBurnAccount | SyncedBurnAccount)[] 
// }


interface PrivateWalletData {
    readonly ethAccount:Address
    readonly detViewKeyRoot?:Hex, 
    pubKey?:{ x: Hex, y: Hex }, 
    detViewKeyCounter?:number 
    burnAccounts:(UnsyncedBurnAccount | SyncedBurnAccount)[], 
}

// PrivateWallet is a wrapper that exposes some ov viems WalletClient functions and requires them to only ever use one ethAccount
// 
export class PrivateWallet {
    private readonly viemWallet: WalletClient
    readonly privateWalletData:PrivateWalletData;

    //deterministic viewingKey Root. The same ethAccount can always recover to this key. User only needs to know their seed phrase to recover funds
    private detViewKeyRoot: Hex | undefined;
    private detViewKeyCounter = 0;
    constructor(viemWallet:WalletClient,privateWalletData?:PrivateWalletData) {
        this.viemWallet = viemWallet
        this.privateWalletData = privateWalletData ? privateWalletData : {ethAccount:viemWallet.account?.address as Address, burnAccounts:[]}
    }

    async storePubKeyFromSig({ hash, signature }: { hash: Hex, signature: Hex }) {
        if (this.privateWalletData.pubKey === undefined) {
            const { pubKeyX, pubKeyY } = await extractPubKeyFromSig({ hash: hash, signature: signature })
            this.privateWalletData.pubKey = { x: pubKeyX, y: pubKeyY }
        }
    }

    async getDeterministicViewKeyRoot() {
        if (this.detViewKeyRoot) {
            return this.detViewKeyRoot
        } else {
            const signature = await this.viemWallet.signMessage({ message: VIEWING_KEY_SIG_MESSAGE, account: this.privateWalletData.ethAccount })
            const hash = hashMessage(VIEWING_KEY_SIG_MESSAGE);
            await this.storePubKeyFromSig({ hash: hash, signature: signature })
            this.detViewKeyRoot = toHex(getViewingKey({ signature: signature }))
            return this.detViewKeyRoot
        }
    }

    async getPubKey(message = VIEWING_KEY_SIG_MESSAGE) {
        if (this.privateWalletData.pubKey === undefined) {
            const signature = await this.viemWallet.signMessage({ message: message, account: this.privateWalletData.ethAccount })
            const hash = hashMessage(VIEWING_KEY_SIG_MESSAGE);
            await this.storePubKeyFromSig({ hash: hash, signature: signature })
        }
        return this.privateWalletData.pubKey as { x: Hex, y: Hex }
    }

    async createNewBurnAccount({ blindingPow, viewingKey }: { blindingPow: bigint, message?: string, viewingKey?: bigint }) {
        // assumes viewingKey is not deterministically derived, at least not the usual way. If viewingKey param is set
        const isDeterministicViewKey = viewingKey === undefined
        if (isDeterministicViewKey) {
            viewingKey = poseidon2Hash([
                BigInt(await this.getDeterministicViewKeyRoot()),
                BigInt(this.detViewKeyCounter)
            ])
        }

        const { x: pubKeyX } = await this.getPubKey()
        if (verifyPowNonce({ pubKeyX, blindingPow: BigInt(blindingPow) }) === false) { throw new Error("Provided blindingPow is not valid") }

        const burnAddress = getBurnAddress({ pubKeyX: pubKeyX, blindingPow: BigInt(blindingPow) })
        const burnAccount: UnsyncedBurnAccount = {
            viewingKey: toHex(viewingKey as bigint),
            isDeterministicViewKey: isDeterministicViewKey,
            blindingPow: toHex(blindingPow),
            burnAddress: burnAddress,
        }

        this.privateWalletData.burnAccounts.push(burnAccount)
        return burnAccount
    }
}



export interface RelayerInputs {
    pubInputs: PublicProofInputs;
    zkProof: {
        proof: Hex,
        publicInputs: Hex[]
    };
}

export interface FeeData {
    relayerAddress: Address,
    priorityFee: Hex,
    conversionRate?: Hex,
    conversionRateInputs?: {
        estimatedGasUsed: Hex,
        relayerBonusFactor: Hex,
        tokenPriceInEth: Hex,
    }
    maxFee: Hex,
    feeToken: Hex,
}

export interface SignatureHashPreImg {
    recipientAddress: Address,
    amount: Hex,
    callData: Hex,
}

export interface PreSyncedTree {
    tree: LeanIMT<bigint>
    lastSyncedBlock: bigint,
    firstSyncedBlock: bigint
}