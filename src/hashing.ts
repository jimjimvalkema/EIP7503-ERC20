import type { Hex, Signature, Account, Hash, WalletClient, Address, } from "viem";
import { recoverPublicKey, hashMessage, hexToBigInt, hexToBytes, toHex, getAddress, keccak256, toPrefixedMessage, encodePacked, padHex, bytesToHex, hashTypedData } from "viem";
import { poseidon2Hash } from "@zkpassport/poseidon2"
import { EAS_BYTE_LEN_OVERHEAD, ENCRYPTED_TOTAL_SPENT_PADDING, getPrivateReMintDomain, POW_DIFFICULTY, PRIVATE_ADDRESS_TYPE, PRIVATE_RE_MINT_712_TYPES, PRIVATE_RE_MINT_RELAYER_712_TYPES, TOTAL_BURNED_DOMAIN as TOTAL_BURNED_DOMAIN, TOTAL_SPENT_DOMAIN, VIEWING_KEY_SIG_MESSAGE } from "./constants.ts";
import type { FeeData, SignatureData, SignatureInputs, SignatureInputsWithFee, u8AsHex, u8sAsHexArrLen32, u8sAsHexArrLen64 } from "./types.ts";
import { PrivateWallet } from "./PrivateWallet.ts"
import { padArray } from "./proving.ts";
import { encryptTotalSpend } from "./syncing.ts";
import { Fr } from "@aztec/aztec.js";

/**
 * TODO support browser and more common node environments
 * @param param0 
 * @returns 
 */
export async function findPoWNonceAsync({
    blindedAddressDataHash,
    startingValue,
    difficulty = POW_DIFFICULTY,
}: {
    blindedAddressDataHash: bigint;
    startingValue: bigint;
    difficulty: bigint;
}): Promise<bigint> {
    const params = { blindedAddressDataHash, startingValue, difficulty };
    const isNode = typeof process !== "undefined" && process.versions != null && process.versions.node != null;
    if (isNode) {
        // node worker thread
        const { Worker } = await import("worker_threads");
        return new Promise((resolve, reject) => {
            const worker = new Worker(
                new URL("workers/findPowNonce.node.ts", import.meta.url),
                {
                    workerData: params,
                    execArgv: ["--import", "tsx"],
                },
            );
            worker.on("message", resolve);
            worker.on("error", reject);
            worker.on("exit", (code) => {
                if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
            });
        });
    } else {
        // browser worker
        return new Promise((resolve, reject) => {
            const worker = new Worker(
                new URL("workers/findPowNonce.browser.js", import.meta.url),
                { type: "module" },
            );
            worker.onmessage = (e) => {
                resolve(e.data);
                worker.terminate();
            };
            worker.onerror = (e) => reject(e);
            worker.postMessage(params);
        });
    }
}

