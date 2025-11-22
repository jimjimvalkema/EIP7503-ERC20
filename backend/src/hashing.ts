import { Hex, Signature, recoverPublicKey, Account, hashMessage, hexToBigInt, hexToBytes, Hash, WalletClient, Address, toHex, getAddress, keccak256, toPrefixedMessage, encodePacked, padHex } from "viem";
import { poseidon2Hash } from "@zkpassport/poseidon2"
import { POW_DIFFICULTY, PRIVATE_ADDRESS_TYPE, TOTAL_RECEIVED_DOMAIN as TOTAL_RECEIVED_DOMAIN, TOTAL_SPENT_DOMAIN, VIEWING_KEY_SIG_MESSAGE } from "./constants.js";
import { FeeData, SignatureData, SyncedPrivateWallet, UnsyncedPrivateWallet } from "./types.js";
export function verifyPowNonce({ pubKeyX, sharedSecret, difficulty = POW_DIFFICULTY }: { pubKeyX: Hex, sharedSecret: bigint, difficulty?: bigint }) {
    const powHash = hashPow({ pubKeyX, sharedSecret });
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

export function hashAddress({ pubKeyX, sharedSecret }: { pubKeyX: Hex, sharedSecret: bigint }) {
    const pubKeyField = hexToBigInt("0x" + pubKeyX.slice(2 + 2) as Hex) //slice first byte so it fits in a field
    const addressHash = poseidon2Hash([pubKeyField, sharedSecret, PRIVATE_ADDRESS_TYPE]);
    return addressHash
}

export function getPrivateAddress({ pubKeyX, sharedSecret }: { pubKeyX: Hex, sharedSecret: bigint }) {
    const addressHash = hashAddress({ pubKeyX, sharedSecret })
    return getAddress("0x" + toHex(addressHash, { size: 32 }).slice(2 + 24)) //slice off bytes and make it the address type in viem

}

export function hashPow({ pubKeyX, sharedSecret }: { pubKeyX: Hex, sharedSecret: bigint }) {
    const addressHash = hashAddress({ pubKeyX, sharedSecret })
    const powHash = poseidon2Hash([sharedSecret, addressHash]);
    return powHash
}

// prev_account_nonce makes sure the hash is never the same even when the total_spent is not different
// secret is so others cant try and find the pre-image (since this hash is posted onchain)
export function hashAccountNote({ totalSpent, accountNonce, viewingKey }: { totalSpent: bigint, accountNonce: bigint, viewingKey: bigint }) {
    return poseidon2Hash([totalSpent, accountNonce, viewingKey, TOTAL_SPENT_DOMAIN])
}

// prev_account_nonce makes sure the hash is never the same even when the total_spent is not different
// secret is so others cant try and find the pre-image (since this hash is posted onchain)
export function hashNullifier({ accountNonce, viewingKey }: { accountNonce: bigint, viewingKey: bigint }) {
    return poseidon2Hash([accountNonce, viewingKey])
}

export function hashTotalReceivedLeaf({ privateAddress, totalReceived }: { privateAddress: Address, totalReceived: bigint }) {
    return poseidon2Hash([hexToBigInt(privateAddress as Hex), totalReceived, TOTAL_RECEIVED_DOMAIN])
}


export function hashSignatureInputs({ recipientAddress, amount, feeData }: { recipientAddress: Address, amount: bigint, feeData: FeeData }) {
    const keccakHash = keccak256(
        encodePacked(
            ['uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
            [
                BigInt(recipientAddress),                    
                amount,                            
                BigInt(feeData.relayerAddress),  
                feeData.priorityFee,    
                feeData.conversionRate, 
                feeData.maxFee,         
            ]
        )
    )
    //console.log({keccakHash, len:( keccakHash.length - 2)/2})
    return keccakHash
}

export function findPoWNonce({ pubKeyX, viewingKey, difficulty = POW_DIFFICULTY }: { pubKeyX: Hex, viewingKey: bigint, difficulty?: bigint }) {
    let sharedSecret: bigint = viewingKey;
    let powHash: bigint = hashPow({ pubKeyX, sharedSecret });
    let hashingRounds = 0
    console.log("doing PoW")
    do {
        if (powHash < difficulty) {
            break;
        }
        sharedSecret = powHash;
        powHash = hashPow({ pubKeyX, sharedSecret })
        hashingRounds += 1
    } while (powHash >= difficulty)
    return sharedSecret
}

export async function getPrivateAccount({ wallet, sharedSecret, message = VIEWING_KEY_SIG_MESSAGE }: { wallet: WalletClient,sharedSecret:bigint , message?: string }): Promise<UnsyncedPrivateWallet> {
    //console.log(wallet.account?.address, "a")
    const signature = await wallet.signMessage({ message: message, account: wallet.account?.address as Address })
    const hash = hashMessage(message);
    const { pubKeyX, pubKeyY } = await extractPubKeyFromSig({ hash: hash, signature: signature })
    const viewingKey = getViewingKey({ signature: signature })
    const burnAddress = getPrivateAddress({ pubKeyX: pubKeyX, sharedSecret: sharedSecret })
    const accountNonce = 0n
    return { viem: { wallet }, viewingKey, sharedSecret, pubKey: { x: pubKeyX, y: pubKeyY }, burnAddress, accountNonce }
}

export async function signPrivateTransfer({ recipientAddress, amount, feeData, privateWallet }: { privateWallet: UnsyncedPrivateWallet | SyncedPrivateWallet, recipientAddress: Address, amount: bigint, feeData: FeeData }) {
    const sigHash = hashSignatureInputs({ recipientAddress, amount, feeData })
    //console.log({sigHash})
    // blind signing yay!
    // const signature = await privateWallet.viem.wallet.request({
    //     method: 'eth_sign',
    //     params: [(privateWallet.viem.wallet.account?.address as Address), poseidonHash],
    // });
    const signature = await privateWallet.viem.wallet.signMessage({ message: { raw: sigHash }, account: privateWallet.viem.wallet.account as Account })
    const preImageOfKeccak = toPrefixedMessage({ raw: sigHash })
    const KeccakWrappedPoseidonHash = keccak256(preImageOfKeccak);

    const { pubKeyX, pubKeyY } = await extractPubKeyFromSig({ hash: KeccakWrappedPoseidonHash, signature: signature })
    // const pubKeyXHex = "0x" + publicKey.slice(4).slice(0, 64) as Hex
    // const pubKeyYHex = "0x" + publicKey.slice(4).slice(64, 128) as Hex
    return {
        signatureData: {
            publicKeyX: pubKeyX,
            publicKeyY: pubKeyY,
            signature: signature,
        } as SignatureData,
        signatureHash: hexToBigInt(KeccakWrappedPoseidonHash),
        poseidonHash: sigHash,
        preImageOfKeccak: preImageOfKeccak
    }

}