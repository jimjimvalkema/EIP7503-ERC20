import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  namehash,
  defineChain,
} from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";

declare global {
  interface Window {
    ethereum?: any;
  }
}

const sepolia = /*#__PURE__*/ defineChain({
  id: 11_155_111,
  name: "Sepolia",
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://ethereum-sepolia-rpc.publicnode.com"],
    },
  },
  blockExplorers: {
    default: {
      name: "Etherscan",
      url: "https://sepolia.etherscan.io",
      apiUrl: "https://api-sepolia.etherscan.io/api",
    },
  },
  contracts: {
    multicall3: {
      address: "0xca11bde05977b3631167028862be2a173976ca11",
      blockCreated: 751532,
    },
    ensUniversalResolver: {
      address: "0xeeeeeeee14d718c2b47d9923deab1335e144eeee",
      blockCreated: 8_928_790,
    },
  },
  testnet: true,
});
/**
 * Create a public client for reading ENS records
 */
function getPublicClient() {
  return createPublicClient({
    chain: sepolia,
    transport: http(),
  });
}

/**
 * Create a wallet client for writing ENS records
 */
function getWalletClient() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("Ethereum provider not available");
  }

  return createWalletClient({
    chain: sepolia,
    transport: custom(window.ethereum),
  });
}

/**
 * Fetch an ENS text record
 * @param name - ENS name (e.g., 'nick.eth')
 * @param key - Text record key (e.g., 'com.twitter', 'description', 'avatar')
 * @returns The text record value or null if not found
 */
export async function getEnsText(
  name: string,
  key: string,
): Promise<string | null> {
  try {
    const publicClient = getPublicClient();
    const ensText = await publicClient.getEnsText({
      name: normalize(name),
      key,
    });
    return ensText || null;
  } catch (error) {
    console.error(`Failed to fetch ENS text record for ${name}:${key}`, error);
    return null;
  }
}

/**
 * Fetch multiple ENS text records at once
 * @param name - ENS name (e.g., 'nick.eth')
 * @param keys - Array of text record keys
 * @returns Object with keys as property names and their values
 */
export async function getEnsTexts(
  name: string,
  keys: string[],
): Promise<Record<string, string | null>> {
  const results: Record<string, string | null> = {};

  for (const key of keys) {
    results[key] = await getEnsText(name, key);
  }

  return results;
}

/**
 * Fetch an ENS address record
 * @param name - ENS name (e.g., 'nick.eth')
 * @param coinType - Optional coin type (defaults to ETH)
 * @returns The address or null if not found
 */
export async function getEnsAddress(
  name: string,
  coinType?: bigint,
): Promise<Address | null> {
  try {
    const publicClient = getPublicClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const address = await (publicClient as any).getEnsAddress({
      name: normalize(name),
      coinType,
    });
    return address || null;
  } catch (error) {
    console.error(`Failed to fetch ENS address for ${name}`, error);
    return null;
  }
}

/**
 * Get the resolver address for an ENS name
 * @param name - ENS name (e.g., 'nick.eth')
 * @returns The resolver address or null if not found
 */
export async function getEnsResolver(name: string): Promise<Address | null> {
  try {
    const publicClient = getPublicClient();
    const resolver = await publicClient.getEnsResolver({
      name: normalize(name),
    });
    return resolver || null;
  } catch (error) {
    console.error(`Failed to fetch ENS resolver for ${name}`, error);
    return null;
  }
}

/**
 * Set an ENS text record
 * Requires the user to be connected with a wallet and be the owner of the name
 * @param name - ENS name (e.g., 'nick.eth')
 * @param key - Text record key (e.g., 'com.twitter', 'description', 'avatar')
 * @param value - The value to set
 * @param resolverAddress - Optional resolver address (will be fetched if not provided)
 * @returns Transaction hash
 */
export async function setEnsText(
  name: string,
  key: string,
  value: string,
  resolverAddress?: Address,
): Promise<string> {
  try {
    const walletClient = getWalletClient();
    const normalizedName = normalize(name);

    // Get resolver address if not provided
    let resolver = resolverAddress;
    if (!resolver) {
      const resolvedAddress = await getEnsResolver(normalizedName);
      if (!resolvedAddress) {
        throw new Error(`No resolver found for ${name}`);
      }
      resolver = resolvedAddress;
    }

    // Calculate the node hash for the name
    const node = namehash(normalizedName);

    // Get the connected account
    const account = (await walletClient.getAddresses())[0];
    if (!account) {
      throw new Error("No account available in wallet");
    }

    // Call setText on the resolver contract
    const hash = await walletClient.writeContract({
      account,
      address: resolver,
      abi: [
        {
          inputs: [
            { name: "node", type: "bytes32" },
            { name: "key", type: "string" },
            { name: "value", type: "string" },
          ],
          name: "setText",
          outputs: [],
          stateMutability: "nonpayable",
          type: "function",
        },
      ],
      functionName: "setText",
      args: [node, key, value],
    });

    return hash;
  } catch (error) {
    console.error(`Failed to set ENS text record for ${name}:${key}`, error);
    throw error;
  }
}

/**
 * Set multiple ENS text records at once
 * Requires the user to be connected with a wallet and be the owner of the name
 * @param name - ENS name (e.g., 'nick.eth')
 * @param records - Object with keys as text record keys and values as their values
 * @param resolverAddress - Optional resolver address
 * @returns Array of transaction hashes
 */
export async function setEnsTexts(
  name: string,
  records: Record<string, string>,
  resolverAddress?: Address,
): Promise<string[]> {
  const hashes: string[] = [];

  for (const [key, value] of Object.entries(records)) {
    const hash = await setEnsText(name, key, value, resolverAddress);
    hashes.push(hash);
  }

  return hashes;
}

/**
 * Check if a resolver supports a specific interface
 * @param resolverAddress - Resolver contract address
 * @param interfaceId - Interface ID (4-byte hex value, e.g., '0x10f13a8c')
 * @returns True if the interface is supported
 */
export async function supportsInterface(
  resolverAddress: Address,
  interfaceId: string,
): Promise<boolean> {
  try {
    const publicClient = getPublicClient();
    const result = await publicClient.readContract({
      address: resolverAddress,
      abi: [
        {
          inputs: [{ name: "interfaceID", type: "bytes4" }],
          name: "supportsInterface",
          outputs: [{ name: "", type: "bool" }],
          stateMutability: "pure",
          type: "function",
        },
      ],
      functionName: "supportsInterface",
      args: [interfaceId as any],
    });
    return result as boolean;
  } catch (error) {
    console.error(
      `Failed to check interface support for ${resolverAddress}`,
      error,
    );
    return false;
  }
}