export function verifyPowNonce({ blindedAddressDataHash, powNonce, difficulty = POW_DIFFICULTY }: { blindedAddressDataHash: bigint, powNonce: bigint, difficulty?: bigint }) {
    const powHash = hashPow({ blindedAddressDataHash, powNonce });
    return powHash < difficulty
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

export function hashBlindedAddressData(
    { spendingPubKeyX, viewingKey, chainId }:
        { spendingPubKeyX: Hex, viewingKey: bigint, chainId: bigint, }
): bigint {
    //slice first byte so it fits in a field
    const spendingPubKeyXField = hexToBigInt("0x" + spendingPubKeyX.slice(2 + 2) as Hex)
    //const viewingKeyField = hexToBigInt("0x" + viewingKey.slice(2 + 2) as Hex)
    const blindedAddressDataHash = poseidon2Hash([spendingPubKeyXField, viewingKey, chainId]);
    return blindedAddressDataHash
}

export function hashAddress({ blindedAddressDataHash, powNonce }: { blindedAddressDataHash: bigint, powNonce: bigint }) {
    //const pubKeyField = hexToBigInt("0x" + pubKeyX.slice(2 + 2) as Hex) //slice first byte so it fits in a field
    const addressHash = poseidon2Hash([blindedAddressDataHash, powNonce, PRIVATE_ADDRESS_TYPE]);
    return addressHash
}

export function getBurnAddressSafe({ blindedAddressDataHash, powNonce, difficulty = POW_DIFFICULTY }: { blindedAddressDataHash: bigint, powNonce: bigint, difficulty: bigint }) {
    const addressHash = hashAddress({ blindedAddressDataHash, powNonce })
    const powHash = poseidon2Hash([powNonce, addressHash]);
    if (powHash < difficulty === false) {
        throw new Error(`
Invalid powNonce. 
powNonce:${toHex(powNonce, { size: 32 })} 
blindedAddressDataHash: ${toHex(blindedAddressDataHash, { size: 32 })}
results in a PoW hash of: ${toHex(powHash, { size: 32 })}
    `)
    }
    return getAddress("0x" + toHex(addressHash, { size: 32 }).slice(2 + 24)) //slice off bytes and make it the address type in viem
}

export function getBurnAddress({ blindedAddressDataHash, powNonce }: { blindedAddressDataHash: bigint, powNonce: bigint }) {
    const addressHash = hashAddress({ blindedAddressDataHash, powNonce })
    return getAddress("0x" + toHex(addressHash, { size: 32 }).slice(2 + 24)) //slice off bytes and make it the address type in viem
}

export function hashPow({ blindedAddressDataHash, powNonce }: { blindedAddressDataHash: bigint, powNonce: bigint }) {
    const addressHash = hashAddress({ blindedAddressDataHash, powNonce })
    const powHash = poseidon2Hash([powNonce, addressHash]);
    return powHash
}

// prev_account_nonce makes sure the hash is never the same even when the total_spent is not different
// secret is so others cant try and find the pre-image (since this hash is posted onchain)
export function hashTotalSpentLeaf({ totalSpent, accountNonce, blindedAddressDataHash, viewingKey }: { totalSpent: bigint, accountNonce: bigint, blindedAddressDataHash: bigint, viewingKey: bigint }) {
    return poseidon2Hash([totalSpent, accountNonce, blindedAddressDataHash, viewingKey, TOTAL_SPENT_DOMAIN])
}

// prev_account_nonce makes sure the hash is never the same even when the total_spent is not different
// secret is so others cant try and find the pre-image (since this hash is posted onchain)
export function hashNullifier({ accountNonce, viewingKey }: { accountNonce: bigint, viewingKey: bigint }) {
    return poseidon2Hash([accountNonce, viewingKey])
}

export function hashTotalBurnedLeaf({ burnAddress, totalBurned }: { burnAddress: Address, totalBurned: bigint }) {
    return poseidon2Hash([hexToBigInt(burnAddress as Hex), totalBurned, TOTAL_BURNED_DOMAIN])
}


export function padWithRandomHex({ arr, len, hexSize, dir }: { arr: Hex[], len: number, hexSize: number, dir: 'left' | 'right' }): Hex[] {
    const padding = Array.from({ length: len - arr.length }, () =>
        bytesToHex(crypto.getRandomValues(new Uint8Array(hexSize)))
    )
    return dir === 'left' ? [...padding, ...arr] : [...arr, ...padding]
}

// export function hashSignatureInputs(signatureInputs: SignatureInputs, encryptedBlobPlainTextSize=ENCRYPTED_TOTAL_SPENT_PADDING) {
//     const encryptedBlobLen = encryptedBlobPlainTextSize + EAS_BYTE_LEN_OVERHEAD
//     if (signatureInputs.encryptedTotalSpends.length <= 2) {
//         signatureInputs.encryptedTotalSpends = padWithRandomHex({arr:signatureInputs.encryptedTotalSpends, len:2, hexSize:encryptedBlobLen, dir:"right"})
//         return keccak256(
//             encodePacked(
//                 ['address', 'uint256', 'bytes','bytes','bytes'],
//                 [signatureInputs.recipient, signatureInputs.amount, signatureInputs.callData, signatureInputs.encryptedTotalSpends[0], signatureInputs.encryptedTotalSpends[1]]
//             ))

//     } else if (signatureInputs.encryptedTotalSpends.length <= 4) {
//         signatureInputs.encryptedTotalSpends = padWithRandomHex({arr:signatureInputs.encryptedTotalSpends, len:4, hexSize:encryptedBlobLen, dir:"right"})
//         return keccak256(
//             encodePacked(
//                 ['address', 'uint256', 'bytes', 'bytes', 'bytes', 'bytes', 'bytes'],
//                 [signatureInputs.recipient, signatureInputs.amount, signatureInputs.callData, signatureInputs.encryptedTotalSpends[0], signatureInputs.encryptedTotalSpends[1], signatureInputs.encryptedTotalSpends[2], signatureInputs.encryptedTotalSpends[3]]
//             ))
//     }
//     else {
//         throw new Error("amount of encryptedTotalSpends not supported")
//     }
// }

export function findPoWNonce({ blindedAddressDataHash, startingValue, difficulty = POW_DIFFICULTY }: { blindedAddressDataHash: bigint, startingValue: bigint, difficulty?: bigint }) {
    let powNonce: bigint = startingValue;
    let powHash: bigint = hashPow({ blindedAddressDataHash, powNonce });
    let hashingRounds = 0
    const start = Date.now()
    console.log(`doing PoW. difficulty:${toHex(difficulty, { size: 32 })}`)
    do {
        if (powHash < difficulty) {
            break;
        }
        powNonce = powHash;
        powHash = hashPow({ blindedAddressDataHash, powNonce })
        hashingRounds += 1
    } while (powHash >= difficulty)
    console.log(`
found powNonce:${toHex(powNonce, { size: 32 })} 
with blindedAddressDataHash:${toHex(blindedAddressDataHash, { size: 32 })}, 
did ${hashingRounds} hashing rounds. 
It took ${Date.now() - start}ms
    `)
    return powNonce
}

export async function signPrivateTransfer({ privateWallet, signatureInputs, chainId, tokenAddress }: { privateWallet: PrivateWallet, signatureInputs: SignatureInputs, chainId: number, tokenAddress: Address }):
    Promise<{ viemFormatSignature: { signature: Hex; pubKeyX: Hex; pubKeyY: Hex; }, signatureData: SignatureData, signatureHash: Hex }> {
    chainId ??= await privateWallet.viemWallet.getChainId()

    const message = {
        _recipient: signatureInputs.recipient,
        _amount: BigInt(signatureInputs.amountToReMint),
        _callData: signatureInputs.callData,
        _callCanFail: signatureInputs.callCanFail,
        _callValue: BigInt(signatureInputs.callValue),
        _encryptedTotalSpends: signatureInputs.encryptedTotalSpends,
    };

    // The digest — same hash the contract produces via _hashTypedDataV4
    const domain = getPrivateReMintDomain(chainId, tokenAddress)
    const hash = hashTypedData({
        domain: domain,
        types: PRIVATE_RE_MINT_712_TYPES,
        primaryType: "privateReMint",
        message,
    });

    // The signature
    const signature = await privateWallet.viemWallet.signTypedData({
        account: privateWallet.privateData.ethAccount,
        domain: domain,
        types: PRIVATE_RE_MINT_712_TYPES,
        primaryType: "privateReMint",
        message,
    });

    const { pubKeyX, pubKeyY } = await extractPubKeyFromSig({ hash: hash, signature: signature });
    return {
        viemFormatSignature: { signature, pubKeyX, pubKeyY },
        signatureData: {
            public_key_x: hexToU8sAsHexArr(pubKeyX, 32) as u8sAsHexArrLen32,
            public_key_y: hexToU8sAsHexArr(pubKeyY, 32) as u8sAsHexArrLen32,
            signature: hexToU8sAsHexArr(signature.slice(0, 2 + 128) as Hex, 64) as u8sAsHexArrLen64, // slice(0, 2 + 128) because we need to skip last byte, i don't remember why that byte is there
        },
        signatureHash: hash,
    }
}
export async function signPrivateTransferWithFee({ privateWallet, signatureInputs, chainId, tokenAddress }: { privateWallet: PrivateWallet, signatureInputs: SignatureInputsWithFee, chainId: number, tokenAddress: Address }):
    Promise<{ viemFormatSignature: { signature: Hex; pubKeyX: Hex; pubKeyY: Hex; }, signatureData: SignatureData, signatureHash: Hex }> {
    chainId ??= await privateWallet.viemWallet.getChainId()

    const message = {
        _recipient: signatureInputs.recipient,
        _amount: BigInt(signatureInputs.amountToReMint),
        _callData: signatureInputs.callData,
        _callCanFail: signatureInputs.callCanFail,
        _callValue: BigInt(signatureInputs.callValue),
        _encryptedTotalSpends: signatureInputs.encryptedTotalSpends,
        _feeData: {
            ethPriceToken: BigInt(signatureInputs.feeData.ethPriceToken),
            maxFee: BigInt(signatureInputs.feeData.maxFee),
            amountForRecipient: BigInt(signatureInputs.feeData.amountForRecipient),
            estimatedGasCost: BigInt(signatureInputs.feeData.estimatedGasCost),
            estimatedPriorityFee: BigInt(signatureInputs.feeData.estimatedPriorityFee),
            refundAddress: signatureInputs.feeData.refundAddress,
            relayerAddress: signatureInputs.feeData.relayerAddress,
        },
    };

    const domain = getPrivateReMintDomain(chainId, tokenAddress)
    const hash = hashTypedData({
        domain: domain,
        types: PRIVATE_RE_MINT_RELAYER_712_TYPES,
        primaryType: "privateReMintRelayer",
        message,
    });

    const signature = await privateWallet.viemWallet.signTypedData({
        account: privateWallet.privateData.ethAccount,
        domain: domain,
        types: PRIVATE_RE_MINT_RELAYER_712_TYPES,
        primaryType: "privateReMintRelayer",
        message,
    });

    const { pubKeyX, pubKeyY } = await extractPubKeyFromSig({ hash: hash, signature: signature });
    return {
        viemFormatSignature: { signature, pubKeyX, pubKeyY },
        signatureData: {
            public_key_x: hexToU8sAsHexArr(pubKeyX, 32) as u8sAsHexArrLen32,
            public_key_y: hexToU8sAsHexArr(pubKeyY, 32) as u8sAsHexArrLen32,
            signature: hexToU8sAsHexArr(signature.slice(0, 2 + 128) as Hex, 64) as u8sAsHexArrLen64,
        },
        signatureHash: hash,
    }
}


function hexToU8sAsHexArr(hex: Hex, len: number): u8AsHex[] {
    const unPadded = hexToByteArray(hex)
    const padded = padArray({ arr: unPadded, size: len, value: "0x00", dir: "left" })
    return padded as u8AsHex[]
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