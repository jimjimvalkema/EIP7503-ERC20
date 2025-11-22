import { createPublicClient, http, type Address, formatEther, parseEther } from 'viem';
import { sepolia } from 'viem/chains';
import { resolveWalletAddress } from './wallet';
import { TARGET_CHAIN } from './chain';

/**
 * Create a public client for balance operations
 */
function getPublicClient() {
	return createPublicClient({
		chain: TARGET_CHAIN,
		transport: http(),
	});
}

export interface BalanceInfo {
	address: Address;
	balance: bigint; // Balance in wei
	formattedBalance: string; // Balance in ETH
	chainId: number;
	chainName: string;
}

/**
 * Get ETH balance for an address (direct)
 * @param address - Ethereum address (0x...)
 * @returns Balance in wei and formatted ETH string, or null if address doesn't exist
 */
export async function getBalanceForAddress(
	address: Address
): Promise<{ balance: bigint; formatted: string } | null> {
	try {
		const publicClient = getPublicClient();
		const balance = await publicClient.getBalance({
			address,
		});

		return {
			balance,
			formatted: formatEther(balance),
		};
	} catch (error) {
		console.error(`Failed to get balance for ${address}:`, error);
		return null;
	}
}

/**
 * Get ETH balance for an address or ENS name
 * @param addressOrEns - Ethereum address or ENS name
 * @returns Balance in wei and formatted ETH string, or null if address doesn't exist
 */
export async function getBalance(
	addressOrEns: string
): Promise<{ balance: bigint; formatted: string } | null> {
	try {
		const address = await resolveWalletAddress(addressOrEns);
		if (!address) {
			return null;
		}

		return getBalanceForAddress(address);
	} catch (error) {
		console.error(`Failed to get balance for ${addressOrEns}:`, error);
		return null;
	}
}

/**
 * Get formatted balance string for an address
 * @param addressOrEns - Ethereum address or ENS name
 * @param decimals - Number of decimal places to show (default: 4)
 * @returns Formatted balance string (e.g., "1.5 ETH")
 */
export async function getFormattedBalance(
	addressOrEns: string,
	decimals: number = 4
): Promise<string | null> {
	try {
		const balanceData = await getBalance(addressOrEns);
		if (!balanceData) {
			return null;
		}

		const formatted = parseFloat(balanceData.formatted).toFixed(decimals);
		return `${formatted} ETH`;
	} catch (error) {
		console.error(`Failed to get formatted balance for ${addressOrEns}:`, error);
		return null;
	}
}

/**
 * Check if an address has sufficient balance (direct)
 * @param address - Ethereum address
 * @param requiredAmount - Amount in ETH (will be converted to wei)
 * @returns true if balance >= required amount
 */
export async function hasSufficientBalanceForAddress(
	address: Address,
	requiredAmount: string | number
): Promise<boolean> {
	try {
		const balanceData = await getBalanceForAddress(address);
		if (!balanceData) {
			return false;
		}

		const requiredWei = parseEther(requiredAmount.toString());
		return balanceData.balance >= requiredWei;
	} catch (error) {
		console.error(
			`Failed to check sufficient balance for ${address}:`,
			error
		);
		return false;
	}
}

/**
 * Check if an address has sufficient balance
 * @param addressOrEns - Ethereum address or ENS name
 * @param requiredAmount - Amount in ETH (will be converted to wei)
 * @returns true if balance >= required amount
 */
export async function hasSufficientBalance(
	addressOrEns: string,
	requiredAmount: string | number
): Promise<boolean> {
	try {
		const balanceData = await getBalance(addressOrEns);
		if (!balanceData) {
			return false;
		}

		const requiredWei = parseEther(requiredAmount.toString());
		return balanceData.balance >= requiredWei;
	} catch (error) {
		console.error(
			`Failed to check sufficient balance for ${addressOrEns}:`,
			error
		);
		return false;
	}
}

/**
 * Get balance details with additional info
 * @param addressOrEns - Ethereum address or ENS name
 * @returns Balance info object or null
 */
export async function getBalanceInfo(addressOrEns: string): Promise<BalanceInfo | null> {
	try {
		const address = await resolveWalletAddress(addressOrEns);
		if (!address) {
			return null;
		}

		const balanceData = await getBalance(addressOrEns);
		if (!balanceData) {
			return null;
		}

		return {
			address,
			balance: balanceData.balance,
			formattedBalance: balanceData.formatted,
			chainId: TARGET_CHAIN.id,
			chainName: TARGET_CHAIN.name,
		};
	} catch (error) {
		console.error(`Failed to get balance info for ${addressOrEns}:`, error);
		return null;
	}
}

/**
 * Calculate total balance for multiple addresses
 * @param addressesOrEns - Array of addresses or ENS names
 * @returns Total balance in wei and formatted ETH
 */
export async function getTotalBalance(
	addressesOrEns: string[]
): Promise<{ total: bigint; formatted: string } | null> {
	try {
		let total = BigInt(0);

		for (const addressOrEns of addressesOrEns) {
			const balance = await getBalance(addressOrEns);
			if (balance) {
				total += balance.balance;
			}
		}

		return {
			total,
			formatted: formatEther(total),
		};
	} catch (error) {
		console.error(`Failed to get total balance:`, error);
		return null;
	}
}

/**
 * Convert wei to ETH
 * @param wei - Amount in wei (as bigint or string)
 * @returns Amount in ETH as string
 */
export function weiToEth(wei: bigint | string): string {
	return formatEther(typeof wei === 'string' ? BigInt(wei) : wei);
}

/**
 * Convert ETH to wei
 * @param eth - Amount in ETH (as string or number)
 * @returns Amount in wei as bigint
 */
export function ethToWei(eth: string | number): bigint {
	return parseEther(eth.toString());
}
