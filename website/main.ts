import { createPublicClient, createWalletClient, custom, formatUnits, getAddress, getContract, http, parseUnits } from 'viem'
import type { Address, Hex, WalletClient } from 'viem'
import { sepolia } from 'viem/chains'
import 'viem/window';
import { PrivateWallet } from '../src/PrivateWallet.js';
import type { WormholeToken, SelfRelayInputs, BurnAccount, SyncedBurnAccount } from '../src/types.js';
import { createRelayerInputs, selfRelayTx } from '../src/transact.js';
import { getBackend } from '../src/proving.js';
import WormholeTokenArtifact from '../artifacts/contracts/WormholeToken.sol/WormholeToken.json'  with {"type": "json"};
import sepoliaDeployments from "../ignition/deployments/chain-11155111/deployed_addresses.json" with {"type": "json"};
import type { WormholeTokenTest } from '../test/2inRemint.test.ts';

import * as viem from 'viem'
import { ADDED_BITS_SECURITY, POW_BITS } from '../src/constants.ts';
import { syncBurnAccount } from '../src/syncing.ts';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const POW_EXPLANATION_MSG = `
The PoW is to generate a valid burn address, a PoW verification was added to the circuit since eth addresses are only 160 bits (20 bytes) and there for only have 80 bits of security against collision attacks. 
<br>See <a href="https://github.com/jimjimvalkema/EIP7503-ERC20/tree/f191226b323340f7f1c1b95ab42a68342860acb6?tab=readme-ov-file#burn-address-and-the-10-billion-collision-attack-eip-3607">readme</a> for more info.
<br>This PoW is ${Number(POW_BITS)} bits and adds ${Number(ADDED_BITS_SECURITY)} bits since it's only applied to one hash (the burn address).
<br>The original cost of attack was assumed to be $10 billion in EIP-3607. 
<br>With this PoW the new estimated cost of attack is $10B × 2^(PoW_Bits/2).
<br>So with this PoW the new attack cost is: $${new Intl.NumberFormat("en-US", { notation: "compact", compactDisplay: "long" }).format(10_000_000_000 * 2 ** (Number(POW_BITS) / 2))}.
`

const BURN_ACCOUNT_SYNCING_MSG = `
syncing the burn account by looking for nullifiers with an account nonce that incrementally go up.
<br> So it looks for <code>nullifier=poseidon2(viewing_key, account_nonce+=1)</code>
<br> Then it also looks for a encrypted blob that contains the total amount spent of that burn account.
`

const CIRCUIT_SIZE = 2

const wormholeTokenAddress = sepoliaDeployments['wormholeToken#WormholeToken'] as Address;
//@ts-ignore
window.wormholeTokenAddress = wormholeTokenAddress
//@ts-ignore
window.viem = viem
console.log({ wormholeTokenAddress })

const logEl = document.getElementById("messages")
const errorEl = document.getElementById("errors")
const transferRecipientInputEl = document.getElementById('transferRecipientInput')
const transferAmountInputEl = document.getElementById('transferAmountInput')
const privateTransferRecipientInputEl = document.getElementById("privateTransferRecipientInput")
const privateTransferAmountInputEl = document.getElementById("privateTransferAmountInput")
const pendingRelayTxsEl = document.getElementById("pendingRelayTxs")

const backend = await getBackend(CIRCUIT_SIZE, window.navigator.hardwareConcurrency)

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

function logUi(message: string, replace = false, useHtml = false) {
  if (replace) {
    logEl!.innerHTML = ""
  }
  if (useHtml) {
    logEl!.innerHTML += `\n ${message}`
  } else {
    logEl!.innerText += `\n ${message}`
  }
  console.log(message)
}

async function everyClass(className: string, func: (el: HTMLElement) => void) {
  document.querySelectorAll(className).forEach(async (el) => {
    await func(el as HTMLElement)
  })
}

