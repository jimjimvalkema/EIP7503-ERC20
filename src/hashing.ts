import { Hex, Signature, recoverPublicKey, Account, hashMessage, hexToBigInt, hexToBytes, Hash, WalletClient, Address, toHex, getAddress, keccak256, toPrefixedMessage, encodePacked, padHex } from "viem";
import { poseidon2Hash } from "@zkpassport/poseidon2"
import { POW_DIFFICULTY, PRIVATE_ADDRESS_TYPE, TOTAL_RECEIVED_DOMAIN as TOTAL_RECEIVED_DOMAIN, TOTAL_SPENT_DOMAIN, VIEWING_KEY_SIG_MESSAGE } from "./constants.js";
import { FeeData, SignatureData, u8sAsHexArrLen32, u8sAsHexArrLen64 } from "./types.js";
import {PrivateWallet} from "./PrivateWallet.js"
export function verifyPowNonce({ pubKeyX, blindingPow, difficulty = POW_DIFFICULTY }: { pubKeyX: Hex, blindingPow: bigint, difficulty?: bigint }) {
    const powHash = hashPow({ pubKeyX, blindingPow });
    return powHash > difficulty
}

export async function extractPubKeyFromSig({ hash, signature }: { hash: Hash, signature: Signature | Hex }) {
    const publicKey = await recoverPublicKey({
        hash: hash,
        signature: signature
    });
    const pubKeyX = "0x" + publicKey.slice(4).slice(0, 64) as Hex
    const pubKeyY = "0x" + publicKey.slice(4).slice(64, 128) as Hex
    return { pubKeyX, pubKeyY }
}

export function getViewingKey({ signature }: { signature: Hex }) {
    // deterministically create a viewing key from a signature
    // sigR is split in 2 and hashed since it can be larger then the field limit (could do modulo but didn't feel like worrying about bias)
    const sigR = signature.slice(0, 2 + 128)
    const sigRLow = hexToBigInt(sigR.slice(0, 2 + 32) as Hex)
    const sigRHigh = hexToBigInt("0x" + sigR.slice(2 + 32, 2 + 64) as Hex)
    const viewingKey = poseidon2Hash([sigRLow, sigRHigh])
    return viewingKey
}

export function hashAddress({ pubKeyX, blindingPow }: { pubKeyX: Hex, blindingPow: bigint }) {
    const pubKeyField = hexToBigInt("0x" + pubKeyX.slice(2 + 2) as Hex) //slice first byte so it fits in a field
    const addressHash = poseidon2Hash([pubKeyField, blindingPow, PRIVATE_ADDRESS_TYPE]);
    return addressHash
}

export function getBurnAddress({ pubKeyX, blindingPow }: { pubKeyX: Hex, blindingPow: bigint }) {
    const addressHash = hashAddress({ pubKeyX, blindingPow })
    return getAddress("0x" + toHex(addressHash, { size: 32 }).slice(2 + 24)) //slice off bytes and make it the address type in viem

}

export function hashPow({ pubKeyX, blindingPow }: { pubKeyX: Hex, blindingPow: bigint }) {
    const addressHash = hashAddress({ pubKeyX, blindingPow })
    const powHash = poseidon2Hash([blindingPow, addressHash]);
    return powHash
}

// prev_account_nonce makes sure the hash is never the same even when the total_spent is not different
// secret is so others cant try and find the pre-image (since this hash is posted onchain)
export function hashTotalSpentLeaf({ totalSpent, accountNonce, viewingKey }: { totalSpent: bigint, accountNonce: bigint, viewingKey: bigint }) {
    return poseidon2Hash([totalSpent, accountNonce, viewingKey, TOTAL_SPENT_DOMAIN])
}

// prev_account_nonce makes sure the hash is never the same even when the total_spent is not different
// secret is so others cant try and find the pre-image (since this hash is posted onchain)
export function hashNullifier({ accountNonce, viewingKey }: { accountNonce: bigint, viewingKey: bigint }) {
    return poseidon2Hash([accountNonce, viewingKey])
}

