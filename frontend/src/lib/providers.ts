import { writable } from "svelte/store";

declare global {
  interface WindowEventMap {
    "eip6963:announceProvider": CustomEvent;
  }
}

export interface DetectedProvider {
  info: EIP6963ProviderInfo;
  provider: EIP1193Provider;
}

// Store for detected providers
export const detectedProviders = writable<DetectedProvider[]>([]);

// Store for connected account
export const connectedAccount = writable<string | null>(null);

// Store for provider name
export const connectedProvider = writable<string | null>(null);

// Store for current provider
export const currentProvider = writable<EIP1193Provider | null>(null);

// Store for signature results
export const signatureResult = writable<string | null>(null);

/**
 * Connect to the selected provider using eth_requestAccounts.
 */
export const connectWithProvider = async (wallet: DetectedProvider) => {
  try {
    const accounts = (await wallet.provider.request({
      method: "eth_requestAccounts",
    })) as string[];

    if (accounts && accounts.length > 0) {
      connectedAccount.set(accounts[0]);
      connectedProvider.set(wallet.info.name);
      console.log(`Connected to ${wallet.info.name}:`, accounts[0]);
    }
  } catch (error) {
    console.error("Failed to connect to provider:", error);
    throw error;
  }
};

/**
 * Disconnect from the current provider
 */
export const disconnectProvider = () => {
  connectedAccount.set(null);
  connectedProvider.set(null);
};

/**
 * Request and display detected providers
 */
export function initializeProviders() {
  // Listen for provider announcements
  window.addEventListener(
    "eip6963:announceProvider",
    (event: EIP6963AnnounceProviderEvent) => {
      const provider: DetectedProvider = {
        info: event.detail.info,
        provider: event.detail.provider,
      };

      detectedProviders.update((providers) => {
        // Avoid duplicates
        if (!providers.some((p) => p.info.uuid === provider.info.uuid)) {
          return [...providers, provider];
        }
        return providers;
      });
    },
  );

  // Request providers to announce themselves
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

/**
 * Convert string to hex format
 */
function stringToHex(str: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  return (
    "0x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * Sign a message using personal_sign (EIP-191)
 * @param message - The message to sign
 * @param account - The account to sign with
 * @param provider - The provider to use for signing
 * @returns The signed message
 */
export const signMessage = async (
  message: string,
  account: string,
  provider: EIP1193Provider,
): Promise<string> => {
  try {
    // Convert message to hex-encoded UTF-8
    const msgHex = stringToHex(message);

    const signature = (await provider.request({
      method: "personal_sign",
      params: [msgHex, account],
    })) as string;

    signatureResult.set(signature);
    console.log("Message signed successfully:", signature);
    return signature;
  } catch (error) {
    console.error("Failed to sign message:", error);
    throw error;
  }
};

export interface EIP712Domain {
  name?: string;
  version?: string;
  chainId?: number;
  verifyingContract?: string;
  salt?: string;
}

export interface EIP712Message {
  domain: EIP712Domain;
  message: Record<string, unknown>;
  primaryType: string;
  types: Record<string, Array<{ name: string; type: string }>>;
}

/**
 * Sign typed data using eth_signTypedData_v4 (EIP-712)
 * @param typedData - The typed data to sign
 * @param account - The account to sign with
 * @param provider - The provider to use for signing
 * @returns The signed typed data
 */
export const signTypedData = async (
  typedData: EIP712Message,
  account: string,
  provider: EIP1193Provider,
): Promise<string> => {
  try {
    const signature = (await provider.request({
      method: "eth_signTypedData_v4",
      params: [account, JSON.stringify(typedData)],
    })) as string;

    signatureResult.set(signature);
    console.log("Typed data signed successfully:", signature);
    return signature;
  } catch (error) {
    console.error("Failed to sign typed data:", error);
    throw error;
  }
};

/**
 * Create a sample EIP-712 typed data object
 */
export const createSampleTypedData = (account: string): EIP712Message => {
  return {
    domain: {
      name: "Swarzschild",
      version: "1",
      chainId: 1,
      verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
    },
    message: {
      from: account,
      to: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
      contents: "Hello from Swarzschild!",
      timestamp: Math.floor(Date.now() / 1000),
    },
    primaryType: "Message",
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      Message: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "contents", type: "string" },
        { name: "timestamp", type: "uint256" },
      ],
    },
  };
};
