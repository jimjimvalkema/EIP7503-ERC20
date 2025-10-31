import { Address, GetContractReturnType, Hex, PublicClient, WalletClient } from "viem";
import { WormholeToken$Type } from "../artifacts/contracts/WormholeToken.sol/artifacts.js";
import { SignMessageReturnType } from "viem/accounts";

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

export interface FormattedProofInputs {
    amount: bigint;
    recipient_address: bigint;
    fee_data: {
        relayer_address: bigint;
        priority_fee: bigint;
        conversion_rate: bigint;
        max_fee: bigint;
        fee_token: bigint;
    };
    account_note_hash: bigint;
    account_note_nullifier: bigint;
    root: bigint;
    signature_data: {
        public_key_x: bigint[];
        public_key_y: bigint[];
        signature: bigint[];
    };
    pow_nonce: bigint;
    total_received: bigint;
    prev_total_spent: bigint;
    viewing_key: bigint;
    account_nonce: bigint;
    prev_account_note_merkle: {
        depth: bigint;
        indices: bigint[];
        siblings: bigint[];
    };
    total_received_merkle: {
        depth: bigint;
        indices: bigint[];
        siblings: bigint[];
    };
}