import { Address, getAddress, getContract, Hex, PublicClient, toHex, WalletClient, zeroAddress } from "viem";
import { WormholeTokenTest } from "../test/Token.test.js";
import { RelayerInputs, SyncedPrivateWallet, UnformattedPublicProofInputs, UnsyncedPrivateWallet, WormholeToken } from "./types.js";
import { EMPTY_FEE_DATA, FEE_ESTIMATOR_DATA } from "./constants.js";
import { formatProofInputs, generateProof, getUnformattedProofInputs } from "./proving.js";
import { ProofData, UltraHonkBackend } from "@aztec/bb.js";
import { syncPrivateWallet } from "./syncing.js";

export function getTransactionInputs({ pubProofInputs, zkProof }: { zkProof: ProofData, pubProofInputs: UnformattedPublicProofInputs }) {
    const feeData = {
        relayerAddress: getAddress(pubProofInputs.feeData.relayerAddress),
        priorityFee: BigInt(pubProofInputs.feeData.priorityFee),
        conversionRate: BigInt(pubProofInputs.feeData.conversionRate),
        maxFee: BigInt(pubProofInputs.feeData.maxFee),
        feeToken: getAddress(pubProofInputs.feeData.feeToken)
    };

    const inputs: [bigint, Hex, typeof feeData, bigint, bigint, bigint, Hex] = [
        BigInt(pubProofInputs.amount),
        getAddress(pubProofInputs.recipientAddress),
        feeData,
        BigInt(pubProofInputs.accountNoteHash),
        BigInt(pubProofInputs.accountNoteNullifier),
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
        pubInputs: unformattedProofInputs.pubInputs,
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
    return await wormholeTokenRelayer.write.privateTransfer(transactionInputs, { account: ethWallet.account?.address, chain: publicClient.chain })
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

export function convertRelayerInputsJson(json:any):RelayerInputs {
    return {
        pubInputs:{
                amount: BigInt(json.pubInputs.amount),
                recipientAddress: getAddress(json.pubInputs.recipientAddress),
                feeData: {
                    relayerAddress: getAddress(json.pubInputs.feeData.relayerAddress),
                    priorityFee: BigInt(json.pubInputs.feeData.priorityFee),
                    conversionRate: BigInt(json.pubInputs.feeData.conversionRate),
                    maxFee: BigInt(json.pubInputs.feeData.maxFee),
                    feeToken: getAddress(json.pubInputs.feeData.feeToken),
                },
                accountNoteHash: BigInt(json.pubInputs.accountNoteHash),
                accountNoteNullifier: BigInt(json.pubInputs.accountNoteNullifier),
                root: BigInt(json.pubInputs.root),
        },
        zkProof:{
            proof: new Uint8Array(json.zkProof.proof),
            publicInputs:json.zkProof.publicInputs
        }
    }
}


// This requires that account from FEE_ESTIMATOR_DATA had funds at one point and had the same root existed
export async function estimateGasUsage({wormholeToken, wallet}:{wormholeToken:WormholeToken|WormholeTokenTest, wallet:WalletClient}) {
    const relayerInputs = FEE_ESTIMATOR_DATA
    relayerInputs.pubInputs.feeData.feeToken = wormholeToken.address
    const rootNeeded = FEE_ESTIMATOR_DATA.pubInputs.root
    const rootExist = Boolean(await wormholeToken.read.roots([rootNeeded]))
    if (!rootExist) {throw new Error(`to estimate gas usage the contract needs to have root: ${rootNeeded}, but it was not found`) }
    const txInputs = getTransactionInputs({ pubProofInputs: relayerInputs.pubInputs, zkProof: relayerInputs.zkProof })
    const gas = await wormholeToken.estimateGas.privateTransfer(txInputs,{account: wallet.account?.address as Address})
    return gas
}