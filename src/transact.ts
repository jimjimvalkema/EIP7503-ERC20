import { Address, getAddress, Hex, PublicClient, toHex } from "viem";
import { WormholeTokenTest } from "../test/Token.test.js";
import { FeeData, FormattedProofInputs, SyncedPrivateWallet, UnsyncedPrivateWallet, WormholeToken } from "./types.js";
import { SELF_RELAY_FEE_DATA } from "./constants.js";
import { generateProof, getProofInputs } from "./proving.js";
import { ProofData, UltraHonkBackend } from "@aztec/bb.js";
import { hashNullifier } from "./hashing.js";
import { syncPrivateWallet } from "./syncing.js";

export async function getTransactionInputs({ proofInputs, zkProof }: { zkProof: ProofData, proofInputs: FormattedProofInputs }) {
    const feeData = {
        relayerAddress: getAddress(proofInputs.fee_data.relayer_address),
        priorityFee: BigInt(proofInputs.fee_data.priority_fee ?? 0),
        conversionRate: BigInt(proofInputs.fee_data.conversion_rate ?? 0),
        maxFee: BigInt(proofInputs.fee_data.max_fee ?? 0),
        feeToken: getAddress(proofInputs.fee_data.fee_token)
    };

    const inputs: [bigint, Hex, typeof feeData, bigint, bigint, bigint, Hex] = [
        BigInt(proofInputs.amount),
        getAddress(proofInputs.recipient_address),
        feeData,
        BigInt(proofInputs.account_note_hash),
        BigInt(proofInputs.account_note_nullifier),
        BigInt(proofInputs.root),
        toHex(zkProof.proof) as Hex
    ]
    //console.log({proofHex:toHex(zkProof.proof), proof:zkProof.proof})
    return inputs
}

// TODO check if syncedPrivateWallet.accountNonce is not nullified, if it is resync the wallet!!!
export async function makePrivateTx(
    { wormholeToken, privateWallet, publicClient, amount, recipient, feeData, backend }:
        { wormholeToken: WormholeToken | WormholeTokenTest, privateWallet: SyncedPrivateWallet|UnsyncedPrivateWallet, publicClient: PublicClient, recipient: Address, amount: bigint, feeData?: FeeData, backend?: UltraHonkBackend }
) {
    feeData = feeData ?? SELF_RELAY_FEE_DATA

    // checks if accountNonce is not already nullified, if it is it find the next nonce that isn't, and updates total amount spend
    const syncedWallet = await syncPrivateWallet({wormholeToken, privateWallet})
    const proofInputs = await getProofInputs({ wormholeToken, privateWallet:syncedWallet, publicClient, amountToReMint: amount, recipient, feeData })
    const zkProof = await generateProof({ proofInputs, backend })
    const transactionInputs = await getTransactionInputs({ proofInputs: proofInputs, zkProof: zkProof })
    const relayerAccount = (await privateWallet.viem.wallet.getAddresses())[0]
    return (wormholeToken as WormholeToken).write.privateTransfer(transactionInputs, { account:relayerAccount, chain:  publicClient.chain})
}