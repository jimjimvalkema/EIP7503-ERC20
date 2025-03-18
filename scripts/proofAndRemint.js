
//hardhat
import "@nomicfoundation/hardhat-toolbox"
import { vars } from "hardhat/config.js"

//noir
import { Noir } from "@noir-lang/noir_js";

// other
import { ethers } from 'ethers';
import { poseidon1, poseidon2 } from "poseidon-lite";
import os from 'os';

// project imports
import { getProofInputs,hashprivateAddress, paddArray } from "./getProofInputs.js"
import privateTransferProverCircuit from '../circuits/privateTransferProver/target/privateTransferProver.json'  with { type: "json" }; //assert {type: 'json'};

//---- node trips up on the # in the file name. This is a work around----
//import {tokenAbi } from "../ignition/deployments/chain-534351/artifacts/TokenModule#Token.json" assert {type: 'json'};
import fs from "fs/promises";
import path from 'path';
import { fileURLToPath } from 'url';
import Ethers from "@typechain/ethers-v6";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tokenAbi = JSON.parse(await fs.readFile(__dirname + "/../ignition/deployments/chain-534351/artifacts/TokenModule#Token.json", "utf-8")).abi
const privateTransferVerifierAbi = JSON.parse(await fs.readFile(__dirname + "/../ignition/deployments/chain-534351/artifacts/VerifiersModule#privateTransferVerifier.json", "utf-8")).abi

//--------------------------

//const smolVerifierAbi = JSON.parse(await fs.readFile(__dirname+"/../ignition/deployments/chain-534351/artifacts/VerifiersModule#SmolVerifier.json", "utf-8")).abi

// --------------contract config---------------
// TODO make these public vars of the contract and retrieve them that way
const FIELD_LIMIT = 21888242871839275222246405745257275088548364400416034343698204186575808495617n //using poseidon so we work with 254 bits instead of 256

async function mint({ to, amount, contract }) {
    const mintTx = await contract.mint(to, amount)
    return mintTx
}

async function privateTransfer({ secret, amount, contract }) {
    const privateAddress = ethers.toBeHex(poseidon1([secret])).slice(0, 2 + 40) // take only first 20 bytes (because eth address are 20 bytes)
    const privateTx = await contract.privateTransfer(privateAddress, amount)
    return { privateTx, privateAddress }
}
/**
 * @typedef {import("@noir-lang/noir_js").CompiledCircuit} CompiledCircuit 
 * @param {{
 *      noirjsInputs,
 *      circuit: CompiledCircuit, 
 *      contractDeployerWallet: ethers.Contract 
 * }} param0 
 * @typedef {import("@noir-lang/types").ProofData} ProofData
 * @returns {Promise<ProofData>} proof
 */
async function createPrivateTransferProof({ noirjsInputs, circuit = privateTransferProverCircuit, contractDeployerWallet }) {
    const noir = new Noir(circuit);
    //console.log({circuit})
    console.dir({privateTransferProver: noirjsInputs},{depth:null})
    console.log(`generating privateTransfer proof with ${os.cpus().length} cores `)
    const backend = new UltraPlonkBackend(circuit.bytecode,  { threads:  os.cpus().length });
    const { witness } = await noir.execute(noirjsInputs);
    const proof = await backend.generateProof(witness);
    const verifiedByJs = await backend.verifyProof(proof);
    console.log("privateTransferProof: ",{ verifiedByJs })

    const privateTransferVerifierAddress = await contractDeployerWallet.privateTransferVerifier()
    const privateTransferVerifier = new ethers.Contract(privateTransferVerifierAddress, privateTransferVerifierAbi,contractDeployerWallet.runner.provider);
    const verifiedOnVerifierContract = await privateTransferVerifier.verify(proof.proof, proof.publicInputs)
    console.log("privateTransferProof: ", {verifiedOnVerifierContract})
    console.log({proof})

    return proof 
}


async function privateTransfer({ to, amount,nullifierKey,nullifierValue, snarkProof, contract }) {
    // verify on chain and privateTransfer!
    const privateTransferTx = await contract.privateTransfer(to, amount,nullifierKey,nullifierValue, snarkProof)
    return privateTransferTx
}


async function main() {
    const CONTRACT_ADDRESS = "0x6A0e54612253d97Fd2c3dbb73BDdBAFfca531A9B"
    // --------------

    // --------------provider---------------
    const PROVIDERURL = "https://1rpc.io/sepolia"
    const provider = new ethers.JsonRpcProvider(PROVIDERURL)
    // --------------

    // --------------wallet config---------------
    
    const RPIVATE_KEY = vars.get("PRIVATE_KEY");
    const RECIPIENT_PRIVATE_KEY = vars.get("RECIPIENT_PRIVATE_KEY")
    // connect contracts
    const deployerWallet = new ethers.Wallet(RPIVATE_KEY, provider)
    const recipientWallet = new ethers.Wallet(RECIPIENT_PRIVATE_KEY, provider)
    const RECIPIENT_ADDRESS = recipientWallet.address
    const contractDeployerWallet = new ethers.Contract(CONTRACT_ADDRESS, tokenAbi, deployerWallet);
    const contractRecipientWallet = new ethers.Contract(CONTRACT_ADDRESS, tokenAbi, recipientWallet);
    // --------------


    //---------------private -------------------
    // mint fresh tokens (normal mint)
    const privateAmount =      420000000000000000000n
    const privateTransferAmount =    10000000000000000000n //-1n because there is a off by one error in the circuit which privates 1 wei
    const secret = 13093675745686700816186364422135239860302335203703094897030973687686916798500n//getSafeRandomNumber();
    const privateAddress = hashprivateAddress({secret})

    //mint
    const mintTx = await mint({ to: deployerWallet.address, amount: privateAmount, contract: contractDeployerWallet })
    console.log({ mintTx: (await mintTx.wait(1)).hash })
    
    // private
    const { privateTx } = await privateTransfer({ secret, amount: privateAmount, contract: contractDeployerWallet })
    console.log({ privateAddress, privateTx: (await privateTx.wait(3)).hash }) // could wait less confirmation but

    const proofInputs = await getProofInputs({
        contract: contractRecipientWallet,  
        withdrawAmount: privateTransferAmount, 
        privateTransferAddress: recipientWallet.address, 
        secret: secret, 
    })

    // get snark proof
    const proof = await createPrivateTransferProof({ noirjsInputs: proofInputs.noirJsInputs, circuit: privateTransferProverCircuit, contractDeployerWallet })


    //privateTransfer
    const privateTransferInputs = {
        to: RECIPIENT_ADDRESS,
        amount: privateTransferAmount,
        nullifierKey: proofInputs.proofData.nullifierData.nullifierKey,
        nullifierValue: proofInputs.proofData.nullifierData.nullifierValue,
        snarkProof: ethers.hexlify(proof.proof),
    }
    
    console.log("------------privateTransfer tx inputs----------------")
    console.log("privateTransfering with call args:")
    console.log({privateTransferInputs})
    console.log("---------------------------------------")
    const privateTransferTx = await privateTransfer({ ...privateTransferInputs, contract: contractRecipientWallet })
    console.log({ privateTransferTx: (await privateTransferTx.wait(1)).hash })
    console.log({ privateAddress, secret: secret})


}
await main()
// idk its not stopping on its own prob wasm thing?
process.exit();