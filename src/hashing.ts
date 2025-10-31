import { Hex, Signature, recoverPublicKey, Account, hashMessage, hexToBigInt, hexToBytes, Hash, WalletClient } from "viem";
import { poseidon2Hash } from "@zkpassport/poseidon2"
import { FIELD_MODULUS, POW_DIFFICULTY, PRIVATE_ADDRESS_TYPE, VIEWING_KEY_SIG_MESSAGE } from "./constants.js";

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

export function hashPow({ pubKeyX, powNonce }: { pubKeyX: Hex, powNonce: bigint }) {
    const addressHash = hashAddress({ pubKeyX, powNonce })
    const powHash = poseidon2Hash([powNonce, addressHash]);
    return powHash
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

export async function getKeys({ wallet, message = VIEWING_KEY_SIG_MESSAGE }: { wallet: WalletClient & { account: Account }, message?: string }) {
    const signature = await wallet.signMessage({ message: message, account: wallet.account })
    const hash = hashMessage(message);
    const { pubKeyX, pubKeyY } = await extractPubKeyFromSig({ hash: hash, signature: signature })
    const viewingKey = getViewingKey({ signature: signature })
    const powNonce = findPoWNonce({ pubKeyX: pubKeyX, viewingKey: viewingKey })
    return { viewingKey, powNonce, pubKey: { x: pubKeyX, y: pubKeyY } }
}