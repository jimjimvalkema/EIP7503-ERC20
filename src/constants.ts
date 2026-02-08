import { getAddress, Hex, padHex, toHex } from "viem";
import { MerkleData, RelayerInputs, u1AsHexArr, u32AsHex } from "./types.js";
import feeEstimatorRelayerData from "./feeEstimatorRelayerData.json"
import { formatMerkleProof } from "./proving.js";
import { LeanIMTMerkleProof } from "@zk-kit/lean-imt";
//import { convertRelayerInputsToHex } from "./transact.js";

export const WormholeTokenContractName = "WormholeToken"
export const leanIMTPoseidon2ContractName = "leanIMTPoseidon2"
export const PrivateTransfer1InVerifierContractName = "privateTransfer1InVerifier"
export const PrivateTransfer4InVerifierContractName = "privateTransfer4InVerifier"
export const ZKTranscriptLibContractName = "contracts/privateTransfer1InVerifier.sol:ZKTranscriptLib"

export const PRIVATE_ADDRESS_TYPE = 0x5a4b574f524d484f4c45n; //"0x" + [...new TextEncoder().encode("ZKWORMHOLE")].map(b=>b.toString(16)).join('') as Hex
export const TOTAL_BURNED_DOMAIN = 0x544f54414c5f4255524e4544n; // UTF8("TOTAL_BURNED").toHex()
export const TOTAL_SPENT_DOMAIN = 0x544f54414c5f5350454e44n; // UTF8("TOTAL_SPEND").toHex()
export const FIELD_LIMIT = 21888242871839275222246405745257275088548364400416034343698204186575808495616n;
export const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
export const POW_LEADING_ZEROS = 3n;
export const POW_DIFFICULTY = 16n ** (64n - POW_LEADING_ZEROS) - 1n;
export const MAX_TREE_DEPTH = 40 as const;

export const WORMHOLE_TOKEN_DEPLOYMENT_BLOCK: { [chainId: number]: bigint; } = {
    11155111: 9580647n // https://sepolia.etherscan.io/tx/0xa44da9f1f6f627b0cb470386a7fc08c01b06dd28b665c7f6e133895c17d1343a
}

export const VIEWING_KEY_SIG_MESSAGE = `
You are about to create your viewing key for your zkwormhole account! \n
Yay! :D Becarefull signing this on untrusted websites.
Here is some salt: TODO
`

export const EMPTY_UNFORMATTED_MERKLE_PROOF: LeanIMTMerkleProof<bigint> = {
    root: 0n,
    leaf: 0n,
    index: 0,
    siblings: [], 
}


export const EMPTY_MERKLE_PROOF: MerkleData = formatMerkleProof(EMPTY_UNFORMATTED_MERKLE_PROOF,MAX_TREE_DEPTH)

export const zeroAddress = getAddress(padHex("0x00", { size: 20 }))
// export const EMPTY_FEE_DATA: FeeData = {
//     relayerAddress: zeroAddress,
//     priorityFee: 0n,
//     conversionRate: 0n,
//     maxFee: 0n,
//     feeToken: zeroAddress,
// }

//export const FEE_ESTIMATOR_DATA:RelayerInputsHex = convertRelayerInputsToHex(feeEstimatorRelayerData as RelayerInputs)