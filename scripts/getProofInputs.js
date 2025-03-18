// const { ethers, N } = require("ethers");
// const { poseidon1 } = require("poseidon-lite");
import { poseidon1, poseidon2, poseidon3 } from "poseidon-lite";
import { ethers } from "ethers";
import * as fs from 'node:fs/promises';
import { getHashPathFromProof, getBlockHeaderProof, hashStorageKeyMapping, decodeProof } from "../submodules/scrollZkStorageProofs/scripts/decodeScrollProof.js"
import { ZkTrieNode, NodeTypes, leafTypes, BLOCK_HEADER_ORDERING } from "../submodules/scrollZkStorageProofs/scripts/types/ZkTrieNode.js";
import argParser from 'args-parser'


const FIELD_LIMIT = 21888242871839275222246405745257275088548364400416034343698204186575808495617n //using poseidon so we work with 254 bits instead of 256


// TODO import real abi file instead 
const abi = [
    "function balanceOf(address) view returns (uint256)",
    "function partialNullifiers(bytes32) view returns (uint256)",
    "function reMintAmounts(bytes32) view returns (uint256)",
    "event Remint(bytes32 indexed nullifierKey, uint256 amount)"
];
//import fs from "fs/promises";
// import path from 'path';
// import { fileURLToPath } from 'url';
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);
// const abi = JSON.parse(await fs.readFile(__dirname + "/../ignition/deployments/chain-534351/artifacts/TokenModule#Token.json", "utf-8")).abi
export function getSafeRandomNumber() {
    let isBigger = true
    let number = 0n
    while (isBigger) {
        number = ethers.toBigInt(crypto.getRandomValues(new Uint8Array( new Array(32))))
        isBigger = number > FIELD_LIMIT
    }
    return number
}

export function paddArray(arr, len = 32, filler = 0, infront = true) {
    //ethers.assert(arr.length >= len, "tried to pad a array that is larger then specified len")
    if (infront) {
        return [...Array(len - arr.length).fill(filler), ...arr]

    } else {
        return [...arr, ...Array(len - arr.length).fill(filler)]
    }


}

function asPaddedArray(value, len = 32, infront = true) {
    const valueArr = [...ethers.toBeArray(value)]
    return paddArray(valueArr, len, 0, infront)
}

export function hashNullifierValue({amount,nonce,secret}) {
    const nullifierValue = poseidon3([amount,nonce,secret])
    return ethers.zeroPadValue(ethers.toBeHex(nullifierValue),32)
}

export function hashNullifierKey({nonce,secret}) {
    const nullifierKey = poseidon2([nonce,secret])
    return ethers.zeroPadValue(ethers.toBeHex(nullifierKey),32)
}

export function hashBurnAddress({secret}) {
    const hash = ethers.toBeArray(poseidon1([secret])) 
    const burnAddress = hash.slice(0,20)
    return ethers.zeroPadValue(ethers.hexlify(burnAddress),20)
}


// make findLatestNonce but with better name and it decrypts the value instead. 
// Event scanning in reverse order since we dont need all events anymore when we can decrypt nullifierValue
// export async function findLatestNonce({secret, tokenContract, startBlock, noncesPerEventScan=20, chunkSizeEventScan=9999}) {
//     const provider = tokenContract.runner.provider
//     startBlock = startBlock ? Number(startBlock) : (await provider.getBlockNumber("latest")) - 40000//80000
//     //console.log(JSON.stringify(tokenContract))
//     let usedNonce = 0n // TODO clean up this while loop so nonce starts at 0n. (for readability)
//     let remintEvents = undefined;
//     let prevSpendAmount = 0n 
//     let txhashes = []
//     // do event scanning
//     while (remintEvents !== false) {
//         const nullifierKeys = Array(noncesPerEventScan).fill(0).map((x,i)=>hashNullifierKey({nonce:usedNonce+BigInt(i), secret}))
//         console.log({nullifierKeys})
//         remintEvents = await getRemintEventBulk({chunksize:chunkSizeEventScan,nullifierKeys, startBlock, contract:tokenContract})

//         if (remintEvents !== false) { //ugly
//             usedNonce += BigInt(remintEvents.length)
//             const remintedAmount = remintEvents.reduce((accum, event) => accum + BigInt(event.data),0n)
//             prevSpendAmount += remintedAmount
//             startBlock = remintEvents[remintEvents.length-1].blockNumber
//             txhashes = txhashes.concat(remintEvents.map((event)=>event.transactionHash))
//         }
//     }
    
//     let nullifierValue
//     while (nullifierValue !== "0x00") {
//         const nullifierKey = hashNullifierKey({nonce:usedNonce, secret})
//         nullifierValue = ethers.toBeHex(await tokenContract.partialNullifiers(nullifierKey))

