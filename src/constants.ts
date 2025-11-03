import { getAddress, padHex } from "viem";
import { FeeData } from "./types.js";

export const TOTAL_RECEIVED_DOMAIN = 0x52454345495645445F544F54414Cn; // UTF8("total_received").toHex()
export const TOTAL_SPENT_DOMAIN = 0x5350454E545F544F54414Cn; // UTF8("total_spent").toHex()
export const PRIVATE_ADDRESS_TYPE = 0x5a4b574f524d484f4c45n; //"0x" + [...new TextEncoder().encode("zkwormhole")].map(b=>b.toString(16)).join('') as Hex
export const FIELD_LIMIT = 21888242871839275222246405745257275088548364400416034343698204186575808495616n;
export const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
export const POW_LEADING_ZEROS = 3n;
export const POW_DIFFICULTY = 16n ** (64n - POW_LEADING_ZEROS) - 1n;
export const MAX_TREE_DEPTH = 40;

export const WORMHOLE_TOKEN_DEPLOYMENT_BLOCK: { [chainId: number]: bigint; } = {

}

export const VIEWING_KEY_SIG_MESSAGE = `
You are about to create your viewing key for your zkwormhole account! \n
Yay! :D Becarefull signing this on untrusted websites.
Here is some salt: TODO
`

export const zeroAddress = getAddress(padHex("0x00", { size: 20 }))
export const SELF_RELAY_FEE_DATA: FeeData = {
    relayerAddress: zeroAddress,
    priorityFee: 0n,
    conversionRate: 0n,
    maxFee: 0n,
    feeToken: zeroAddress,
}