import { Hex, Signature, recoverPublicKey, Account, hashMessage, hexToBigInt, hexToBytes, Hash, WalletClient, Address, toHex, getAddress } from "viem";
import { poseidon2Hash } from "@zkpassport/poseidon2"
import { FIELD_MODULUS, POW_DIFFICULTY, PRIVATE_ADDRESS_TYPE, TOTAL_RECEIVED_DOMAIN as TOTAL_RECEIVED_DOMAIN, TOTAL_SPENT_DOMAIN, VIEWING_KEY_SIG_MESSAGE } from "./constants.js";
import { FeeData } from "./types.js";

export function verifyPowNonce({ pubKeyX, powNonce, difficulty = POW_DIFFICULTY }: { pubKeyX: Hex, powNonce: bigint, difficulty?: bigint }) {
    const powHash = hashPow({ pubKeyX, powNonce });
    return powHash > difficulty
}

export async function extractPubKeyFromSig({ hash, signature }: { hash: Hash, signature: Signature | Hex }) {
    const publicKey = await recoverPublicKey({
        hash: hash,
        signature: signature
    });
    // first byte is cringe
    const pubKeyX = "0x" + publicKey.slice(4).slice(0, 64) as Hex
    const pubKeyY = "0x" + publicKey.slice(4).slice(64, 128) as Hex
    // const rawSigHex = signature.r + signature.s.slice(2)
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

export function hashAddress({ pubKeyX, powNonce }: { pubKeyX: Hex, powNonce: bigint }) {
    const pubKeyField = hexToBigInt(pubKeyX) % FIELD_MODULUS
    const addressHash = poseidon2Hash([pubKeyField, powNonce, PRIVATE_ADDRESS_TYPE]);
    return addressHash
}

export function getPrivateAddress({ pubKeyX, powNonce }: { pubKeyX: Hex, powNonce: bigint }) {
    const addressHash = hashAddress({ pubKeyX, powNonce })
    return getAddress(toHex(addressHash).slice(0, 2 + 40)) //slice off bytes and make it the address type in viem

}

export function hashPow({ pubKeyX, powNonce }: { pubKeyX: Hex, powNonce: bigint }) {
    const addressHash = hashAddress({ pubKeyX, powNonce })
    const powHash = poseidon2Hash([powNonce, addressHash]);
    return powHash
}

// account_nonce makes sure the hash is never the same even when the total_spent is not different
// secret is so others cant try and find the pre-image (since this hash is posted onchain)
export function hashAccountNote({ totalSpent, accountNonce, viewingKey }: { totalSpent: bigint, accountNonce: bigint, viewingKey: bigint }) {
    return poseidon2Hash([totalSpent, accountNonce, viewingKey, TOTAL_SPENT_DOMAIN])
}

// account_nonce makes sure the hash is never the same even when the total_spent is not different
// secret is so others cant try and find the pre-image (since this hash is posted onchain)
export function hashNullifier({ accountNonce, viewingKey }: { accountNonce: bigint, viewingKey: bigint }) {
    return poseidon2Hash([accountNonce, viewingKey])
}

export function hashTotalReceivedLeaf({ privateAddress, totalReceived }: { privateAddress: Address, totalReceived: bigint }) {
    return poseidon2Hash([hexToBigInt(privateAddress as Hex), totalReceived, TOTAL_RECEIVED_DOMAIN])
}

export function hashSignatureInputs({ recipientAddress, amount, feeData }: { recipientAddress: Address, amount: bigint, feeData: FeeData }) {
    return poseidon2Hash(
        [
            hexToBigInt(recipientAddress),
            amount,
            hexToBigInt(feeData.relayerAddress),
            feeData.priorityFee,
            feeData.conversionRate,
            feeData.maxFee,
        ],
    )
}

export function findPoWNonce({ pubKeyX, viewingKey, difficulty = POW_DIFFICULTY }: { pubKeyX: Hex, viewingKey: bigint, difficulty?: bigint }) {
    let powNonce: bigint = viewingKey;
    let powHash: bigint = hashPow({ pubKeyX, powNonce });
    let hashingRounds = 0
    console.log("doing PoW")
    do {
        if (powHash < difficulty) {
            break;
        }
        powNonce = powHash;
        powHash = hashPow({ pubKeyX, powNonce })
        hashingRounds += 1
    } while (powHash >= difficulty)
    return powNonce
}

export async function getPrivateAccount({ wallet, message = VIEWING_KEY_SIG_MESSAGE }: { wallet: WalletClient & { account: Account }, message?: string }) {
    const signature = await wallet.signMessage({ message: message, account: wallet.account })
    const hash = hashMessage(message);
    const { pubKeyX, pubKeyY } = await extractPubKeyFromSig({ hash: hash, signature: signature })
    const viewingKey = getViewingKey({ signature: signature })
    const powNonce = findPoWNonce({ pubKeyX: pubKeyX, viewingKey: viewingKey })
    const burnAddress = getPrivateAddress({ pubKeyX: pubKeyX, powNonce: powNonce })
    const accountNonceStart = 0n
    return { viewingKey, powNonce, pubKey: { x: pubKeyX, y: pubKeyY }, burnAddress, accountNonceStart }
}

export async function signPrivateTransfer({ recipientAddress, amount, feeData, wallet }: { wallet: WalletClient & { account: Account }, recipientAddress: Address, amount: bigint, feeData: FeeData }) {
    const hash = toHex(hashSignatureInputs({ recipientAddress, amount, feeData }))
    // blind signing yay!
    const signature = await wallet.request({
        method: 'eth_sign',
        params: [wallet.account.address as Hex, hash],
    });
    const publicKey = await recoverPublicKey({
        hash: hash,
        signature: signature
    });
    // first byte is cringe
    const pubKeyXHex = "0x" + publicKey.slice(4).slice(0, 64) as Hex
    const pubKeyYHex = "0x" + publicKey.slice(4).slice(64, 128) as Hex
    return {
        publicKeyX: pubKeyXHex,
        publicKeyY: pubKeyYHex,
        signature: signature
    }
}