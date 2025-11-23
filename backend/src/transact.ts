import { Address, getAddress, getContract, Hex, PublicClient, toBytes, toHex, WalletClient, zeroAddress } from "viem";
import { WormholeTokenTest } from "../test/Token.test.js";
import { RelayerInputs, RelayerInputsHex, SyncedPrivateWallet, UnsyncedPrivateWallet, WormholeToken } from "./types.js";
import { EMPTY_FEE_DATA } from "./constants.js";
import { formatProofInputs, generateProof, getUnformattedProofInputs } from "./proving.js";
import { ProofData, UltraHonkBackend } from "@aztec/bb.js";
import { syncPrivateWallet } from "./syncing.js";
import { UnformattedProofInputsPublic } from "./proofInputsTypes.js";
//import { noir_test_main_self_relay } from "./noirtests.js";

export function getTransactionInputs({ pubProofInputs, zkProof }: { zkProof: ProofData, pubProofInputs: UnformattedProofInputsPublic }) {
    const feeData = {
        relayerAddress: getAddress(pubProofInputs.feeData.relayerAddress),
        priorityFee: BigInt(pubProofInputs.feeData.priorityFee),
        conversionRate: BigInt(pubProofInputs.feeData.conversionRate),
        maxFee: BigInt(pubProofInputs.feeData.maxFee),
        feeToken: getAddress(pubProofInputs.feeData.feeToken)
    };

    const inputs: [bigint, Hex, typeof feeData, bigint, bigint, bigint, Hex] = [
        BigInt(pubProofInputs.amount),
        getAddress(pubProofInputs.recipient_address),
        feeData,
        BigInt(pubProofInputs.burn_address_public_proof_data[0].account_note_hash),
        BigInt(pubProofInputs.burn_address_public_proof_data[0].account_note_nullifier),
        BigInt(pubProofInputs.root),
        toHex(zkProof.proof) as Hex
    ]
    return inputs
}

export async function estimateGasUsed() {
    
}

// TODO check if syncedPrivateWallet.accountNonce is not nullified, if it is resync the wallet!!!
export async function createRelayerInputs(
    { wormholeToken, privateWallet, publicClient, amount, recipient, feeData, backend }:
        {
            wormholeToken: WormholeToken | WormholeTokenTest, privateWallet: SyncedPrivateWallet | UnsyncedPrivateWallet, publicClient: PublicClient, recipient: Address, amount: bigint, feeData: {
                conversionRateInputs?: {
                    estimatedGasUsed: number,
                    relayerBonusFactor: number,
                    tokenPriceInEth: number,
                },
                priorityFee: bigint,
                maxFee: bigint,
                relayerAddress: Address
            }, backend?: UltraHonkBackend
        }
) {
    // checks if accountNonce is not already nullified, if it is it find the next nonce that isn't, and updates total amount spend
    const syncedWallet = await syncPrivateWallet({ wormholeToken, privateWallet })
    // if(feeData.conversionRateInputs && feeData.conversionRateInputs.estimatedGasUsed === undefined ) {
    //     feeData.conversionRateInputs.estimatedGasUsed = feeData.conversionRateInputs.estimatedGasUsed ?? Number(await estimateGasUsage({wormholeToken, wallet:privateWallet.viem.wallet}))
    // }

    const conversionRate = feeData.conversionRateInputs ? BigInt(Math.round(feeData.conversionRateInputs.estimatedGasUsed * feeData.conversionRateInputs.tokenPriceInEth * feeData.conversionRateInputs.relayerBonusFactor)) : 0n;
    const unformattedProofInputs = await getUnformattedProofInputs({
        wormholeToken, privateWallet: syncedWallet, publicClient, amountToReMint: amount, recipient, feeData: {
            relayerAddress: feeData.relayerAddress,
            priorityFee: feeData.priorityFee,
            conversionRate: conversionRate,
            feeToken: wormholeToken.address,
            maxFee: feeData.maxFee 
        }
    })
    const formattedProofInputs = formatProofInputs(unformattedProofInputs)
    const zkProof = await generateProof({ proofInputs: formattedProofInputs, backend })
    const relayerInputs = {
        pubInputs: unformattedProofInputs.publicInputs,
        zkProof: zkProof
    }
    return relayerInputs as RelayerInputs
}

export async function relayTx({ relayerInputs, ethWallet, publicClient, wormholeToken }: { relayerInputs: RelayerInputs, ethWallet: WalletClient, publicClient: PublicClient, wormholeToken: WormholeToken | WormholeTokenTest }) {
    // set relayer address and check it
    let relayerAddress = relayerInputs.pubInputs.feeData.relayerAddress;
    const walletAddress = ethWallet.account?.address as Address//(await ethWallet.getAddresses())[0]
    relayerAddress = relayerAddress === zeroAddress ? walletAddress : relayerAddress
    if (relayerAddress !== walletAddress) {
        throw new Error(`you are not the relayer. You are: ${walletAddress} but the relayer is: ${relayerInputs.pubInputs.feeData.relayerAddress}`)
    }

    const wormholeTokenRelayer = getContract({ client: { public: publicClient, wallet: ethWallet }, abi: wormholeToken.abi, address: wormholeToken.address });
    const transactionInputs = getTransactionInputs({ pubProofInputs: relayerInputs.pubInputs, zkProof: relayerInputs.zkProof })
    return await wormholeTokenRelayer.write.privateTransfer(transactionInputs, { account: ethWallet.account?.address as Address, chain: publicClient.chain })
}