async function txInUi(txHash: Hex) {
  logUi(`tx sent at: https://sepolia.etherscan.io/tx/${txHash}`, true)
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
  const allRelayerInputs: SelfRelayInputs[] = getFromLocalStorage(relayerInputsLocalStoreName)
  console.log({ allRelayerInputs })
  if (!allRelayerInputs) return []
  const allRelayerInputClean: SelfRelayInputs[] = []
  for (const relayerInput of allRelayerInputs) {

    const blockNumbers = await Promise.all(relayerInput.publicInputs.burn_data_public.map((bData) => wormholeToken.read.nullifiers([BigInt(bData.account_note_nullifier)])))
    if (blockNumbers.every((b) => b === 0n)) {
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
  burnAccount?: BurnAccount
) {

  everyClass(".publicAddress", (el) => el.innerText = publicAddress)
  const decimals = Number(await wormholeTokenWallet.read.decimals())
  const publicBalance = await wormholeTokenWallet.read.balanceOf([publicAddress])
  everyClass(".publicBalance", (el) => el.innerText = formatUnits(publicBalance, decimals))
  console.log({ burnAccount })
  if (burnAccount) {
    const syncedBurnAccountPromise = syncBurnAccount({ wormholeToken: wormholeTokenWallet, burnAccount: burnAccount, archiveNode: publicClient });
    let dotCount = 0;
    const powInterval = setInterval(() => {
      dotCount = (dotCount % 5) + 1;
      logUi(
        POW_EXPLANATION_MSG + `<br><br>` +
        "----------Syncing burn Account" + ".".repeat(dotCount) + `<br>` +
        BURN_ACCOUNT_SYNCING_MSG + `<br>` +
        "----------Syncing burn Account" + ".".repeat(dotCount)
        , true, true);
    }, 500);
    const syncedBurnAccount = await syncedBurnAccountPromise;
    clearInterval(powInterval);
    everyClass(".burnAddress", (el) => el.innerText = burnAccount.burnAddress)
    everyClass(".privateBurnedBalance", (el) => el.innerText = formatUnits(BigInt(syncedBurnAccount.totalBurned), decimals))
    everyClass(".privateSpentBalance", (el) => el.innerText = formatUnits(BigInt(syncedBurnAccount.totalSpent), decimals))
    everyClass(".privateSpendableBalance", (el) => el.innerText = formatUnits(BigInt(syncedBurnAccount.spendableBalance), decimals))
    everyClass(".privateAccountNonce", (el) => el.innerText = Number(syncedBurnAccount.accountNonce).toString())
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
  const POW_DIFFICULTY = BigInt(await wormholeTokenWallet.read.POW_DIFFICULTY())
  const privateWallet = new PrivateWallet(publicWallet, POW_DIFFICULTY, { acceptedChainIds: [chainId] })
  logUi("creating private wallet...\n please sign the message in your wallet", true)
  await privateWallet.getDeterministicViewKeyRoot()
  const burnAccountPromise = privateWallet.createBurnAccountFromViewKeyIndex({ async: true, viewingKeyIndex: 0 });

  // Animated PoW loading indicator
  let dotCount = 0;
  const powInterval = setInterval(() => {
    dotCount = (dotCount % 5) + 1;
    logUi(
      "----------doing PoW" + ".".repeat(dotCount) + `<br>` +
      POW_EXPLANATION_MSG + `<br>` +
      "----------doing PoW" + ".".repeat(dotCount)
      , true, true);
  }, 500);

  const burnAccount = await burnAccountPromise;
  clearInterval(powInterval);
  logUi("<br>PoW complete!", false, true);

  //@ts-ignore
  window.privateWallet = privateWallet
  //@ts-ignore
  window.burnAccount = burnAccount

  await updateWalletInfoUi(wormholeTokenWallet, publicAddress, burnAccount)
  logUi("<br>done! created new private wallet", false, true)
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
  await updateWalletInfoUi(wormholeTokenWallet, publicAddress, window.burnAccount)
}

async function setToPrivateAddressBtnHandler(where: HTMLElement) {
  const { burnAccount } = await getPrivateWallet()
    ; (where as HTMLInputElement).value = burnAccount.burnAddress
}

async function setToPublicAddressBtnHandler(where: HTMLElement) {
  const { publicAddress } = await getPublicWallet()
    ; (where as HTMLInputElement).value = publicAddress
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
  await updateWalletInfoUi(wormholeTokenWallet, publicAddress, window.burnAccount)
}

async function proofPrivateTransferBtnHandler() {
  const { wormholeTokenWallet, publicAddress, privateWallet, burnAccount } = await getPrivateWallet()
  console.log({ data: privateWallet.privateData })
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

  // Animated PoW loading indicator
  let dotCount = 0;
  const powInterval = setInterval(() => {
    dotCount = (dotCount % 5) + 1;
    logUi(
      "creating proof..." + ".".repeat(dotCount)
      , true, true);
  }, 500);
  try {
    const chainId = BigInt(await publicClient.getChainId())
    const relayInputsPromise = createRelayerInputs(
      recipient,
      amount,
      privateWallet,
      wormholeToken,
      publicClient,
      {
        chainId,
        burnAddresses: [burnAccount.burnAddress],
        backend
      })

    const { relayInputs: relayerInputs, syncedData: { syncedPrivateWallet, syncedTree } } = await relayInputsPromise
    addRelayInputsToLocalStorage(relayerInputs)
    console.log({burnAccountsSynced:syncedPrivateWallet.privateData.burnAccounts})
    //@ts-ignore
    window.burnAccount = syncedPrivateWallet.privateData.burnAccounts[0]
    //@ts-ignore
    window.merkleTree = syncedTree
  } catch (error) {
    errorUi("proof creation failed", error)
  }
  clearInterval(powInterval);
  logUi("proof done! saved to pending relay txs")
  //@ts-ignore
  const syncedBurnAccount = window.burnAccount as SyncedBurnAccount
  await updateWalletInfoUi(wormholeTokenWallet, publicAddress, syncedBurnAccount as SyncedBurnAccount)
  await listPendingRelayTxs()
}

async function listPendingRelayTxs() {
  pendingRelayTxsEl!.innerHTML = ""
  const relayInputs = await getRelayInputsFromLocalStorage()
  console.log({ relayInputs })
  const decimals = Number(await wormholeToken.read.decimals())
  for (const relayInput of relayInputs) {
    const relayFunc = async () => {
      const { publicWallet, publicAddress, wormholeTokenWallet } = await getPublicWallet()
      //@ts-ignore
      publicWallet.account = { address: publicAddress }
      try {
        const tx = await selfRelayTx(
          relayInput,
          publicWallet,
          wormholeTokenWallet as WormholeTokenTest
        )
        await txInUi(tx)
        await listPendingRelayTxs()
        //@ts-ignore
        await updateWalletInfoUi(wormholeTokenWallet, publicAddress, window.burnAccount)
      } catch (error) {
        errorUi("relay failed", error)
      }
    }
    const relayTxBtn = document.createElement("button")
    relayTxBtn.onclick = relayFunc
    console.log({ relayInput })
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