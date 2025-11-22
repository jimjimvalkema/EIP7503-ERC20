<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Alert, AlertTitle, AlertDescription } from '$lib/components/ui/alert';
	import {
		sendTransaction,
		waitForTransactionReceipt,
		getExplorerUrl,
		formatTxHash,
	} from '$lib/utils/transaction';
	import { transactions } from '$lib/store/transactions';
	import { ensCache } from '$lib/store/ensCache';
	import type { Address } from 'viem';
	import { Check, AlertCircle, Loader2, ExternalLink } from '@lucide/svelte';

	interface Props {
		recipientAddress: Address | null;
		recipientName?: string | null;
		amount: string | null;
		onSuccess?: (hash: string) => void;
		onError?: (error: string) => void;
		onBack?: () => void;
	}

	let { recipientAddress, recipientName = '', amount = '', onSuccess, onError, onBack }: Props = $props();

	let isSending = $state(false);
	let transactionHash: string | null = $state(null);
	let transactionError: string | null = $state(null);
	let transactionReceipt: any = $state(null);
	let isWaitingForReceipt = $state(false);

	async function handleSendTransaction() {
		try {
			if (!recipientAddress || !amount) {
				transactionError = 'Invalid recipient or amount';
				return;
			}

			isSending = true;
			transactionError = null;
			transactionHash = null;
			transactionReceipt = null;

			// Log for debugging
			console.log('Sending transaction:', {
				recipient: recipientAddress,
				amount: amount,
				amountType: typeof amount,
			});

			// Send transaction
			const result = await sendTransaction(recipientAddress, amount);

			if (result.error) {
				transactionError = result.error;
				onError?.(result.error);
				return;
			}

			if (!result.hash) {
				transactionError = 'Failed to get transaction hash';
				onError?.(transactionError);
				return;
			}

			transactionHash = result.hash;
			onSuccess?.(result.hash);

			// Record transaction in history
			const accounts = await window.ethereum?.request({ method: 'eth_accounts' });
			const fromAddress = accounts?.[0] || 'Unknown';
			const toEnsName = ensCache.get(recipientAddress) || recipientName || null;
			
			transactions.add({
				hash: result.hash,
				from: fromAddress,
				to: recipientAddress,
				toEnsName: toEnsName,
				amount: amount,
				timestamp: Date.now(),
				status: 'pending',
				explorerUrl: getExplorerUrl(result.hash),
			});

			// Try to wait for receipt
			isWaitingForReceipt = true;
			try {
				transactionReceipt = await waitForTransactionReceipt(result.hash, 60000);
				// Update status to confirmed
				transactions.updateStatus(result.hash, 'confirmed');
			} catch (err) {
				console.warn('Receipt not received within timeout, but tx was sent:', err);
			} finally {
				isWaitingForReceipt = false;
			}
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
			transactionError = errorMessage;
			onError?.(errorMessage);
		} finally {
			isSending = false;
		}
	}

	function handleRetry() {
		transactionHash = null;
		transactionError = null;
		transactionReceipt = null;
	}

	function openExplorer() {
		if (transactionHash) {
			window.open(getExplorerUrl(transactionHash), '_blank');
		}
	}
</script>

<div class="space-y-4">
	<!-- Transaction Details Summary -->
	{#if !transactionHash && !transactionError}
		<div class="space-y-3">
			<div class="p-4 bg-card border border-border rounded-md">
				<p class="text-xs text-muted-foreground mb-1">To</p>
				<p class="font-mono text-sm break-all">{recipientName || recipientAddress}</p>
			</div>

			<div class="p-4 bg-card border border-border rounded-md">
				<p class="text-xs text-muted-foreground mb-1">Amount</p>
				<p class="text-2xl font-bold">{amount} ETH</p>
			</div>

			<Alert>
				<AlertCircle size={16} />
				<AlertTitle>Ready to Send</AlertTitle>
				<AlertDescription>
					Click the Send button below to submit this transaction. You'll be asked to confirm in your
					wallet.
				</AlertDescription>
			</Alert>
		</div>
	{/if}

	<!-- Sending State -->
	{#if isSending}
		<Alert>
			<Loader2 size={16} class="animate-spin" />
			<AlertTitle>Sending Transaction</AlertTitle>
			<AlertDescription>
				{isWaitingForReceipt
					? 'Transaction sent! Waiting for confirmation...'
					: 'Requesting confirmation from your wallet...'}
			</AlertDescription>
		</Alert>
	{/if}

	<!-- Success State -->
	{#if transactionHash && !transactionError}
		<Alert class="border-green-500/50 bg-green-500/10">
			<Check size={16} class="text-green-600" />
			<AlertTitle class="text-green-600">Transaction Sent!</AlertTitle>
			<AlertDescription class="text-green-700">
				<div class="space-y-2 mt-2">
					<div>
						<p class="text-xs font-medium mb-1">Transaction Hash:</p>
						<p class="font-mono text-sm break-all">{transactionHash}</p>
					</div>

					{#if transactionReceipt}
						<div class="p-2 bg-green-600/10 rounded text-sm">
							<p class="font-medium">✓ Transaction Confirmed</p>
							<p class="text-xs text-green-600 mt-1">
								Block: {transactionReceipt.blockNumber}
							</p>
						</div>
					{:else}
						<p class="text-xs text-green-600">
							Waiting for confirmation on the network...
						</p>
					{/if}
				</div>
			</AlertDescription>
		</Alert>
	{/if}

	<!-- Error State -->
	{#if transactionError}
		<Alert variant="destructive">
			<AlertCircle size={16} />
			<AlertTitle>Transaction Failed</AlertTitle>
			<AlertDescription>
				<div class="space-y-2 mt-2">
					<p>{transactionError}</p>
					{#if transactionHash}
						<p class="text-xs">Hash: {formatTxHash(transactionHash)}</p>
					{/if}
				</div>
			</AlertDescription>
		</Alert>
	{/if}

	<!-- Action Buttons -->
	<div class="flex gap-2 pt-4">
		{#if transactionHash && !transactionError}
			<Button
				variant="outline"
				class="flex-1 gap-2"
				onclick={openExplorer}
			>
				<ExternalLink size={16} />
				View on Explorer
			</Button>
			<Button
				class="flex-1"
				onclick={() => {
					onBack?.();
				}}
			>
				Done
			</Button>
		{:else if transactionError}
			<Button
				variant="outline"
				class="flex-1"
				onclick={onBack}
			>
				Back
			</Button>
			<Button
				class="flex-1"
				onclick={handleRetry}
				disabled={isSending}
			>
				Try Again
			</Button>
		{:else}
			<Button
				variant="outline"
				class="flex-1"
				onclick={onBack}
				disabled={isSending}
			>
				Cancel
			</Button>
			<Button
				class="flex-1"
				onclick={handleSendTransaction}
				disabled={isSending}
			>
				{isSending ? 'Sending...' : 'Send'}
			</Button>
		{/if}
	</div>
</div>
