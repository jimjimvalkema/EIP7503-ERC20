import { createPublicClient, createWalletClient, custom, formatUnits, getAddress, getContract, http, parseUnits } from 'viem'
import type { Address, Hex, WalletClient } from 'viem'
import { sepolia } from 'viem/chains'
import 'viem/window';
import { PrivateWallet } from '../src/PrivateWallet.js';
import type { WormholeToken, SelfRelayInputs } from '../src/types.js';
import { createRelayerInputs, selfRelayTx } from '../src/transact.js';
import { getBackend } from '../src/proving.js';
import WormholeTokenArtifact from '../artifacts/contracts/WormholeToken.sol/WormholeToken.json'  with {"type":"json"};
import sepoliaDeployments from "../ignition/deployments/chain-11155111/deployed_addresses.json" with {"type":"json"};
import type { WormholeTokenTest } from '../test/2inRemint.test.ts';

const CIRCUIT_SIZE = 2

const wormholeTokenAddress = sepoliaDeployments['wormholeToken#WormholeToken'] as Address;
//@ts-ignore
window.wormholeTokenAddress = wormholeTokenAddress
console.log({ wormholeTokenAddress })

const logEl = document.getElementById("messages")
const errorEl = document.getElementById("errors")
const transferRecipientInputEl = document.getElementById('transferRecipientInput')
const transferAmountInputEl = document.getElementById('transferAmountInput')
const privateTransferRecipientInputEl = document.getElementById("privateTransferRecipientInput")
const privateTransferAmountInputEl = document.getElementById("privateTransferAmountInput")
const pendingRelayTxsEl = document.getElementById("pendingRelayTxs")

const backend = await getBackend(CIRCUIT_SIZE,window.navigator.hardwareConcurrency)

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.ETHEREUM_RPC),
})

const wormholeToken = getContract({ abi: WormholeTokenArtifact.abi, address: wormholeTokenAddress, client: { public: publicClient } }) as unknown as WormholeToken
setNonWalletInfo(wormholeToken)

// --- helpers ---

function errorUi(message: string, error: unknown, replace = false) {
  if (replace) {
    errorEl!.innerText = ""
  }
  errorEl!.innerText += `\n ${message + "\n" + (error as Error).toString()}`
  throw new Error(message, { cause: error })
}

function logUi(message: string, replace = false) {
  if (replace) {
    logEl!.innerText = ""
  }
  logEl!.innerText += `\n ${message}`
  console.log(message)
}

async function everyClass(className: string, func: (el: HTMLElement) => void) {
  document.querySelectorAll(className).forEach(async (el) => {
    await func(el as HTMLElement)
  })
}

async function txInUi(txHash: Hex) {
  logUi(`tx sent at: https://sepolia.etherscan.io/tx/${txHash}`)
  await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1
  })
}

// --- localStorage relay queue ---

export function addToLocalStorage(key: string, item: any) {
  let localStore = JSON.parse(localStorage.getItem(wormholeTokenAddress) || '{}')
  localStore[key] = item
  localStorage.setItem(wormholeTokenAddress, JSON.stringify(localStore))
}
//@ts-ignore
window.addToLocalStorage = addToLocalStorage

export function getFromLocalStorage(key: string) {
  let localStore = JSON.parse(localStorage.getItem(wormholeTokenAddress) || '{}')
  return localStore[key]
}

const relayerInputsLocalStoreName = "relayerInputs"

export function addRelayInputsToLocalStorage(relayInputs: SelfRelayInputs) {
  let allRelayerInputs = getFromLocalStorage(relayerInputsLocalStoreName)
  allRelayerInputs ??= []
  allRelayerInputs.push(relayInputs)
  addToLocalStorage(relayerInputsLocalStoreName, allRelayerInputs)
}

export async function getRelayInputsFromLocalStorage(): Promise<SelfRelayInputs[]> {
  const allRelayerInputs:SelfRelayInputs[] = getFromLocalStorage(relayerInputsLocalStoreName)
  console.log({allRelayerInputs})
  if (!allRelayerInputs) return []
  const allRelayerInputClean: SelfRelayInputs[] = []
  for (const relayerInput of allRelayerInputs) {
    
    const blockNumbers = await Promise.all(relayerInput.publicInputs.burn_data_public.map((bData)=>wormholeToken.read.nullifiers([BigInt(bData.account_note_nullifier)])))
    if (blockNumbers.every((b)=>b===0n)) {
      allRelayerInputClean.push(relayerInput)
    }
  }
  return allRelayerInputClean
}

// --- non-wallet info ---

async function setNonWalletInfo(wormholeToken: WormholeToken) {
  const amountFreeTokens = wormholeToken.read.amountFreeTokens()
  const name = wormholeToken.read.name()
  const ticker = wormholeToken.read.symbol()
  const decimals = wormholeToken.read.decimals()
  const formatAmountFreeTokens = formatUnits(await amountFreeTokens, Number(await decimals))
  everyClass(".amountFreeTokens", (el) => { el.innerText = formatAmountFreeTokens })
  everyClass(".ticker", async (el) => el.innerText = await ticker)
  everyClass(".tokenName", async (el) => el.innerText = await name)
}

