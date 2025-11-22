import { type Address, parseEther, toHex, formatGwei, formatEther } from 'viem';
import { TARGET_CHAIN_ID } from './chain';

export interface TransactionResult {
	hash: string;
	receipt?: any;
	error?: string;
}

export interface GasEstimate {
	gasLimit: bigint;
	gasPrice: string; // in gwei
	maxFeePerGas?: string; // in gwei
	totalGasCost: string; // in ETH
}

/**
 * Send ETH transaction to an address
 * @param to - Recipient address
 * @param amount - Amount in ETH (as string, e.g., "1.5")
 * @param provider - Optional EIP-1193 provider, defaults to window.ethereum
 * @returns Transaction hash and optional receipt
 */
export async function sendTransaction(
	to: Address,
	amount: string,
	provider?: any
): Promise<TransactionResult> {
	try {
		const eth = provider || window.ethereum;

		if (!eth) {
			return {
				hash: '',
				error: 'No wallet provider found. Please install MetaMask or connect a wallet.',
			};
		}

	// Validate inputs
	if (!to || !amount) {
		return {
			hash: '',
			error: 'Invalid recipient address or amount',
		};
	}

	// Parse amount to wei
	let amountWei: bigint;
	try {
		// Sanitize amount: trim whitespace and ensure it's a valid number
		const sanitizedAmount = String(amount).trim();
		
		if (!sanitizedAmount || isNaN(parseFloat(sanitizedAmount))) {
			return {
				hash: '',
				error: 'Invalid amount format - must be a valid number',
			};
		}

		// Parse to wei
		amountWei = parseEther(sanitizedAmount);
	} catch (err) {
		console.error('Amount parsing error:', err, 'Amount was:', amount);
		return {
			hash: '',
			error: `Invalid amount format: ${err instanceof Error ? err.message : 'Unknown error'}`,
		};
	}

		// Get user's account
		const accounts = await eth.request({ method: 'eth_accounts' });

		if (!accounts || accounts.length === 0) {
			return {
				hash: '',
				error: 'No account connected. Please connect a wallet first.',
			};
		}

		const from = accounts[0] as Address;

		// Verify on correct chain
		const chainIdHex = await eth.request({ method: 'eth_chainId' });
		const chainId = parseInt(chainIdHex as string, 16);

		if (chainId !== TARGET_CHAIN_ID) {
			return {
				hash: '',
				error: `Please switch to the correct network (Chain ID: ${TARGET_CHAIN_ID})`,
			};
		}

		// Get current gas price
		const gasPriceHex = await eth.request({ method: 'eth_gasPrice' });
		const gasPrice = gasPriceHex as string;

		// Create transaction object
		const txData = {
			from,
			to,
			value: toHex(amountWei),
			gasPrice,
			gas: toHex(21000n), // Standard ETH transfer
		};

		// Send transaction
		const txHash = (await eth.request({
			method: 'eth_sendTransaction',
			params: [txData],
		})) as string;

		if (!txHash) {
			return {
				hash: '',
				error: 'Failed to send transaction',
			};
		}

		return {
			hash: txHash,
		};
	} catch (error: any) {
		console.error('Transaction error:', error);

		// Handle user rejection
		if (error.code === 4001) {
			return {
				hash: '',
				error: 'Transaction rejected by user',
			};
		}

		// Handle insufficient balance
		if (error.message?.includes('insufficient funds')) {
			return {
				hash: '',
				error: 'Insufficient balance to send transaction',
			};
		}

		return {
			hash: '',
			error: error.message || 'Failed to send transaction',
		};
	}
}

/**
 * Get transaction receipt from provider
 * @param hash - Transaction hash
 * @param provider - Optional EIP-1193 provider, defaults to window.ethereum
 * @returns Transaction receipt or null if not mined yet
 */
export async function getTransactionReceipt(hash: string, provider?: any): Promise<any | null> {
	try {
		const eth = provider || window.ethereum;

		if (!eth) {
			return null;
		}

		const receipt = await eth.request({
			method: 'eth_getTransactionReceipt',
			params: [hash],
		});

		return receipt || null;
	} catch (error) {
		console.error('Failed to get transaction receipt:', error);
		return null;
	}
}

/**
 * Wait for transaction receipt with polling
 * @param hash - Transaction hash
 * @param maxWaitTime - Maximum time to wait in milliseconds (default: 60000)
 * @param provider - Optional EIP-1193 provider
 * @returns Transaction receipt
 */
export async function waitForTransactionReceipt(
	hash: string,
	maxWaitTime: number = 60000,
	provider?: any
): Promise<any> {
	const startTime = Date.now();
	const pollInterval = 1000; // Poll every 1 second

	while (Date.now() - startTime < maxWaitTime) {
		const receipt = await getTransactionReceipt(hash, provider);

		if (receipt) {
			return receipt;
		}

		// Wait before polling again
		await new Promise((resolve) => setTimeout(resolve, pollInterval));
	}

	throw new Error('Transaction receipt not received within timeout period');
}

/**
 * Get block explorer URL for a transaction
 * @param hash - Transaction hash
 * @returns Block explorer URL for the transaction
 */
export function getExplorerUrl(hash: string): string {
	// Sepolia block explorer
	return `https://sepolia.etherscan.io/tx/${hash}`;
}

/**
 * Format transaction hash for display
 * @param hash - Transaction hash
 * @returns Shortened hash (0x...XXXX)
 */
export function formatTxHash(hash: string): string {
	return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

/**
 * Estimate gas cost for ETH transfer
 * @param amount - Amount in ETH (as string)
 * @param provider - Optional EIP-1193 provider, defaults to window.ethereum
 * @returns Gas estimation details
 */
export async function estimateGasCost(
	amount: string,
	provider?: any
): Promise<GasEstimate | null> {
	try {
		const eth = provider || window.ethereum;

		if (!eth) {
			return null;
		}

		// Get current gas price
		const gasPriceHex = await eth.request({ method: 'eth_gasPrice' });
		const gasPriceBigInt = BigInt(gasPriceHex as string);
		const gasPriceGwei = parseFloat(formatGwei(gasPriceBigInt));

		// Standard gas limit for ETH transfer
		const gasLimit = 21000n;

		// Calculate total cost
		const totalGasWei = gasPriceBigInt * gasLimit;
		const totalGasEth = formatEther(totalGasWei);

		return {
			gasLimit,
			gasPrice: gasPriceGwei.toFixed(2),
			totalGasCost: totalGasEth,
		};
	} catch (error) {
		console.error('Gas estimation error:', error);
		return null;
	}
}
