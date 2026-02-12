import { Address, createPublicClient, createWalletClient, custom, formatUnits, getAddress, getContract, Hex, http, parseEther, parseUnits, UnknownTypeError, WalletClient } from 'viem'
import { sepolia } from 'viem/chains'
import 'viem/window';
import { getPrivateAccount } from '../src/hashing.js';
import { SyncedPrivateWallet, UnsyncedPrivateWallet, WormholeToken, RelayerInputs, RelayerInputsHex } from '../src/types.js';
import { syncPrivateWallet } from '../src/syncing.js';
import WormholeTokenArtifact from '../artifacts/contracts/WormholeToken.sol/WormholeToken.json' //with {"type":"json"};
import sepoliaDeployments from "../ignition/deployments/chain-11155111/deployed_addresses.json"
import { convertRelayerInputsFromHex, convertRelayerInputsToHex, createRelayerInputs, proofAndSelfRelay, relayTx } from '../src/transact.js';
import { getBackend } from '../src/proving.js';
import { EMPTY_FEE_DATA } from '../src/constants.js';
import dotenv from 'dotenv'
dotenv.config()


const pendingRelayTxsEl = document.getElementById("pendingRelayTxs")
//TODO clean this mess
const wormholeTokenAddress = sepoliaDeployments['wormholeToken#WormholeToken'] as Address;
//@ts-ignore
window.wormholeTokenAddress
console.log({ wormholeTokenAddress })
const logEl = document.getElementById("messages")
const errorEl = document.getElementById("errors")
const transferRecipientInputEl = document.getElementById('transferRecipientInput')
const transferAmountInputEl = document.getElementById('transferAmountInput')
const privateTransferRecipientInputEl = document.getElementById("privateTransferRecipientInput")
const privateTransferAmountInputEl = document.getElementById("privateTransferAmountInput")

const backend = await getBackend(window.navigator.hardwareConcurrency)

const publicClient = createPublicClient({
  chain: sepolia, // Your target chain
  transport: http(process.env.ETHEREUM_RPC), // Public RPC URL
})
const wormholeToken = getContract({ abi: WormholeTokenArtifact.abi, address: wormholeTokenAddress, client: { public: publicClient } }) as unknown as WormholeToken
setNonWalletInfo(wormholeToken)

async function everyClass(className: string, func: Function) {
  document.querySelectorAll(className).forEach(async (el) => {
    await func(el)
  })
}

function errorUi(message: string, error: unknown, replace = false) {
  if (replace) {
    //@ts-ignore
    errorEl.innerText = ""
  }
  //@ts-ignore
  errorEl.innerText += `\n ${message + "\n" + error.toString()}`
  throw new Error(message, { cause: error })
}
function logUi(message: string, replace = false) {
  if (replace) {
    //@ts-ignore
    logEl.innerText = ""
  }
  //@ts-ignore
  logEl.innerText += `\n ${message}`
  console.log(message)
}

async function txInUi(txHash: Hex) {
  //TODO make href
  logUi(`tx sent at: https://sepolia.etherscan.io/tx/${txHash}`)
  await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1
  })
}

async function setNonWalletInfo(wormholeToken: WormholeToken) {
  const amountFreeTokens = wormholeToken.read.amountFreeTokens()
  const name = wormholeToken.read.name()
  const ticker = wormholeToken.read.symbol()
  const decimals = wormholeToken.read.decimals()
  const formatAmountFreeTokens = formatUnits(await amountFreeTokens, Number(await decimals))
  everyClass(".amountFreeTokens", async (el: any) => el.innerText = await formatAmountFreeTokens)
  everyClass(".ticker", async (el: any) => el.innerText = await ticker)
  everyClass(".tokenName", async (el: any) => el.innerText = await name)

}