//         if (nullifierValue !== "0x00") {
//             const remintedAmount = await tokenContract.reMintAmounts(nullifierKey)
//             prevSpendAmount += remintedAmount
//             usedNonce++
//         }
//     } 
//     console.log( {nonce: usedNonce, prevSpendAmount, txhashes})
//     return {nonce: usedNonce, prevSpendAmount, txhashes}
// }


async function getRemintEvent({nullifierKey, startBlock, contract}) {
    const filter =  contract.filters.Remint([nullifierKey])
    const events = await contract.queryFilter(filter,startBlock)
    if (events[0] !== undefined) {
        return events[0] 
    } else {
        return false
    }
}

//TODO do in bulk ex contract.filters.Remint([nullifierKey1, nullifierKey2, etc])
async function getRemintEventBulk({chunksize=5000,nullifierKeys, startBlock, contract}) {
    const filter =  contract.filters.Remint([...nullifierKeys])
    const events = await queryEventInChunks({chunksize,filter,startBlock,contract})
    console.log({events})
    if (events.length >= 1) {
        return events 
    } else {
        return false
    }
} 
/**
 * 
 * @param {{contract:ethers.Contract}} param0 
 */
async function queryEventInChunks({chunksize=5000,filter,startBlock,contract}){

    const provider = contract.runner.provider
    const lastBlock = await provider.getBlockNumber("latest")
    const numIters = Math.ceil((lastBlock-startBlock)/chunksize)
    const allEvents = []
    console.log({lastBlock,startBlock,chunksize,numIters})
    for (let index = 0; index < numIters; index++) {
        const start = index*chunksize + startBlock
        const stop =  (start + chunksize) > lastBlock ? lastBlock :  (start + chunksize)
        console.log({filter,start,stop})
        const events =  await contract.queryFilter(filter,start,stop)
        allEvents.push(events)
    }
    return allEvents.flat()

}


/**
 * @param {{
 *      contractAddress: ethers.AddressLike, 
 *      burnAddress: ethers.AddressLike,
 *      withdrawAmount: BigInt, 
 *      blockNumber: BigInt | number,
 *      secret: BigInt, 
 *      provider: ethers.Provider
 *  }} params
 * 
 * @typedef hashPath
 * @property {ethers.BytesLike[]} hashPath from leaf-hash-sibling to root-child
 * @property {number[]} nodeTypes from leaf-hash-sibling to root-child
 * @property {ZkTrieNode} leafNode used for the leafHash and nodeKey/hashPathBools in proving
 * @property {ethers.BytesLike} storageRoot used for the leafHash and nodeKey/hashPathBools in proving
 * @typedef {decodedProof} stateProof
 * @typedef {{
 *      amounts: { 
 *          burnedTokenBalance: BigInt,
 *          prevSpendAmount: BigInt,
 *      },
 *      nullifierData : {
 *          nullifierValue: ethers.BytesLike, 
 *          nullifierKey: ethers.BytesLike,
 *          prevNullifierKey: ethers.BytesLike, 
 *          nonce: BigInt,
 *      },
 *   }} RemintProofData 
 * @returns {Promise<RemintProofData>} remintProofData
 */
export async function getRemintProofData({contract, burnAddress,withdrawAmount,secret, provider = provider}) {
    // contract data
    const provider = contract.runner.provider
    const burnedTokenBalance = await contract.balanceOf(burnAddress)
    const {nonce, prevSpendAmount} = await findLatestNonce({secret, tokenContract: contract})

    // nullifiers
    const nullifierValue = hashNullifierValue({amount: prevSpendAmount + withdrawAmount,nonce,secret})
    const nullifierKey = hashNullifierKey({nonce,secret})
    const prevNullifierKey = hashNullifierKey({nonce: nonce-1n,secret})


    
    return {   
        // nullifiers
        amounts: {
            withdrawAmount, 
            burnedTokenBalance,
            prevSpendAmount
        },

        nullifierData : {
            nullifierValue: nullifierValue, 
            nullifierKey: nullifierKey,
            prevNullifierKey: prevNullifierKey, 
            nonce,
        },
         // TODO merkle proof
    }
    //return { block, burnedTokenBalance, contractBalance, balancesHashPaths, prevNullifierHashPaths, nullifier, provider }
}

/**
 * 
 * @param {ethers.HexString} input 
 * @param {Number} bytes 
 * @returns 
 */
function Bytes(input, len) {
    const regEx = new RegExp(`.{1,${2 * len}}`, "g")
    return input.slice(2).match(regEx).map((x) => "0x" + x)

}


