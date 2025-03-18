import { ethers } from 'ethers';
window.ethers = ethers

import circuit from '../circuits/privateTransferProver/target/privateTransferProver.json';
// import { BarretenbergBackend, BarretenbergVerifier as Verifier } from '@noir-lang/backend_barretenberg';
import { UltraHonkBackend, UltraPlonkBackend } from "@aztec/bb.js";
import { Noir } from '@noir-lang/noir_js';


import { abi as contractAbi } from "./abis/Token.json"//'../artifacts/contracts/Token.sol/Token.json'
import { getSafeRandomNumber, getProofInputs, hashNullifierValue,hashNullifierKey, hashprivateAddress, findLatestNonce } from '../scripts/getProofInputs'
messageUi("initializing prover 🤖")
// messageUi(`<br>\ndebug SharedArrayBuffer: ${typeof SharedArrayBuffer}`, true)
complainAboutSharedBufferArray()
const backend = new UltraPlonkBackend(circuit.bytecode,{ threads: navigator.hardwareConcurrency });
const backendInitPromise = backend.instantiate().then(() => { messageUi("") })
const noir = new Noir(circuit, backend)


//TODO remane nullifierId -> nullifierKey and nullifier -> nullifierValue
const CONTRACT_ADDRESS = "0x6A0e54612253d97Fd2c3dbb73BDdBAFfca531A9B"//"0xE182977B23296FFdBbcEeAd68dd76c3ea67f447F"
const FIELD_LIMIT = 21888242871839275222246405745257275088548364400416034343698204186575808495617n //using poseidon so we work with 254 bits instead of 256

const CHAININFO = {
  chainId: "0x8274f",
  rpcUrls: ["https://1rpc.io/sepolia"],
  chainName: "sepolia",
  nativeCurrency: {
    name: "Ethereum",
    symbol: "ETH",
    decimals: 18
  },
  blockExplorerUrls: ["https://sepolia.etherscan.io"]
}


async function depositBtnHandler({ signerAddress, contract, secret, signer, privateTransferAmountEl,privateTransferAddresstEl,prevSpendAmount, privateBalance }) {
  return await dumpErrorsInUi(async () => {
    const to = privateTransferAddresstEl.value === "" ? signerAddress : ethers.getAddress(privateTransferAddresstEl.value)
    const amount = ethers.parseUnits(privateTransferAmountEl.value, 18)

    const provider = contract.runner.provider
  

    const blockNumber = BigInt(await provider.getBlockNumber("latest"))
    const proofInputs = await getProofInputs({
      contractAddress:contract.target,
      withdrawAmount:amount, 
      privateTransferAddress:to, 
      secret:secret, 
      provider:provider, 
    })
    console.log({ proofInputs })

    const proof = createSnarkProof({ proofInputsNoirJs: proofInputs.noirJsInputs, circuit: circuit })
    putTxInUi(await setTrustedStorageRootTx)
    await proofTimeInfo()
    //console.log({proof})
    // TODO make this object in a new function in getProofInputs.js
    const privateTransferInputs = {
      to,
      amount,
      root: proofInputs.proofData.root, 
      nullifierKey: proofInputs.proofData.nullifierData.nullifierKey,
      nullifierValue: proofInputs.proofData.nullifierData.nullifierValue,
      snarkProof: ethers.hexlify((await proof).proof),

    }
    // console.log("------------privateTransfer tx inputs----------------")
    console.log({ privateTransferInputs })

    // TODO make wrapped function inside getProofInputs that consumes the privateTransferInputs
    const privateTransferTx = await contract.privateTransfer(privateTransferInputs.to, privateTransferInputs.amount, privateTransferInputs.root, privateTransferInputs.nullifierKey, privateTransferInputs.nullifierValue, privateTransferInputs.snarkProof)


    await putTxInUi(await privateTransferTx)
    await privateTransferTx.wait(1)

    //TODO this is janky af
    await refreshUiInfo({ contract, signer })
  })

}


