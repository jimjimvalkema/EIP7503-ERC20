import { type Address, isAddress } from "viem";
import { getEnsText, setEnsText } from "../ens";
import { resolveWalletAddress, getEnsName } from "./wallet";

const METAKEY_RECORD_KEY = "metaKey";

/**
 * Generate a random metakey
 * @returns A 32-character hex string
 */
export function generateMetakey(): string {
  const array = new Uint8Array(16); // 16 bytes = 32 hex characters
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * Validate metakey format
 * @param metakey - String to validate
 * @returns true if metakey is valid format
 */
export function isValidMetakey(metakey: string): boolean {
  // Should be 32 characters of hex
  return /^[a-f0-9]{32}$/.test(metakey.toLowerCase());
}

/**
 * Check if an address/ENS has a metakey record
 * @param addressOrEns - Ethereum address or ENS name
 * @returns The metakey if it exists, or null
 */
export async function getMetakey(addressOrEns: string): Promise<string | null> {
	try {
		// Resolve to ensure we're working with a valid address/ENS
		const resolved = await resolveWalletAddress(addressOrEns);
		if (!resolved) {
			console.warn(`Could not resolve address: ${addressOrEns}`);
			return null;
		}

		// If input was a raw address, do reverse lookup to get ENS name
		let queryTarget = addressOrEns;
		if (isAddress(addressOrEns)) {
			const ensName = await getEnsName(resolved);
			if (!ensName) {
				console.warn(`No ENS name found for address: ${addressOrEns}`);
				return null;
			}
			queryTarget = ensName;
		}

		// Try to get metakey from ENS record using the ENS name
		const metakey = await getEnsText(queryTarget, METAKEY_RECORD_KEY);

		if (metakey && isValidMetakey(metakey)) {
			return metakey;
		}

		return null;
	} catch (error) {
		console.error(`Failed to get metakey for ${addressOrEns}:`, error);
		return null;
	}
}

/**
 * Check if an address/ENS has a valid metakey
 * @param addressOrEns - Ethereum address or ENS name
 * @returns true if metakey exists and is valid
 */
export async function hasMetakey(addressOrEns: string): Promise<boolean> {
  const metakey = await getMetakey(addressOrEns);
  return metakey !== null;
}

/**
 * Set a metakey for an address/ENS
 * Requires the user to be connected with a wallet and own the ENS name
 * @param addressOrEns - Ethereum address or ENS name to set metakey for
 * @param metakey - Optional metakey to set (if not provided, a new one will be generated)
 * @param resolverAddress - Optional resolver address
 * @returns Object with transaction hash and the metakey that was set
 */
export async function setMetakey(
  addressOrEns: string,
  metakey?: string,
  resolverAddress?: Address,
): Promise<{ hash: string; metakey: string }> {
  try {
    // Generate metakey if not provided
    const metakeyToSet = metakey || generateMetakey();

    if (!isValidMetakey(metakeyToSet)) {
      throw new Error(`Invalid metakey format: ${metakeyToSet}`);
    }

    // Set the metakey in ENS records
    const hash = await setEnsText(
      addressOrEns,
      METAKEY_RECORD_KEY,
      metakeyToSet,
      resolverAddress,
    );

    return {
      hash,
      metakey: metakeyToSet,
    };
  } catch (error) {
    console.error(`Failed to set metakey for ${addressOrEns}:`, error);
    throw error;
  }
}

/**
 * Get or create a metakey for an address/ENS
 * If metakey doesn't exist, it will be created
 * @param addressOrEns - Ethereum address or ENS name
 * @param resolverAddress - Optional resolver address
 * @returns Object with transaction hash (null if already existed) and the metakey
 */
export async function getOrCreateMetakey(
  addressOrEns: string,
  resolverAddress?: Address,
): Promise<{ hash: string | null; metakey: string; isNew: boolean }> {
  try {
    // Check if metakey already exists
    const existingMetakey = await getMetakey(addressOrEns);

    if (existingMetakey) {
      return {
        hash: null,
        metakey: existingMetakey,
        isNew: false,
      };
    }

    // Generate and set new metakey
    const { hash, metakey } = await setMetakey(
      addressOrEns,
      undefined,
      resolverAddress,
    );

    return {
      hash,
      metakey,
      isNew: true,
    };
  } catch (error) {
    console.error(
      `Failed to get or create metakey for ${addressOrEns}:`,
      error,
    );
    throw error;
  }
}

/**
 * Clear/remove a metakey from an address/ENS
 * @param addressOrEns - Ethereum address or ENS name
 * @param resolverAddress - Optional resolver address
 * @returns Transaction hash
 */
export async function clearMetakey(
  addressOrEns: string,
  resolverAddress?: Address,
): Promise<string> {
  try {
    // Set empty string to effectively remove the metakey
    const hash = await setEnsText(
      addressOrEns,
      METAKEY_RECORD_KEY,
      "",
      resolverAddress,
    );
    return hash;
  } catch (error) {
    console.error(`Failed to clear metakey for ${addressOrEns}:`, error);
    throw error;
  }
}
