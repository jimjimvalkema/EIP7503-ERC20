import { Address, getAddress, Hex, PublicClient, toHex } from "viem";
import { WormholeTokenTest } from "../test/Token.test.js";
import { FeeData, FormattedProofInputs, SyncedPrivateWallet, WormholeToken } from "./types.js";
import { SELF_RELAY_FEE_DATA } from "./constants.js";
import { generateProof, getProofInputs } from "./proving.js";
import { ProofData, UltraHonkBackend } from "@aztec/bb.js";


// struct FeeData {
//     // relayerAddress = 0 <= self relay, relayerAddress = 1 <= msg.sender will relay, all other will send it to that address like expected
//     address relayerAddress;
//     // there is no way for the contract to know what priority fee is set so the spender just has to set it for the relayer (who ofc can choose a different number)
//     uint256 priorityFee;
//     // gas usage can change in network upgrades or when the merkle tree grows deeper
//     // price of eth in fee_token * gas_used
//     uint256 conversionRate;
//     // in the contract the fee is calculated feeAmountInFeeToken = (pubInput.priority_fee + block.baseFee) * pubInput.conversion_rate
//     // and should feeAmountInFeeToken < max_fee. conversionRate = gasUsage*tokenPriceInWei*relayerBonusFactor. 
//     // ex gasUsage=45000,tokenPriceInEth=0.048961448,relayerBonusFactor=10%
//     // conversionRate = 45000 * 48955645000000000 * 1.1
//     uint256 maxFee;
//     // fee_token is not that interesting rn because it really can only be the token it self or eth,
//     // but in the future where it is integrated as a deposit method of a rail-gun like system it can be use full.
//     address feeToken;
// }


// uint256 _amount,
// address _to,
// FeeData calldata _feeData,
// uint256 _accountNoteHash,        // a commitment inserted in the merkle tree, tracks how much is spend after this transfer hash(prev_total_spent+amount, prev_account_nonce, viewing_key)
// uint256 _accountNoteNullifier,   // nullifies the previous account_note.  hash(prev_account_nonce, viewing_key)
// uint256 _root,
// bytes calldata _snarkProof
export async function getTransactionInputs({ proofInputs, zkProof }: { zkProof: ProofData, proofInputs: FormattedProofInputs }) {
    const feeData = {
        relayerAddress: getAddress(proofInputs.fee_data.relayer_address),
        priorityFee: BigInt(proofInputs.fee_data.priority_fee ?? 0),
        conversionRate: BigInt(proofInputs.fee_data.conversion_rate ?? 0),
        maxFee: BigInt(proofInputs.fee_data.max_fee ?? 0),
        feeToken: getAddress(proofInputs.fee_data.fee_token)
    };

    // const feeData = [
    //     getAddress(proofInputs.fee_data.relayer_address),
    //     BigInt(proofInputs.fee_data.priority_fee ?? 0),
    //     BigInt(proofInputs.fee_data.conversion_rate ?? 0),
    //     BigInt(proofInputs.fee_data.max_fee ?? 0),
    //     getAddress(proofInputs.fee_data.fee_token)
    // ];
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
    { wormholeToken, syncedPrivateWallet, publicClient, amount, recipient, feeData, backend }:
        { wormholeToken: WormholeToken | WormholeTokenTest, syncedPrivateWallet: SyncedPrivateWallet, publicClient: PublicClient, recipient: Address, amount: bigint, feeData?: FeeData, backend?: UltraHonkBackend }
) {
    feeData = feeData ?? SELF_RELAY_FEE_DATA
    const proofInputs = await getProofInputs({ wormholeToken, syncedPrivateWallet, publicClient, amountToReMint: amount, recipient, feeData })
    const zkProof = await generateProof({ proofInputs, backend })
    const transactionInputs = await getTransactionInputs({ proofInputs: proofInputs, zkProof: zkProof })
    const relayerAccount = (await syncedPrivateWallet.viem.wallet.getAddresses())[0]
    return (wormholeToken as WormholeToken).write.privateTransfer(transactionInputs, { account:relayerAccount, chain:  publicClient.chain})
}