async function dumpErrorsInUi(func, args = []) {
  try {
    return await func(...args)
  } catch (error) {
    console.error(error)
    document.querySelector("#errors").innerText += `${func.name}:${error}`
  }
}

async function switchNetwork(network, provider) {
  try {
    await provider.send("wallet_switchEthereumChain", [{ chainId: network.chainId }]);

  } catch (switchError) {
    window.switchError = switchError
    // This error code indicates that the chain has not been added to MetaMask.
    if (switchError.error && switchError.error.code === 4902) {
      try {
        await provider.send("wallet_addEthereumChain", [network]);

      } catch (addError) {
        // handle "add" error
      }
    }
    // handle other "switch" errors
  }
}

async function getContractWithSigner({ abi = contractAbi, chain = CHAININFO, contractAddress = CONTRACT_ADDRESS } = {}) {
  return await dumpErrorsInUi(
    async () => {
      const provider = new ethers.BrowserProvider(window.ethereum)
      window.provider = provider //debug moment
      await switchNetwork(chain, provider)
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(contractAddress, abi, signer)
      return { contract, signer }
    }
  )
}

async function getContractInfo(contract, signer) {
  const [userBalance, decimals, name, symbol, totalSupply] = await Promise.all([
    contract.balanceOf(signer.address),
    contract.decimals(),
    contract.name(),
    contract.symbol(),
    contract.totalSupply()
  ])
  return {
    userBalance: ethers.formatUnits(userBalance, decimals),
    totalSupply: ethers.formatUnits(totalSupply, decimals),
    decimals, name, symbol
  }
}

function setContractInfoUi({ userBalance, name, symbol }) {
  //console.log({ userBalance, name, symbol });
  [...document.querySelectorAll(".userBalance")].map((el) => el.innerText = userBalance);
  [...document.querySelectorAll(".tokenName")].map((el) => el.innerText = name);
  [...document.querySelectorAll(".ticker")].map((el) => el.innerText = symbol);
}

async function refreshUiInfo({ contract, signer }) {
  const { userBalance, totalSupply, decimals, name, symbol } = await getContractInfo(contract, signer)
  setContractInfoUi({ userBalance, name, symbol })
  await listPrivateAddressesLocalstorage({ contract, signer })
}

function messageUi(message, append = false) {
  if (append) {
    document.getElementById("messages").innerHTML += message
  } else {
    document.getElementById("messages").innerHTML = message
  }
  console.log(message)
}

async function putTxInUi(tx) {
  const explorer = CHAININFO.blockExplorerUrls[0]
  const url = `${explorer}/tx/${(await tx).hash}`
  messageUi(`tx submitted: <a href=${url}>${url}</a>`)
  return tx
}

async function mintBtnHandler({ contract, decimals, signer }) {
  return await dumpErrorsInUi(async () => {
    const amountUnparsed = document.getElementById("mintAmountInput").value
    const amount = ethers.parseUnits(amountUnparsed, decimals)
    const tx = await contract.mint(signer.address, amount)
    await putTxInUi(tx)
    await tx.wait(1)

    //TODO this is janky af
    await refreshUiInfo({ contract, signer })
  })
}

function addprivateToLocalStorage({ secret, privateAddress, from, txHash }) {
  privateAddress = ethers.getAddress(privateAddress) // get rid of issue where lower and uppercase addresses create duplicate entries
  secret = ethers.toBeHex(secret)
  const prevprivates = JSON.parse(localStorage.getItem(CONTRACT_ADDRESS))
  const allprivates = prevprivates !== null ? prevprivates : {}
  allprivates[privateAddress] = { secret, txHash, from }
  localStorage.setItem(CONTRACT_ADDRESS, JSON.stringify(allprivates))

}

