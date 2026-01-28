import { Address, GetContractReturnType, Hex, PublicClient, WalletClient } from "viem";
import { WormholeToken$Type } from "../artifacts/contracts/WormholeToken.sol/artifacts.js";
import { SignMessageReturnType } from "viem/accounts";
import { InputMap } from "@noir-lang/noir_js";
import { ProofData } from "@aztec/bb.js";

export type WormholeToken = GetContractReturnType<WormholeToken$Type["abi"], Required<{ public?: PublicClient; wallet?: WalletClient; }>>

// we could use import type { FixedLengthArray } from 'type-fest';
// but for now i just do this
export type u8sAsHexArrLen32 = Hex[]
export type u8sAsHexArrLen64 = Hex[]
export type u32AsHex = Hex
export type u1AsHexArr = Hex[]

export interface SignatureData extends InputMap {
    /** Must be exactly 32 bytes */
    public_key_x: u8sAsHexArrLen32;
    /** Must be exactly 32 bytes */
    public_key_y: u8sAsHexArrLen32;
    /** Must be exactly 64 bytes */
    signature: u8sAsHexArrLen64;
}

export interface MerkleData extends InputMap{
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

export interface PrivateProofInputs extends InputMap  {
    signature_data: SignatureData,      
    viewing_key: Hex,
    burn_data_private: BurnDataPrivate[],
    amount_burn_addresses:u32AsHex 
}

interface ProofInputs extends PublicProofInputs,PrivateProofInputs, InputMap {}

export interface ProofInputs1n extends ProofInputs {
    amount_burn_addresses: '0x0' | '0x1';
}

export interface ProofInputs4n extends ProofInputs {
    amount_burn_addresses: '0x0' | '0x1' | '0x2' | '0x3' | '0x4';
}

export interface UnsyncedPrivateWallet {
    pubKey: { x: Hex, y: Hex };
    viewingKey: bigint,
    sharedSecret: bigint;
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
    pubInputs: PublicProofInputs;
    zkProof: {
        proof:Hex,
        publicInputs:Hex[]
    };
}

export interface FeeData {
    relayerAddress: Address,
    priorityFee: Hex,
    conversionRate: Hex,
    maxFee: Hex,
    feeToken: Address,
}

export interface SignatureHashPreImg {
    recipientAddress: Address, 
    amount: Hex ,
    callData: Hex,
}