// --- wallet info ui ---

async function updateWalletInfoUi(
  wormholeTokenWallet: WormholeToken,
  publicAddress: Address,
  burnAddress?: Address
) {
  everyClass(".publicAddress", (el) => el.innerText = publicAddress)
  const decimals = Number(await wormholeTokenWallet.read.decimals())
  const publicBalance = await wormholeTokenWallet.read.balanceOf([publicAddress])
  everyClass(".publicBalance", (el) => el.innerText = formatUnits(publicBalance, decimals))

  if (burnAddress) {
    everyClass(".burnAddress", (el) => el.innerText = burnAddress)
    const burnedBalance = await wormholeTokenWallet.read.balanceOf([burnAddress])
    everyClass(".privateBurnedBalance", (el) => el.innerText = formatUnits(burnedBalance, decimals))
  }
}

// --- wallet connection ---

async function connectPublicWallet() {
  if (!('ethereum' in window)) {
    throw new Error('No Ethereum wallet detected. Please install MetaMask.')
  }

  const walletClient = createWalletClient({
    chain: sepolia,
    transport: custom(window.ethereum!),
  })

  try {
    await walletClient.switchChain({ id: sepolia.id })
    const addresses = await walletClient.requestAddresses()

    //@ts-ignore
    window.publicAddress = addresses[0]
    //@ts-ignore
    window.publicWallet = walletClient

    const wormholeTokenWallet = getContract({
      abi: WormholeTokenArtifact.abi,
      address: wormholeTokenAddress,
      client: { wallet: walletClient, public: publicClient }
    }) as unknown as WormholeToken

    //@ts-ignore
    window.wormholeTokenWallet = wormholeTokenWallet
    await updateWalletInfoUi(wormholeTokenWallet, addresses[0])
    return { address: addresses[0], publicWallet: walletClient }
  } catch (error) {
    errorUi("wallet connection failed. try installing metamask?", error)
    throw error
  }
}

async function getPublicWallet() {
  //@ts-ignore
  if (!window.publicWallet) {
    await connectPublicWallet()
  }
  //@ts-ignore
  const publicWallet = window.publicWallet as WalletClient
  //@ts-ignore
  const wormholeTokenWallet = window.wormholeTokenWallet as WormholeToken
  //@ts-ignore
  const publicAddress = window.publicAddress as Address
  return { publicWallet, wormholeTokenWallet, publicAddress }
}

async function connectPrivateWallet() {
  const { publicWallet, publicAddress, wormholeTokenWallet } = await getPublicWallet()

  //@ts-ignore
  publicWallet.account = { address: publicAddress }

  const chainId = BigInt(await publicClient.getChainId())
  const privateWallet = new PrivateWallet(publicWallet, { acceptedChainIds: [chainId] })
  logUi("creating private wallet...\n please sign the message in your wallet")
  await privateWallet.getDeterministicViewKeyRoot()
  const burnAccountPromise = privateWallet.createBurnAccountFromViewKeyIndex({ async: true, viewingKeyIndex:0});

  // Animated PoW loading indicator
  let dotCount = 0;
  const powInterval = setInterval(() => {
    dotCount = (dotCount % 3) + 1;
    logUi("doing PoW" + ".".repeat(dotCount), true);
  }, 500);

  const burnAccount = await burnAccountPromise;
  clearInterval(powInterval);
  logUi("PoW complete!");

  //@ts-ignore
  window.privateWallet = privateWallet
  //@ts-ignore
  window.burnAccount = burnAccount

  await updateWalletInfoUi(wormholeTokenWallet, publicAddress, burnAccount.burnAddress)
  logUi("done! created new private wallet")
}

async function getPrivateWallet() {
  const { publicWallet, wormholeTokenWallet, publicAddress } = await getPublicWallet()
  //@ts-ignore
  if (!window.privateWallet) {
    await connectPrivateWallet()
  }
  //@ts-ignore
  const privateWallet = window.privateWallet as PrivateWallet
  //@ts-ignore
  const burnAccount = window.burnAccount
  return { publicWallet, wormholeTokenWallet, publicAddress, privateWallet, burnAccount }
}

// --- handlers ---

async function mintBtnHandler() {
  const { publicAddress, wormholeTokenWallet } = await getPublicWallet()
  try {
    const tx = await wormholeTokenWallet.write.getFreeTokens([publicAddress], { account: publicAddress, chain: sepolia })
    await txInUi(tx)
  } catch (error) {
    errorUi("aaa that didn't work :( did you cancel it?", error)
  }

  //@ts-ignore
  await updateWalletInfoUi(wormholeTokenWallet, publicAddress, window.burnAccount?.burnAddress)
}

async function setToPrivateAddressBtnHandler(where: HTMLElement) {
  const { burnAccount } = await getPrivateWallet()
  ;(where as HTMLInputElement).value = burnAccount.burnAddress
}