async function listPrivateAddressesLocalstorage({ contract, signer }) {
  return await dumpErrorsInUi(async () => {
    const decimals = await contract.decimals()
    const privateAddressUi = document.getElementById("privateAddresses")
    privateAddressUi.innerHTML = ""
    const allPrivatesAddresses = JSON.parse(localStorage.getItem(CONTRACT_ADDRESS))
    if (!allPrivatesAddresses) return;

    for (const privateAddress in allPrivatesAddresses) {
      const { secret, txHash, from } = allPrivatesAddresses[privateAddress]
      //console.log( { secret, txHash, from } )
      //TODO do async
      const privateBalance = await contract.balanceOf(privateAddress)
      const privateTransferUiLi = await makePrivateTransferUi({ secret, privateBalance, privateAddress, txHash, from, contract, decimals, signer })
      privateAddressUi.append(privateTransferUiLi)
    }
  })
}


function br() {
  return document.createElement("br")
}


async function makePrivateTransferUi({ secret, privateBalance, privateAddress, txHash, from, contract, decimals, signer }) {
  const explorer = CHAININFO.blockExplorerUrls[0]
  const li = document.createElement("li")

  // @optimization cache the latest nonce and prevSpend amount so we don't need a full resync on every page load and spend
  const { prevSpendAmount,txhashes } = await findLatestNonce({secret, tokenContract:contract})
  console.log({txhashes})

  if (privateBalance === prevSpendAmount) {
    li.append(
      br(),
      "all is spent",
      br(),
    )
    //li.style.textDecoration = "line-through"
  } else if (privateBalance === 0n) {
    li.append(
      br(),
      "no ballance yet. Is the the tx still pending?",
      br()
    )
    //li.style.textDecoration = "line-through"
  } else {
    const privateTransferBtn = document.createElement("button")
    privateTransferBtn.innerText = "privateTransfer"
    

    //privateTransfer address
    const privateTransferAddressEl = document.createElement("input")
    const privateTransferAddressLabel = document.createElement("label")
    privateTransferAddressLabel.innerText = "recipient address: "
    privateTransferAddressLabel.append(privateTransferAddressEl)

    //privateTransferAmount
    const privateTransferAmountEl = document.createElement("input")
    const privateTransferAmountLabel = document.createElement("label")
    privateTransferAmountLabel.innerText = "privateTransfer amount: "
    privateTransferAmountLabel.append(privateTransferAmountEl)

    li.append(
      br(),
      privateTransferAddressLabel,
      br(),
      privateTransferAmountLabel,
      privateTransferBtn,
      br()
    )

    privateTransferBtn.addEventListener("click", () => depositBtnHandler({ signerAddress: signer.address, contract, secret, signer, privateTransferAmountEl, privateTransferAddresstEl: privateTransferAddressEl,prevSpendAmount, privateBalance }))
  }

  //info
  const fromEl = document.createElement("a")
  const privateEl = document.createElement("a")
  fromEl.className = "address"
  privateEl.className = "address"
  fromEl.innerText = from
  privateEl.innerText = privateAddress
  fromEl.href = `${explorer}/address/${from}`
  privateEl.href = `${explorer}/address/${privateAddress}`
  li.append(
    ` private-address: `, privateEl,
    br(),
    // `from-address: `, fromEl,
    // br(),
    `amount privateed: ${ethers.formatUnits(privateBalance, decimals)},`,
    br(),
    `amount spent: ${ethers.formatUnits(prevSpendAmount, 18)}`,
    br(),
    br(),
  )
  if (txhashes.length) {
    const txUl = document.createElement("Ul")
    const txLuLabel = document.createElement("label")
    txLuLabel.innerText = "spent transactions: "

    for (const tx of txhashes) {
      const txHashEl = document.createElement("a")
      txHashEl.innerText = `${tx}`
      txHashEl.href = `${explorer}/tx/${tx}`
      txUl.append(br(), `tx: `, txHashEl)
      
    }
    txLuLabel.append(txUl)
    li.append(txLuLabel)
  }
  return li
}