/**
 * 
 * @param {{
 *      contractAddress: ethers.AddressLike, 
 *      blockNumber: BigInt,
 *      withdrawAmount: BigInt,
 *      remintAddress: ethers.AddressLike, 
 *      secret: BigInt, 
 *      providerL ethers.Provider, 
 *      maxHashPathLen: number, 
 *      maxRlplen: number
 * }} params
 * 
 * @typedef {{
 *      remint_address: ethers.AddressLike,
 *          withdraw_amount: ethers.BytesLike,
 *          nullifier_value: ethers.BytesLike,
 *          nullifier_key: ethers.BytesLike,
 *          storage_root: ethers.BytesLike,
 *          secret: ethers.BytesLike,
 *          burned_balance: number[],
 *          nonce: ethers.BytesLike,
 *          prev_nullifier_key: ethers.BytesLike,
 *          prev_spend_amount: ethers.BytesLike,
 *          burn_addr_storage_proof: {
 *              hash_path: ethers.BytesLike[],
 *              leaf_type: ethers.BytesLike[],
 *              node_types: ethers.BytesLike[],
 *              real_hash_path_len: Number,
 *              hash_path_bools: Boolean[],
 *          },
 *          prev_nullifier_storage_proof:  {
 *              hash_path: ethers.BytesLike[],
 *              leaf_type: ethers.BytesLike[],
 *              node_types: ethers.BytesLike[],
 *              real_hash_path_len: Number,
 *              hash_path_bools: Boolean[],
 *          }
 *      }} noirJsInputs
 * @typedef {{
 *        blockData:{
 *              block: ethers.Block, 
 *              rlp: ethers.BytesLike
 *        },
 *        proofData: RemintProofData,
 *        noirJsInputs: noirJsInputs
 *    }} ProofInputs
 * @returns {Promise<ProofInputs>} ProofInputs
 */
export async function getProofInputs({contract, blockNumber,withdrawAmount,remintAddress, secret,deploymentBlock}) {
    const burnAddress = hashBurnAddress({secret})
    const provider  = contract.runner.provider
    const proofData = await getRemintProofData({contract,burnAddress, withdrawAmount,blockNumber:Number(blockNumber),deploymentBlock:deploymentBlock,secret:secret, provider:provider})
    const {   
        // nullifiers
        amounts: {
            //withdrawAmount, 
            burnedTokenBalance,
            prevSpendAmount,
        },
        
        nullifierData : {
            nullifierValue, 
            nullifierKey,
            prevNullifierKey, 
            nonce,
        },
        //TODO merkle proofs
    }  = {...proofData}


    //ethers.assert(byteNibbleOffsets)
    return {
        blockData:{block, rlp},
        proofData,
        noirJsInputs: {
            // --public inputs--
            remint_address: remintAddress,
            withdraw_amount: ethers.toBeHex(withdrawAmount), //asPaddedArray(withdrawAmount, 32).map((x) => ethers.toBeHex(x)),
            nullifier_value: nullifierValue,
            nullifier_key: nullifierKey,
            //--------------------


            // --private inputs--
            secret: ethers.toBeHex(secret),
            burned_balance: asPaddedArray(burnedTokenBalance, 32).map((x) => ethers.toBeHex(x)),
            nonce: ethers.toBeHex(nonce),
            prev_nullifier_key: ethers.toBeHex(prevNullifierKey),
            prev_spend_amount: ethers.toBeHex(prevSpendAmount),
            //--------------------


        }
    }
}
/**
 * @param {Object} obj
 * @param {RemintProofData} obj.proofData 
 * @param {ethers.AddressLike} obj.remintAddress
 * @param {bigint} obj.withdrawAmount
 * @param {ethers.BytesLike} obj.secret
 * @returns 
 */
export function formatTest({proofData, remintAddress, withdrawAmount, secret}) {
    // const headerRlp = await getBlockHeaderRlp(Number(block.number), provider
    console.log(proofData)
    return`
#[test]
fn test_main() {
    //----- public inputs
    let remint_address: Field = ${remintAddress};
    let withdraw_amount:  Field = ${ethers.toBeHex(withdrawAmount)};
    let nullifier_value: Field = ${proofData.nullifierData.nullifierValue};
    let nullifier_key: Field = ${proofData.nullifierData.nullifierKey};
    let block_hash: [u8; 32] = [${paddArray([...ethers.toBeArray(proofData.stateProofData.block.hash)],32,0,true).map((x)=>ethers.toBeHex(x))}];
    
    //-----private inputs -----
    let secret: Field  = ${ethers.toBeHex(secret)};
    let burned_balance: [u8; 32]  = [${paddArray([...ethers.toBeArray(proofData.amounts.burnedTokenBalance)],32,0,true).map((x)=>ethers.toBeHex(x))}];
    let nonce: Field = ${proofData.nullifierData.nonce};
    let prev_nullifier_key: Field = ${proofData.nullifierData.prevNullifierKey};
    let prev_spend_amount: Field = ${proofData.amounts.prevSpendAmount};'

    //TODO merkle proof

    main(
        //----- public inputs
        remint_address,
        withdraw_amount,
        nullifier_value,
        nullifier_key,
        //-----private inputs -----
        secret,
        burned_balance,
        nonce,
        prev_nullifier_key,
        prev_spend_amount,
    );`
}