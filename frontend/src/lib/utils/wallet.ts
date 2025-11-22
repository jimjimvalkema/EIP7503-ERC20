import {
  createPublicClient,
  http,
  isAddress,
  getAddress,
  type Address,
  defineChain,
} from "viem";
import { normalize } from "viem/ens";
import { getEnsAddress } from "../ens";

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
 * Create a public client for wallet operations
 */
function getPublicClient() {
  return createPublicClient({
    chain: sepolia,
    transport: http(),
  });
}

/**
 * Validate if a string is a valid Ethereum address
 * @param address - Address to validate
 * @returns true if valid address format
 */
export function isValidAddress(address: string): boolean {
  return isAddress(address);
}

/**
 * Resolve a wallet address from either an address string or ENS name
 * @param input - Ethereum address or ENS name (e.g., '0x123...' or 'vitalik.eth')
 * @returns Resolved address or null if not found
 */
export async function resolveWalletAddress(
  input: string,
): Promise<Address | null> {
  try {
    // First, check if it's already a valid address
    if (isValidAddress(input)) {
      return getAddress(input);
    }

    // Try to resolve as ENS name
    try {
      const normalizedName = normalize(input);
      const address = await getEnsAddress(normalizedName);
      if (address) {
        return address;
      }
    } catch (error) {
      // Not a valid ENS name, continue
    }

    return null;
  } catch (error) {
    console.error(`Failed to resolve wallet address for ${input}`, error);
    return null;
  }
}

/**
 * Validate if an address has a resolver (for ENS operations)
 * @param address - Ethereum address to check
 * @returns true if address has a resolver
 */
export async function hasResolver(address: Address): Promise<boolean> {
  try {
    const publicClient = getPublicClient();
    const resolver = await publicClient.getEnsResolver({
      name: address,
    });
    return resolver !== null && resolver !== undefined;
  } catch (error) {
    return false;
  }
}

/**
 * Get ENS name from an address (reverse lookup)
 * @param address - Ethereum address
 * @returns ENS name or null if not found
 */
export async function getEnsName(address: Address): Promise<string | null> {
  try {
    const publicClient = getPublicClient();
    const ensName = await publicClient.getEnsName({
      address,
    });
    return ensName || null;
  } catch (error) {
    console.error(`Failed to get ENS name for ${address}`, error);
    return null;
  }
}

/**
 * Get resolver address for a given address
 * @param address - Ethereum address or ENS name
 * @returns Resolver address or null if not found
 */
export async function getResolverAddress(
  address: Address | string,
): Promise<Address | null> {
  try {
    const publicClient = getPublicClient();

    let resolverAddress: Address | null = null;

    // If it's an ENS name, try to get resolver directly
    try {
      const normalizedName = normalize(address as string);
      resolverAddress = await publicClient.getEnsResolver({
        name: normalizedName,
      });
      if (resolverAddress) {
        return resolverAddress;
      }
    } catch (error) {
      // Not an ENS name, try reverse lookup
    }

    // Try reverse lookup for address
    if (isValidAddress(address as string)) {
      const ensName = await getEnsName(getAddress(address as string));
      if (ensName) {
        resolverAddress = await publicClient.getEnsResolver({
          name: ensName,
        });
      }
    }

    return resolverAddress || null;
  } catch (error) {
    console.error(`Failed to get resolver address for ${address}`, error);
    return null;
  }
}

/**
 * Check if address or ENS name exists and is resolvable
 * @param input - Ethereum address or ENS name
 * @returns true if address exists and is resolvable
 */
export async function addressExists(input: string): Promise<boolean> {
  const resolved = await resolveWalletAddress(input);
  return resolved !== null;
}

/**
 * Format an address for display (shortened format or ENS name if available)
 * @param address - Ethereum address
 * @param showEns - Whether to attempt to show ENS name instead
 * @returns Formatted address string
 */
export async function formatAddressForDisplay(
  address: Address,
  showEns: boolean = true,
): Promise<string> {
  try {
    if (showEns) {
      const ensName = await getEnsName(address);
      if (ensName) {
        return ensName;
      }
    }

    // Return shortened address format
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  } catch (error) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }
}