function complainAboutSharedBufferArray() {
  if (window.crossOriginIsolated === false) {
    messageUi(`
      \n<br>
      <b>NOTICE</b>: prover can only use <b>1 core</b> because current site isn't in a cross-origin isolation state. \n <br>
      This is likely because the server running this has not set it's cors header properly \n <br>
      They need to be set like this: \n <br>
      <code>
        ...<br>
        "Cross-Origin-Embedder-Policy":"require-corp"<br>
        "Cross-Origin-Opener-Policy":"same-origin"<br>
        ...<br>
      </code> \n<br>
      \n<br>
      <b>DEBUG</b>: \n<br>
      <code>
      SharedArrayBuffer: ${typeof SharedArrayBuffer} \n<br>
      window.crossOriginIsolated: ${window.crossOriginIsolated} \n<br>
      window.location.origin: ${window.location.origin} \n<br>
      <a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements">https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements</a>
      </code>
      `, true)
  }
}

async function proofTimeInfo() {
  if (window.crossOriginIsolated === false) {
    messageUi(`
      \n<br>
      <b>NOTICE</b>: prover can only use <b>1 core</b> 
      Because current site isn't in a cross-origin isolation state. \n <br>
      Proving can take <b>7~10min</b> :/
      `
    )
  }
  await backendInitPromise
  if (window.crossOriginIsolated) {
    const b = await backend.instantiate()
    messageUi(`
      🤖 Generating zkproof 🤖 \n <br>
      DEBUG: window.crossOriginIsolated is set to true. \n<br>
      we got ${JSON.stringify(backend.backendOptions)} cores now 😎 \n <br>
      `)
  }
}

async function createSnarkProof({ proofInputsNoirJs, circuit = circuit }) {

  // pre noirjs 0.31.0 \/
  //const proof = await noir.generateProof(proofInputsNoirJs);
  const { witness } = await noir.execute(proofInputsNoirJs);
  const proof = await backend.generateProof(witness);

  //TODO remove this debug

  // pre noirjs 0.31.0 \/
  //const verified = await noir.verifyProof(proof)
  const verified = await backend.verifyProof(proof)
  console.log({ verified })

  return proof
}

async function depositBtnHandler({ contract, decimals, signer }) {
  return await dumpErrorsInUi(async () => {
    const amountUnparsed = document.getElementById("privateAmount").value
    const amount = ethers.parseUnits(amountUnparsed, decimals)

    const secret = getSafeRandomNumber()
    const privateAddressInput = document.getElementById("privateAddressInput")
    const privateAddress = privateAddressInput.value === "" ? hashprivateAddress({secret}) : ethers.getAddress(privateAddressInput.value);
    const from = signer.address
    console.log({ secret, privateAddress, from, txHash: null })
    addprivateToLocalStorage({ secret, privateAddress, from, txHash: null }) // user can exit page and then submit the txs so we save the secret before the private just in case
    const privateTx = await contract.transfer(privateAddress, amount)
    addprivateToLocalStorage({ secret, privateAddress, from, txHash: privateTx.hash }) // we got a txhash now
    await putTxInUi(privateTx)
    await privateTx.wait(1)
    await refreshUiInfo({ contract, signer })
  })

}

function setEventListeners({ contract, decimals, signer }) {
  document.getElementById("mintBtn").addEventListener("click", async () => await mintBtnHandler({ contract, decimals, signer }))
  document.getElementById("depositBtn").addEventListener("click", async () => await depositBtnHandler({ contract, decimals, signer }))
}

async function main() {
  const { contract, signer } = await getContractWithSigner()
  const { userBalance, totalSupply, decimals, name, symbol } = await getContractInfo(contract, signer)
  setContractInfoUi({ userBalance, name, symbol })
  setEventListeners({ contract, decimals, signer })
  await listPrivateAddressesLocalstorage({ contract, signer })



  //--------------------------
  window.contract = contract
  window.signer = signer
  window.hashNullifierValue = hashNullifierValue
  window.hashNullifierKey = hashNullifierKey
}

await main()