async function updateWalletInfoUi(wormholeTokenWallet: WormholeToken, publicWallet: WalletClient, publicAddress: Address, privateWallet?: UnsyncedPrivateWallet | SyncedPrivateWallet) {
  everyClass(".publicAddress", (el: any) => el.innerText = publicAddress)
  const publicBalance = wormholeTokenWallet.read.balanceOf([publicAddress])
  const decimals = Number(await wormholeTokenWallet.read.decimals())

  if (privateWallet) {
    const syncedPrivateWallet = syncPrivateWallet({ wormholeToken: wormholeTokenWallet, privateWallet: privateWallet })
    everyClass(".burnAddress", (el: any) => el.innerText = privateWallet.burnAddress)
    everyClass(".privateBurnedBalance", async (el: any) => el.innerText = formatUnits((await syncedPrivateWallet).totalReceived, decimals))
    everyClass(".privateSpentBalance", async (el: any) => el.innerText = formatUnits((await syncedPrivateWallet).totalSpent, decimals))
    everyClass(".privateSpendableBalance", async (el: any) => el.innerText = formatUnits((await syncedPrivateWallet).totalReceived - (await syncedPrivateWallet).totalSpent, decimals))
    //@ts-ignore 
    window.privateWallet = (await syncedPrivateWallet)
  }


  const formatPubBalance = formatUnits(await publicBalance, Number(await decimals))
  everyClass(".publicBalance", (el: any) => el.innerText = formatPubBalance)
}

// Function to connect wallet
async function connectPublicWallet() {
  // Step 1: Check if injected provider exists (runtime-safe, no TS error)
  if (!Boolean('ethereum' in window)) {
    throw new Error('No Ethereum wallet detected. Please install MetaMask.')
  } else {
    // Step 2: Create wallet client (now TS knows about window.ethereum)
    const walletClient = createWalletClient({
      chain: sepolia, // Change to your chain
      transport: custom(window.ethereum!), // Non-null assertion since we checked existence
    })

    try {
      await walletClient.switchChain({ id: sepolia.id })
      // Step 3: Request account connection (prompts MetaMask popup)
      const addresses = await walletClient.requestAddresses()


      //@ts-ignore ts should fuck off let me just dump shit into window thanks
      window.publicAddress = addresses[0]
      //@ts-ignore ts should fuck off let me just dump shit into window thanks
      window.publicWallet = walletClient
      const wormholeTokenWallet = getContract({ abi: WormholeTokenArtifact.abi, address: wormholeTokenAddress, client: { wallet: walletClient, public: publicClient } }) as unknown as WormholeToken
      //@ts-ignore 
      window.wormholeTokenWallet = wormholeTokenWallet
      await updateWalletInfoUi(wormholeTokenWallet, walletClient, addresses[0])
      return { address: addresses[0], publicWallet: walletClient }
    } catch (error) {
      errorUi("wallet connection failed. try installing metamask?", error)
      throw error
    }
  }
}

async function getPublicWallet() {
  //@ts-ignore
  if (!window.publicWallet) {
    await connectPublicWallet()
  }
  //@ts-ignore
  const publicWallet = window.publicWallet
  //@ts-ignore
  const wormholeTokenWallet = window.wormholeTokenWallet as WormholeToken
  //@ts-ignore
  const publicAddress = window.publicAddress as Address
  return { publicWallet, wormholeTokenWallet, publicAddress }

}

async function connectPrivateWallet() {
  const { publicWallet, publicAddress, wormholeTokenWallet } = await getPublicWallet()
  // TODO this is something only hardhat clients have and now i just pretend that his is a good idea
  // @ts-ignore yeah its bad
  publicWallet.account = { address: publicAddress };
  logUi("creating private account and doing PoW")
  const privateWallet = await getPrivateAccount({ wallet: publicWallet })
  //@ts-ignore ts should fuck off let me just dump shit into window thanks
  window.privateWallet = privateWallet
  //@ts-ignore shut up
  window.wormholeTokenWWallet = wormholeTokenWallet
  await updateWalletInfoUi(wormholeTokenWallet, publicWallet, publicAddress, privateWallet)
  logUi("done!: created new private wallet")
}