export async function proofAndSelfRelay(
    { wormholeToken, privateWallet, publicClient, amount, recipient, backend }:
        { wormholeToken: WormholeToken | WormholeTokenTest, privateWallet: SyncedPrivateWallet | UnsyncedPrivateWallet, publicClient: PublicClient, recipient: Address, amount: bigint, backend?: UltraHonkBackend }
) {
    const feeData = EMPTY_FEE_DATA;
    //feeData.feeToken = wormholeToken.address
    const ethWallet = privateWallet.viem.wallet
    const relayerInputs = await createRelayerInputs({ wormholeToken, privateWallet, publicClient, amount, recipient, feeData, backend })
    return await relayTx({ relayerInputs, ethWallet, publicClient, wormholeToken })
}

// export function convertRelayerInputsFromHex(relayerInputs:RelayerInputsHex):RelayerInputs {
//     return {
//         pubInputs:{
//                 amount: BigInt(relayerInputs.pubInputs.amount),
//                 signatureHash:BigInt(relayerInputs.pubInputs.signatureHash),
//                 recipientAddress: getAddress(relayerInputs.pubInputs.recipientAddress),
//                 feeData: {
//                     relayerAddress: getAddress(relayerInputs.pubInputs.feeData.relayerAddress),
//                     priorityFee: BigInt(relayerInputs.pubInputs.feeData.priorityFee),
//                     conversionRate: BigInt(relayerInputs.pubInputs.feeData.conversionRate),
//                     maxFee: BigInt(relayerInputs.pubInputs.feeData.maxFee),
//                     feeToken: getAddress(relayerInputs.pubInputs.feeData.feeToken),
//                 },
//                 accountNoteHash: BigInt(relayerInputs.pubInputs.accountNoteHash),
//                 accountNoteNullifier: BigInt(relayerInputs.pubInputs.accountNoteNullifier),
//                 root: BigInt(relayerInputs.pubInputs.root),
//         },
//         zkProof:{
//             proof: toBytes(relayerInputs.zkProof.proof),
//             publicInputs:relayerInputs.zkProof.publicInputs as string[]
//         }
//     }
// }

// export function convertRelayerInputsToHex(relayerInputs:RelayerInputs):RelayerInputsHex {
//     return {
//         pubInputs:{
//                 amount: toHex(relayerInputs.pubInputs.amount),
//                 recipientAddress: getAddress(relayerInputs.pubInputs.recipientAddress),
//                 signatureHash: toHex(relayerInputs.pubInputs.signatureHash),
//                 feeData: {
//                     relayerAddress: getAddress(relayerInputs.pubInputs.feeData.relayerAddress),
//                     priorityFee: toHex(relayerInputs.pubInputs.feeData.priorityFee),
//                     conversionRate: toHex(relayerInputs.pubInputs.feeData.conversionRate),
//                     maxFee: toHex(relayerInputs.pubInputs.feeData.maxFee),
//                     feeToken: getAddress(relayerInputs.pubInputs.feeData.feeToken),
//                 },
//                 accountNoteHash: toHex(relayerInputs.pubInputs.accountNoteHash),
//                 accountNoteNullifier: toHex(relayerInputs.pubInputs.accountNoteNullifier),
//                 root: toHex(relayerInputs.pubInputs.root),
//         },
//         zkProof:{
//             proof: toHex(relayerInputs.zkProof.proof),
//             publicInputs:relayerInputs.zkProof.publicInputs as Hex[]
//         }
//     }
// }


// This requires that account from FEE_ESTIMATOR_DATA had funds at one point and had the same root existed
// export async function estimateGasUsage({wormholeToken, wallet}:{wormholeToken:WormholeToken|WormholeTokenTest, wallet:WalletClient}) {
//     const relayerInputs = FEE_ESTIMATOR_DATA
//     relayerInputs.pubInputs.feeData.feeToken = wormholeToken.address
//     const rootNeeded = FEE_ESTIMATOR_DATA.pubInputs.root
//     const rootExist = Boolean(await wormholeToken.read.roots([rootNeeded]))
//     if (!rootExist) {throw new Error(`to estimate gas usage the contract needs to have root: ${rootNeeded}, but it was not found`) }
//     const txInputs = getTransactionInputs({ pubProofInputs: relayerInputs.pubInputs, zkProof: relayerInputs.zkProof })
//     const gas = await wormholeToken.estimateGas.privateTransfer(txInputs,{account: wallet.account?.address as Address})
//     return gas
// }