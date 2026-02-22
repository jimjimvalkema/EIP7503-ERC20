import type { Address } from "viem";
import { getAddress, padHex } from "viem"
import type { LeanIMTMerkleProof } from "@zk-kit/lean-imt";
//import { convertRelayerInputsToHex } from "./transact.js";

export const WormholeTokenContractName = "WormholeToken"
export const leanIMTPoseidon2ContractName = "leanIMTPoseidon2"
export const PrivateTransfer2InVerifierContractName = "privateTransfer2InVerifier"
export const PrivateTransfer100InVerifierContractName = "privateTransfer100InVerifier"
export const ZKTranscriptLibContractName100in = "contracts/privateTransfer100InVerifier.sol:ZKTranscriptLib"
export const ZKTranscriptLibContractName2in = "contracts/privateTransfer2InVerifier.sol:ZKTranscriptLib"

export const PRIVATE_ADDRESS_TYPE = 0x5a4b574f524d484f4c45n; //"0x" + [...new TextEncoder().encode("ZKWORMHOLE")].map(b=>b.toString(16)).join('') as Hex
export const TOTAL_BURNED_DOMAIN = 0x544f54414c5f4255524e4544n; // UTF8("TOTAL_BURNED").toHex()
export const TOTAL_SPENT_DOMAIN = 0x544f54414c5f5350454e44n; // UTF8("TOTAL_SPEND").toHex()
// @TODO double check this field limit. Should be fine but claude gave me a different number
export const FIELD_LIMIT = 21888242871839275222246405745257275088548364400416034343698204186575808495616n;
export const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
export const POW_LEADING_ZEROS = 4n;
export const POW_DIFFICULTY = 16n ** (64n - POW_LEADING_ZEROS) - 1n;

export const MAX_TREE_DEPTH = 44 as const;
export const ENCRYPTED_TOTAL_SPENT_PADDING = 256 // leaving some space for other things. Fits about 3 other key value pairs
export const EAS_BYTE_LEN_OVERHEAD = 28

export const WORMHOLE_TOKEN_DEPLOYMENT_BLOCK: { [chainId: number]: bigint; } = {
    11155111: 9580647n // https://sepolia.etherscan.io/tx/0xa44da9f1f6f627b0cb470386a7fc08c01b06dd28b665c7f6e133895c17d1343a
}

// should always be sorted
export const CIRCUIT_SIZES = [2,100];
export const LARGEST_CIRCUIT_SIZE = CIRCUIT_SIZES[CIRCUIT_SIZES.length-1]
export const VIEWING_KEY_SIG_MESSAGE = `
You are about to create your viewing key for your zkwormhole account! \n
Signing this on compromised site will result in leaking all private data. But *not* loss of funds.
So please double check the url! 
`

export const EMPTY_UNFORMATTED_MERKLE_PROOF: LeanIMTMerkleProof<bigint> = {
    root: 0n,
    leaf: 0n,
    index: 0,
    siblings: [], 
}

export const zeroAddress = getAddress(padHex("0x00", { size: 20 }))


const PRIVATE_RE_MINT_DOMAIN_NAME = "zkwormholes-token" as const;
const PRIVATE_RE_MINT_VERSION = "1"

export function getPrivateReMintDomain(chainId:number, verifyingContract:Address) {
    return {
        name: PRIVATE_RE_MINT_DOMAIN_NAME,
        version: PRIVATE_RE_MINT_VERSION,
        chainId: chainId,
        verifyingContract: verifyingContract,
    } as const;
}

export const PRIVATE_RE_MINT_712_TYPES = {
    privateReMint: [
        { name: "_recipient", type: "address" },
        { name: "_amount", type: "uint256" },
        { name: "_callData", type: "bytes" },
        { name: "_callCanFail", type: "bool" },
        { name: "_callValue", type: "uint256" },
        { name: "_encryptedTotalSpends", type: "bytes[]" },
    ],
} as const;

export const PRIVATE_RE_MINT_RELAYER_712_TYPES = {
    privateReMintRelayer: [
        { name: "_recipient", type: "address" },
        { name: "_amount", type: "uint256" },
        { name: "_callData", type: "bytes" },
        { name: "_callCanFail", type: "bool" },
        { name: "_callValue", type: "uint256" },
        { name: "_encryptedTotalSpends", type: "bytes[]" },
        { name: "_feeData", type: "FeeData" },
    ],
    FeeData: [
        { name: "tokensPerEthPrice", type: "uint256" },
        { name: "maxFee", type: "uint256" },
        { name: "amountForRecipient", type: "uint256" },
        { name: "relayerBonus", type: "uint256"},
        { name: "estimatedGasCost", type: "uint256" },
        { name: "estimatedPriorityFee", type: "uint256" },
        { name: "refundAddress", type: "address" },
        { name: "relayerAddress", type: "address" },
    ],
} as const;