async function getPrivateWallet() {
  const { publicWallet, wormholeTokenWallet, publicAddress } = await getPublicWallet()
  //@ts-ignore
  if (!window.privateWallet) {
    await connectPrivateWallet()
  }
  //@ts-ignore
  const privateWallet = window.privateWallet as SyncedPrivateWallet
  return { publicWallet, wormholeTokenWallet, publicAddress, privateWallet }
}

async function mintBtnHandler() {
  const { publicWallet, publicAddress, wormholeTokenWallet } = await getPublicWallet()
  console.log({ wormholeTokenWallet })
  try {
    const tx = await wormholeTokenWallet.write.getFreeTokens([publicAddress], { account: publicAddress as Address, chain: sepolia })
    await txInUi(tx)
  } catch (error) {
    errorUi("aaa that didn't work :( did you cancel it?", error)
  }

  //@ts-ignore
  await updateWalletInfoUi(wormholeTokenWallet, publicWallet, publicAddress, window.privateAddress)
}

async function setToPrivateAddressBtnHandler(where: HTMLElement) {
  const { publicWallet, wormholeTokenWallet, publicAddress, privateWallet } = await getPrivateWallet()
  console.log({ burnAddr: privateWallet.burnAddress })
  //@ts-ignore
  where.value = privateWallet.burnAddress
}

async function setToPublicAddressBtnHandler(where: HTMLElement) {
  const { publicWallet, wormholeTokenWallet, publicAddress } = await getPublicWallet()
  //@ts-ignore
  where.value = publicAddress
}

async function transferBtnHandler() {
  const { publicWallet, wormholeTokenWallet, publicAddress } = await getPublicWallet()
  const decimals = wormholeToken.read.decimals()
  //@ts-ignore
  const amount = parseUnits(transferAmountInputEl.value, Number(await decimals))
  let to
  try {
    //@ts-ignore
    to = getAddress(transferRecipientInputEl.value)
  } catch (error) {
    errorUi("this might not be a valid address?", error)
  }

  try {
    const tx = await wormholeTokenWallet.write.transfer([to as Address, amount], { chain: sepolia, account: publicAddress })
    await txInUi(tx)
  } catch (error) {
    errorUi("Something wrong, did you cancel?", error)
  }

  //@ts-ignore
  await updateWalletInfoUi(wormholeTokenWallet, publicWallet, publicAddress, window.privateWallet)
}

export function addToLocalStorage(key: string, item: any) {
  //@ts-ignore
  let localStore = JSON.parse(localStorage.getItem(wormholeTokenAddress))
  if (!localStore) {
    localStore = {}
  }
  localStore[key] = item
  localStorage.setItem(wormholeTokenAddress, JSON.stringify(localStore))
}
//@ts-ignore
window.addToLocalStorage = addToLocalStorage

export function getFromLocalStorage(key: string) {
  //@ts-ignore
  let localStore = JSON.parse(localStorage.getItem(wormholeTokenAddress))
  if (!localStore) {
    localStore = {}
    localStorage.setItem(wormholeTokenAddress, JSON.stringify(localStore))
  }
  return localStore[key]
}
//@ts-ignore
window.addToLocalStorage = addToLocalStorage
const relayerInputsLocalStoreName = "relayerInputs"

export function addRelayInputsToLocalStorage(relayInputs: RelayerInputs) {
  const relayerInputsHex = convertRelayerInputsToHex(relayInputs)
  let allRelayerInputs = getFromLocalStorage(relayerInputsLocalStoreName)
  allRelayerInputs ??= []
  allRelayerInputs.push(relayerInputsHex)
  addToLocalStorage(relayerInputsLocalStoreName, allRelayerInputs)
}