async function setToPublicAddressBtnHandler(where: HTMLElement) {
  const { publicAddress } = await getPublicWallet()
  ;(where as HTMLInputElement).value = publicAddress
}

async function transferBtnHandler() {
  const { wormholeTokenWallet, publicAddress } = await getPublicWallet()
  const decimals = Number(await wormholeToken.read.decimals())
  const amount = parseUnits((transferAmountInputEl as HTMLInputElement).value, decimals)

  let to: Address
  try {
    to = getAddress((transferRecipientInputEl as HTMLInputElement).value)
  } catch (error) {
    errorUi("this might not be a valid address?", error)
    return
  }

  try {
    const tx = await wormholeTokenWallet.write.transfer([to, amount], { chain: sepolia, account: publicAddress })
    await txInUi(tx)
  } catch (error) {
    errorUi("Something wrong, did you cancel?", error)
  }

  //@ts-ignore
  await updateWalletInfoUi(wormholeTokenWallet, publicAddress, window.burnAccount?.burnAddress)
}

async function proofPrivateTransferBtnHandler() {
  const { wormholeTokenWallet, publicAddress, privateWallet, burnAccount } = await getPrivateWallet()
  const decimals = Number(await wormholeToken.read.decimals())

  let recipient: Address
  try {
    recipient = getAddress((privateTransferRecipientInputEl as HTMLInputElement).value)
  } catch (error) {
    errorUi("something went wrong, is it a real address?", error)
    return
  }

  let amount: bigint
  try {
    amount = parseUnits((privateTransferAmountInputEl as HTMLInputElement).value, decimals)
  } catch (error) {
    errorUi("something went wrong, is this not a valid number?", error)
    return
  }

  try {
    logUi("creating proof...")
    const chainId = BigInt(await publicClient.getChainId())
    const relayerInputs = await createRelayerInputs({
      chainId,
      wormholeToken,
      privateWallet,
      burnAddresses: [burnAccount.burnAddress],
      archiveClient: publicClient,
      amount,
      recipient,
      backend
    }) as SelfRelayInputs
    logUi("proof done! saved to pending relay txs")
    addRelayInputsToLocalStorage(relayerInputs)
  } catch (error) {
    errorUi("proof creation failed", error)
  }

  await updateWalletInfoUi(wormholeTokenWallet, publicAddress, burnAccount.burnAddress)
  await listPendingRelayTxs()
}

async function listPendingRelayTxs() {
  pendingRelayTxsEl!.innerHTML = ""
  const relayInputs = await getRelayInputsFromLocalStorage()
  console.log({relayInputs})
  const decimals = Number(await wormholeToken.read.decimals())
  for (const relayInput of relayInputs) {
    const relayFunc = async () => {
      const { publicWallet, publicAddress, wormholeTokenWallet } = await getPublicWallet()
      //@ts-ignore
      publicWallet.account = { address: publicAddress }
      try {
      const tx = await selfRelayTx({
        selfRelayInputs: relayInput,
        wallet: publicWallet,
        wormholeTokenContract: wormholeTokenWallet as WormholeTokenTest
      })
        await txInUi(tx)
        await listPendingRelayTxs()
        //@ts-ignore
        await updateWalletInfoUi(wormholeTokenWallet, publicAddress, window.burnAccount?.burnAddress)
      } catch (error) {
        errorUi("relay failed", error)
      }
    }
    const relayTxBtn = document.createElement("button")
    relayTxBtn.onclick = relayFunc
    console.log({relayInput})
    relayTxBtn.innerText = `relay tx: ${formatUnits(BigInt(relayInput.publicInputs.amount), decimals)} tokens to ${relayInput.signatureInputs.recipient}`
    const li = document.createElement("li")
    li.appendChild(relayTxBtn)
    pendingRelayTxsEl!.appendChild(li)
  }
}

// --- event listeners ---

document.getElementById('connectPublicWalletBtn')?.addEventListener('click', connectPublicWallet)
document.getElementById('connectPrivateWalletBtn')?.addEventListener('click', connectPrivateWallet)
document.getElementById('mintBtn')?.addEventListener('click', mintBtnHandler)
document.getElementById('setToPrivateWalletBtn')?.addEventListener('click', () => setToPrivateAddressBtnHandler(transferRecipientInputEl!))
document.getElementById('setToPublicWalletBtn')?.addEventListener('click', () => setToPublicAddressBtnHandler(transferRecipientInputEl!))
document.getElementById('setPrivateTransferToPrivateWalletBtn')?.addEventListener('click', () => setToPrivateAddressBtnHandler(privateTransferRecipientInputEl!))
document.getElementById('setPrivateTransferToPublicWalletBtn')?.addEventListener('click', () => setToPublicAddressBtnHandler(privateTransferRecipientInputEl!))
document.getElementById('transferBtn')?.addEventListener('click', transferBtnHandler)
document.getElementById('proofPrivaterTransferBtn')?.addEventListener('click', proofPrivateTransferBtnHandler)

listPendingRelayTxs()