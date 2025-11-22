import { sepolia } from 'viem/chains';
import type { EIP1193Provider } from 'viem';

// Hardcoded target chain for this app
export const TARGET_CHAIN = sepolia;
export const TARGET_CHAIN_ID = sepolia.id;
export const TARGET_CHAIN_NAME = sepolia.name;

/**
 * Get the connected wallet's current chain
 * @param provider - The wallet provider (window.ethereum)
 * @returns Chain ID of the connected wallet
 */
export async function getConnectedChainId(provider: EIP1193Provider | any): Promise<number> {
	try {
		if (!provider) {
			throw new Error('No provider available');
		}

		// eth_chainId returns hex string, need to convert to number
		const chainIdHex = await provider.request({
			method: 'eth_chainId',
		});

		return parseInt(chainIdHex as string, 16);
	} catch (error) {
		console.error('Failed to get connected chain ID:', error);
		throw error;
	}
}

/**
 * Check if the wallet is connected to the correct chain
 * @param provider - The wallet provider (window.ethereum)
 * @returns true if on target chain (Sepolia), false otherwise
 */
export async function isConnectedToTargetChain(provider: EIP1193Provider | any): Promise<boolean> {
	try {
		const chainId = await getConnectedChainId(provider);
		return chainId === TARGET_CHAIN_ID;
	} catch (error) {
		console.error('Failed to check target chain:', error);
		return false;
	}
}

/**
 * Get chain name from chain ID
 * @param chainId - The chain ID to look up
 * @returns Chain name or 'Unknown'
 */
export function getChainName(chainId: number): string {
	const chains: Record<number, string> = {
		1: 'Ethereum Mainnet',
		11155111: 'Sepolia Testnet',
		137: 'Polygon',
		42161: 'Arbitrum',
		10: 'Optimism',
	};

	return chains[chainId] || `Chain ${chainId}`;
}

/**
 * Request wallet to switch to target chain
 * @param provider - The wallet provider (window.ethereum)
 * @returns true if switch successful
 */
export async function switchToTargetChain(provider: EIP1193Provider | any): Promise<boolean> {
	try {
		if (!provider) {
			throw new Error('No provider available');
		}

		// Try to switch to the chain
		await provider.request({
			method: 'wallet_switchEthereumChain',
			params: [
				{
					chainId: `0x${TARGET_CHAIN_ID.toString(16)}`,
				},
			],
		});

		return true;
	} catch (error: any) {
		// If chain doesn't exist, try to add it
		if (error.code === 4902 || error.data?.originalError?.code === 4902) {
			return await addTargetChainToWallet(provider);
		}
		console.error('Failed to switch chain:', error);
		throw error;
	}
}

/**
 * Add target chain to wallet
 * @param provider - The wallet provider (window.ethereum)
 * @returns true if addition successful
 */
export async function addTargetChainToWallet(provider: EIP1193Provider | any): Promise<boolean> {
	try {
		if (!provider) {
			throw new Error('No provider available');
		}

		// Get chain details
		const blockExplorer = TARGET_CHAIN.blockExplorers?.default;

		await provider.request({
			method: 'wallet_addEthereumChain',
			params: [
				{
					chainId: `0x${TARGET_CHAIN_ID.toString(16)}`,
					chainName: TARGET_CHAIN_NAME,
					nativeCurrency: {
						name: TARGET_CHAIN.nativeCurrency?.name || 'Ether',
						symbol: TARGET_CHAIN.nativeCurrency?.symbol || 'ETH',
						decimals: TARGET_CHAIN.nativeCurrency?.decimals || 18,
					},
					rpcUrls: TARGET_CHAIN.rpcUrls?.default?.http || [],
					blockExplorerUrls: blockExplorer ? [blockExplorer.url] : [],
				},
			],
		});

		return true;
	} catch (error) {
		console.error('Failed to add chain to wallet:', error);
		throw error;
	}
}

/**
 * Get chain information
 * @returns Chain information object
 */
export function getTargetChainInfo() {
	return {
		id: TARGET_CHAIN_ID,
		name: TARGET_CHAIN_NAME,
		nativeCurrency: TARGET_CHAIN.nativeCurrency,
	};
}
