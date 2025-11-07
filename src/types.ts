import { Address, GetContractReturnType, Hex, PublicClient, WalletClient } from "viem";
import { WormholeToken$Type } from "../artifacts/contracts/WormholeToken.sol/artifacts.js";
import { SignMessageReturnType } from "viem/accounts";
import { InputMap } from "@noir-lang/noir_js";
import { ProofData } from "@aztec/bb.js";

export type WormholeToken = GetContractReturnType<WormholeToken$Type["abi"], Required<{ public?: PublicClient; wallet?: WalletClient; }>>

export interface MerkleData {
    depth: bigint,
    indices: bigint[],
    siblings: bigint[],
}

export interface FeeData {
    relayerAddress: Address,
    priorityFee: bigint,
    conversionRate: bigint,
    maxFee: bigint,
    feeToken: Address,
}

export interface UnformattedPublicProofInputs {
    amount: bigint,
    recipientAddress: Address,
    feeData: FeeData,
    accountNoteHash: bigint,
    accountNoteNullifier: bigint,
    root: bigint,
}


export interface UnformattedPrivateProofInputs {
    signatureData: {
        publicKeyX: Hex,
        publicKeyY: Hex,
        signature: SignMessageReturnType
    },
    powNonce: bigint,
    totalReceived: bigint,
    prevTotalSpent: bigint,
    viewingKey: bigint,
    accountNonce: bigint,
    prevAccountNoteMerkle: MerkleData,
    totalReceivedMerkle: MerkleData,
}

export interface UnformattedProofInputs {
    pubInputs: UnformattedPublicProofInputs,
    privInputs: UnformattedPrivateProofInputs
}

export interface FormattedProofInputs extends InputMap {
    amount: Hex;
    recipient_address: Hex;
    fee_data: {
        relayer_address: Hex;
        priority_fee: Hex;
        conversion_rate: Hex;
        max_fee: Hex;
        fee_token: Hex;
    };
    account_note_hash: Hex;
    account_note_nullifier: Hex;
    root: Hex;
    signature_data: {
        public_key_x: Hex[];
        public_key_y: Hex[];
        signature: Hex[];
    };
    pow_nonce: Hex;
    total_received: Hex;
    prev_total_spent: Hex;
    viewing_key: Hex;
    prev_account_nonce: Hex;
    prev_account_note_merkle: {
        depth: Hex;
        indices: Hex[];
        siblings: Hex[];
    };
    total_received_merkle: {
        depth: Hex;
        indices: Hex[];
        siblings: Hex[];
    };
}

export interface UnsyncedPrivateWallet {
    pubKey: { x: Hex, y: Hex };
    viewingKey: bigint,
    powNonce: bigint;
    burnAddress: Address,
    viem: { wallet: WalletClient },
    accountNonce?: bigint,
    totalSpent?: bigint,
    totalReceived?: bigint
}


export interface SyncedPrivateWallet extends UnsyncedPrivateWallet {
    burnAddress: Address;
    accountNonce: bigint;
    totalSpent: bigint;
    totalReceived: bigint;
    spendableBalance: bigint;
}


export interface RelayerInputs {
    pubInputs: UnformattedPublicProofInputs;
    zkProof: ProofData;
}

export interface SignatureData {
    publicKeyX: Hex,
    publicKeyY: Hex,
    signature: Hex
}