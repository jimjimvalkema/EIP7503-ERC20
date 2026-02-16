import  { hashMessage, toHex } from "viem";
import type  { Address, GetContractReturnType, Hex, PublicClient, WalletClient } from "viem";
import type { WormholeToken$Type } from "../artifacts/contracts/WormholeToken.sol/artifacts.js";
import type { SignMessageReturnType } from "viem/accounts";
import type { InputMap } from "@noir-lang/noir_js";
import type { ProofData } from "@aztec/bb.js";
import { LeanIMT } from "@zk-kit/lean-imt";

export type WormholeToken = GetContractReturnType<WormholeToken$Type["abi"], Required<{ public?: PublicClient; wallet?: WalletClient; }>>

// we could use import type { FixedLengthArray } from 'type-fest';
// but for now i just do branded types so it yells at you if you do something stupid, but it doesn't check the length
export type u8AsHex = Hex & { __brand: 'u8AsHex' }
export type u8sAsHexArrLen32 = u8AsHex[] & { __brand: 'u8sAsHexArrLen32' }
export type u8sAsHexArrLen64 = u8AsHex[] & { __brand: 'u8sAsHexArrLen64' }
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

export interface SignatureInputs {
    recipientAddress: Address,
    amount: bigint,
    callData: Hex,
    encryptedTotalSpends: Hex[]
}

export interface MerkleData extends InputMap {
    depth: u32AsHex,
    // TODO maybe we can save on memory computing indices on the spot instead?
    indices: u1AsHexArr,
    siblings: Hex[],
}

export interface SpendableBalanceProof {
    totalSpendMerkleProofs: MerkleData,
    totalBurnedMerkleProofs: MerkleData,
    root: Hex
}

export interface BurnDataPublic extends InputMap {
    account_note_hash: Hex,
    account_note_nullifier: Hex,
}

export interface BurnDataPrivate extends InputMap {
    viewing_key: Hex,
    pow_nonce: Hex,
    total_burned: Hex,
    prev_total_spent: Hex,
    amount_to_spend: Hex,
    prev_account_nonce: Hex,
    prev_account_note_merkle_data: MerkleData,
    total_burned_merkle_data: MerkleData,
}

export interface PublicProofInputs extends InputMap {
    root: Hex,
    chain_id: Hex, // technically not public since we don't use the cross-chain functionality here, can be revealed does not leak user data
    amount: Hex,
    signature_hash: u8sAsHexArrLen32,
    burn_data_public: BurnDataPublic[],
}

export interface PrivateProofInputs extends InputMap {
    signature_data: SignatureData,
    burn_data_private: BurnDataPrivate[],
    amount_burn_addresses: u32AsHex
}

export interface ProofInputs extends PublicProofInputs, PrivateProofInputs, InputMap { }

export interface ProofInputs1n extends ProofInputs {
    amount_burn_addresses: '0x0' & u32AsHex | '0x1' & u32AsHex;
}

export interface ProofInputs4n extends ProofInputs {
    amount_burn_addresses: '0x0' & u32AsHex | '0x1' & u32AsHex | '0x2' & u32AsHex | '0x3' & u32AsHex | '0x4' & u32AsHex;
}


export interface noPowBurnAccount {
    viewingKey:bigint,
    spendingPubKeyX:Hex,
    blindedAddressDataHash:bigint 
}

export interface NotOwnedBurnAccount {
    readonly powNonce: Hex;
    readonly burnAddress: Address;
    readonly blindedAddressDataHash: Hex;
}

export interface UnsyncedBurnAccount extends NotOwnedBurnAccount {
    /**used to encrypt total spend, unconstrained, not a circuit input */
    readonly viewingKey: Hex;
    readonly isDeterministicViewKey: Boolean;
    /**used t */
    readonly powNonce: Hex;
    readonly burnAddress: Address;
    readonly chainId: Hex;
    readonly blindedAddressDataHash: Hex;
    readonly spendingPubKeyX: Hex;
}

export interface SyncedBurnAccount extends UnsyncedBurnAccount {
    accountNonce: Hex;
    totalSpent: Hex;
    totalBurned: Hex;
    spendableBalance: Hex;
}

export type BurnAccount = UnsyncedBurnAccount & Partial<SyncedBurnAccount>
// one wallet has one priv pub key pair, but can have multiple burn address, and spent from all of them at once
// export interface PrivateWallet {
//     viem: { wallet: WalletClient, ethAddress:Address };
//     pubKey: { x: Hex, y: Hex };
//     burnWallets: (UnsyncedBurnAccount | SyncedBurnAccount)[] 
// }


export interface PrivateWalletData {
    readonly ethAccount: Address
    readonly viewKeySigMessage: string,
    readonly detViewKeyRoot?: Hex,
    burnAccounts: BurnAccount[],
    pubKey?: { x: Hex, y: Hex },
    detViewKeyCounter?: number
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