import { Address, GetContractReturnType, Hex, PublicClient, WalletClient } from "viem";
import { WormholeToken$Type } from "../artifacts/contracts/WormholeToken.sol/artifacts.js";
import { SignMessageReturnType } from "viem/accounts";
import { InputMap } from "@noir-lang/noir_js";
import { ProofData } from "@aztec/bb.js";
import { FeeData, FormattedBurnAddressProofDataPublic, UnformattedProofInputsPublic } from "./proofInputsTypes.js";

export type WormholeToken = GetContractReturnType<WormholeToken$Type["abi"], Required<{ public?: PublicClient; wallet?: WalletClient; }>>

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

export interface UnformattedPublicProofInputsHex {
    
}
 

export interface RelayerInputs {
    pubInputs: FormattedBurnAddressProofDataPublic[];
    feeData:FeeData
    zkProof: ProofData;
    claimedAmounts: bigint[]
}

export interface RelayerInputsHex {
    pubInputs: UnformattedPublicProofInputsHex;
    zkProof: {
        proof:Hex,
        publicInputs:Hex[]
    };
}

export interface SignatureData {
    publicKeyX: Hex,
    publicKeyY: Hex,
    signature: Hex
}