export function hashTotalBurnedLeaf({  burnAddress, totalBurned }: { burnAddress: Address, totalBurned: bigint }) {
    return poseidon2Hash([hexToBigInt(burnAddress as Hex), totalBurned, TOTAL_RECEIVED_DOMAIN])
}


export function hashSignatureInputs({ recipientAddress, amount, callData }: { recipientAddress: Address, amount: bigint, callData: Hex }) {
    const keccakHash = keccak256(
        encodePacked(
            ['address', 'uint256', 'bytes'],
            [recipientAddress, amount, callData]
        )
    )
    //console.log({keccakHash, len:( keccakHash.length - 2)/2})
    return keccakHash
}

export function findPoWNonce({ pubKeyX, startingValue, difficulty = POW_DIFFICULTY }: { pubKeyX: Hex, startingValue: bigint, difficulty?: bigint }) {
    let blindingPow: bigint = startingValue;
    let powHash: bigint = hashPow({ pubKeyX, blindingPow });
    let hashingRounds = 0
    console.log("doing PoW")
    do {
        if (powHash < difficulty) {
            break;
        }
        blindingPow = powHash;
        powHash = hashPow({ pubKeyX, blindingPow })
        hashingRounds += 1
    } while (powHash >= difficulty)
    return blindingPow
}

export async function signPrivateTransfer({ recipientAddress, amount,callData, privateWallet }: { privateWallet: PrivateWallet, recipientAddress: Address, amount: bigint, callData: Hex}):
Promise<{ viemFormatSignature: { signature: Hex; pubKeyX: Hex; pubKeyY: Hex; }, signatureData:SignatureData, signatureHash:Hex ,poseidonHash:Hex,  preImageOfKeccak:Hex}> {
    const sigHash = hashSignatureInputs({ recipientAddress, amount, callData })
    //console.log({sigHash})
    // blind signing yay!
    // const signature = await privateWallet.viem.wallet.request({
    //     method: 'eth_sign',
    //     params: [(privateWallet.viem.wallet.account?.address as Address), poseidonHash],
    // });

    //@notice i force viem to sign with the eth account that privateWallet expects, not the main account selected by the user. Always do that and do not!!: `WalletClient.account?.address`
    const signature = await privateWallet.viemWallet.signMessage({ message: { raw: sigHash }, account: privateWallet.privateData.ethAccount })
    const preImageOfKeccak = toPrefixedMessage({ raw: sigHash })
    const KeccakWrappedPoseidonHash = keccak256(preImageOfKeccak);

    const { pubKeyX, pubKeyY } = await extractPubKeyFromSig({ hash: KeccakWrappedPoseidonHash, signature: signature })
    // const pubKeyXHex = "0x" + publicKey.slice(4).slice(0, 64) as Hex
    // const pubKeyYHex = "0x" + publicKey.slice(4).slice(64, 128) as Hex
    return {
        viemFormatSignature: {signature, pubKeyX, pubKeyY},
        signatureData: {
            public_key_x: hexToByteArray(pubKeyX) as u8sAsHexArrLen32,
            public_key_y: hexToByteArray(pubKeyY) as u8sAsHexArrLen32,
            signature: hexToByteArray(signature) as u8sAsHexArrLen64,
        },
        signatureHash: KeccakWrappedPoseidonHash,
        poseidonHash: sigHash,
        preImageOfKeccak: preImageOfKeccak
    }

}

function hexToByteArray(hex: Hex): Hex[] {
  // Remove '0x' prefix and split into pairs of characters
  const hexWithoutPrefix = hex.slice(2)
  const bytes: Hex[] = []

  for (let i = 0; i < hexWithoutPrefix.length; i += 2) {
    bytes.push(`0x${hexWithoutPrefix.slice(i, i + 2)}` as Hex)
  }

  return bytes
}