export async function getRelayInputsToLocalStorage(): Promise<RelayerInputs[]> {
  const allRelayerInputs = getFromLocalStorage(relayerInputsLocalStoreName)
  const allRelayerInputClean: RelayerInputs[] = []
  for (const relayerInputHex of allRelayerInputs) {
    const relayerInputNormal = convertRelayerInputsFromHex(relayerInputHex)
    const isNullified = Boolean(await wormholeToken.read.nullifiers([relayerInputNormal.pubInputs.accountNoteNullifier]))
    if (!isNullified) {
      allRelayerInputClean.push(relayerInputNormal)
    }
  }
  return allRelayerInputClean
}

async function proofPrivateTransferBtnHandler() {
  const { publicWallet, wormholeTokenWallet, publicAddress, privateWallet } = await getPrivateWallet()
  const decimals = Number(await wormholeToken.read.decimals())
  let amount
  let recipient
  try {
    //@ts-ignore
    recipient = getAddress(privateTransferRecipientInputEl.value)
  } catch (error) {
    errorUi("something went wrong, is it a real address?", error)
  }

  try {
    //@ts-ignore
    amount = parseUnits(privateTransferAmountInputEl.value, decimals)
  } catch (error) {
    errorUi("something went wrong, is this not a valid number?", error)

  }
  // const tx = await proofAndSelfRelay({
  //   publicClient:publicClient,
  //   wormholeToken:wormholeTokenWallet,
  //   privateWallet:privateWallet,
  //   amount:amount as bigint,
  //   recipient:recipient as Address,
  //   backend:backend
  // })

  logUi("creating proof")
  const relayerInputs = await createRelayerInputs({
    wormholeToken,
    privateWallet,
    publicClient,
    amount: amount as bigint,
    recipient: recipient as Address,
    feeData: EMPTY_FEE_DATA,
    backend
  })
  logUi("done")
  addRelayInputsToLocalStorage(relayerInputs)
  //await txInUi(tx)
  updateWalletInfoUi(wormholeTokenWallet, publicWallet, publicAddress, privateWallet)
  listPendingRelayTxs()
}

async function listPendingRelayTxs() {
  const relayInputs = await getRelayInputsToLocalStorage()
  const decimals = Number(await wormholeToken.read.decimals())
  for (const relayInput of relayInputs) {
    const relayFunc = async () => {
      const { publicWallet, publicAddress, wormholeTokenWallet } = await getPublicWallet()
      publicWallet.account = {address: publicAddress}
      await relayTx({
        relayerInputs: relayInput,
        ethWallet: publicWallet,
        publicClient: publicClient,
        wormholeToken: wormholeTokenWallet
      })
    }
    const relayTxBtn = document.createElement("button")
    relayTxBtn.onclick = relayFunc
    relayTxBtn.innerText = `relay tx: ${formatUnits(relayInput.pubInputs.amount, Number(decimals))} tokens to ${relayInput.pubInputs.recipientAddress}`
    pendingRelayTxsEl?.append(relayTxBtn)
  }

}

document.getElementById('connectPublicWalletBtn')?.addEventListener('click', connectPublicWallet)
document.getElementById('connectPrivateWalletBtn')?.addEventListener('click', connectPrivateWallet)
document.getElementById('mintBtn')?.addEventListener('click', mintBtnHandler)
//@ts-ignore
document.getElementById('setToPrivateWalletBtn')?.addEventListener('click', async () => setToPrivateAddressBtnHandler(transferRecipientInputEl))
//@ts-ignore
document.getElementById('setToPublicWalletBtn')?.addEventListener('click', async () => setToPublicAddressBtnHandler(transferRecipientInputEl))
//@ts-ignore
document.getElementById('setPrivateTransferToPrivateWalletBtn')?.addEventListener('click', async () => setToPrivateAddressBtnHandler(privateTransferRecipientInputEl))
document.getElementById('transferBtn')?.addEventListener('click', transferBtnHandler)
//@ts-ignore
document.getElementById('setPrivateTransferToPublicWalletBtn')?.addEventListener('click', async () => setToPublicAddressBtnHandler(privateTransferRecipientInputEl))

document.getElementById('proofPrivaterTransferBtn')?.addEventListener('click', proofPrivateTransferBtnHandler)
listPendingRelayTxs()