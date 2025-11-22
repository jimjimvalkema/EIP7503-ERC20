<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Alert, AlertTitle, AlertDescription } from '$lib/components/ui/alert';
	import { getBalanceForAddress, hasSufficientBalanceForAddress } from '$lib/utils/balance';
	import { isConnectedToTargetChain, switchToTargetChain, getTargetChainInfo } from '$lib/utils/chain';
	import type { Address } from 'viem';
	import { AlertCircle, Info, AlertTriangle } from '@lucide/svelte';

	interface Props {
		recipientAddress: Address;
		recipientName?: string | null;
		onSubmit?: (amount: string) => void;
		onBack?: () => void;
		loading?: boolean;
	}

	let { recipientAddress, recipientName = '', onSubmit, onBack, loading = false }: Props = $props();

	let amount = $state('');
	let maxBalance = $state<string | null>(null);
	let error: string | null = $state(null);
	let isValidating = $state(false);
	let isOnCorrectChain = $state<boolean | null>(null);
	let chainInfo = $state(getTargetChainInfo());

	async function loadMaxBalance() {
		try {
			isValidating = true;
			error = null;

			// Check if wallet is connected
			if (!window.ethereum) {
				error = 'No wallet connected. Please connect a wallet first.';
				return;
			}

			// Check if on correct chain
			const onCorrectChain = await isConnectedToTargetChain(window.ethereum);
			isOnCorrectChain = onCorrectChain;

			if (!onCorrectChain) {
				error = `Please switch to ${chainInfo.name} to proceed.`;
				return;
			}

			// Get connected account
			const accounts = await window.ethereum.request({ method: 'eth_accounts' });

			if (!accounts || accounts.length === 0) {
				error = 'No account connected. Please connect a wallet first.';
				return;
			}

			const connectedAccount = accounts[0] as Address;

			// Get balance
			const balanceData = await getBalanceForAddress(connectedAccount);

			if (!balanceData) {
				error = 'Could not fetch balance. Please try again.';
				return;
			}

			maxBalance = balanceData.formatted;
		} catch (err) {
			error = `Error loading balance: ${err instanceof Error ? err.message : 'Unknown error'}`;
		} finally {
			isValidating = false;
		}
	}

	async function handleSwitchChain() {
		try {
			isValidating = true;
			error = null;

			if (!window.ethereum) {
				error = 'No wallet connected.';
				return;
			}

			await switchToTargetChain(window.ethereum);

			// Re-check after switching
			const onCorrectChain = await isConnectedToTargetChain(window.ethereum);
			isOnCorrectChain = onCorrectChain;

			if (onCorrectChain) {
				// Reload balance after switching
				await loadMaxBalance();
			}
		} catch (err) {
			error = `Failed to switch chain: ${err instanceof Error ? err.message : 'Unknown error'}`;
		} finally {
			isValidating = false;
		}
	}

	async function validateAmount(): Promise<boolean> {
		if (!amount) {
			error = 'Please enter an amount';
			return false;
		}

		try {
			const numAmount = parseFloat(amount);
			if (isNaN(numAmount) || numAmount <= 0) {
				error = 'Please enter a valid amount greater than 0';
				return false;
			}

			if (!window.ethereum) {
				error = 'No wallet connected';
				return false;
			}

			// Check chain again before validation
			const onCorrectChain = await isConnectedToTargetChain(window.ethereum);
			if (!onCorrectChain) {
				error = `Please switch to ${chainInfo.name}`;
				return false;
			}

			// Get connected account
			const accounts = await window.ethereum.request({ method: 'eth_accounts' });
			if (!accounts || accounts.length === 0) {
				error = 'No account connected';
				return false;
			}

			const connectedAccount = accounts[0] as Address;

			// Check balance
			isValidating = true;
			const hasBalance = await hasSufficientBalanceForAddress(connectedAccount, amount);

			if (!hasBalance) {
				error = `Insufficient balance. Maximum available: ${maxBalance}`;
				return false;
			}

			error = null;
			return true;
		} catch (err) {
			error = `Validation error: ${err instanceof Error ? err.message : 'Unknown error'}`;
			return false;
		} finally {
			isValidating = false;
		}
	}

	async function handleSubmit() {
		if (!(await validateAmount())) {
			return;
		}

		// Clean and format the amount before submitting
		const cleanAmount = String(amount).trim();
		const numAmount = parseFloat(cleanAmount);
		
		if (isNaN(numAmount)) {
			error = 'Invalid amount';
			return;
		}

		// Submit as a clean string
		onSubmit?.(numAmount.toString());
	}

	function setMaxAmount() {
		if (maxBalance) {
			// Remove any extra whitespace and parse carefully
			const cleanBalance = String(maxBalance).trim();
			const numBalance = parseFloat(cleanBalance);
			if (!isNaN(numBalance)) {
				amount = numBalance.toFixed(4);
			}
		}
	}

	// Load balance on mount
	$effect(() => {
		loadMaxBalance();
	});
</script>

<div class="space-y-4">
	<!-- Recipient info -->
	<div class="p-4 bg-card border border-border rounded-md">
		<p class="text-xs text-muted-foreground mb-1">Sending to</p>
		<p class="font-mono text-sm break-all">
			{recipientName || recipientAddress}
		</p>
	</div>

	<!-- Chain Status Alert -->
	{#if isOnCorrectChain === false}
		<Alert variant="destructive">
			<AlertTriangle size={16} />
			<AlertTitle>Wrong Network</AlertTitle>
			<AlertDescription class="mt-2 space-y-3">
				<p>Your wallet is not on {chainInfo.name}. Please switch to continue.</p>
				<Button
					variant="outline"
					size="sm"
					onclick={handleSwitchChain}
					disabled={isValidating}
					class="w-full"
				>
					{isValidating ? 'Switching...' : `Switch to ${chainInfo.name}`}
				</Button>
			</AlertDescription>
		</Alert>
	{:else if isOnCorrectChain === true}
		<Alert>
			<Info size={16} />
			<AlertTitle>Correct Network</AlertTitle>
			<AlertDescription>
				You are on {chainInfo.name}. Ready to send.
			</AlertDescription>
		</Alert>
	{/if}

	<!-- Balance Display -->
	{#if maxBalance && !isValidating && isOnCorrectChain}
		<Alert>
			<Info size={16} />
			<AlertTitle>Your Balance</AlertTitle>
			<AlertDescription>
				You have <span class="font-semibold">{maxBalance} ETH</span> available to send.
			</AlertDescription>
		</Alert>
	{:else if isValidating}
		<Alert>
			<Info size={16} />
			<AlertTitle>Loading</AlertTitle>
			<AlertDescription>
				Checking your balance and wallet status...
			</AlertDescription>
		</Alert>
	{/if}

	<!-- Amount Input -->
	{#if isOnCorrectChain !== false}
		<div class="space-y-2">
			<label for="amount" class="text-sm font-medium text-foreground">
				Amount (ETH)
			</label>
			<div class="flex items-end gap-2">
				<div class="flex-1">
					<Input
						id="amount"
						bind:value={amount}
						type="number"
						step="0.0001"
						placeholder="0.5"
						disabled={loading || isValidating || !isOnCorrectChain}
						min="0"
					/>
				</div>
				{#if maxBalance}
					<Button
						variant="outline"
						size="sm"
						onclick={setMaxAmount}
						disabled={loading || isValidating}
					>
						Max
					</Button>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Error message -->
	{#if error}
		<div class="p-3 bg-destructive/10 border border-destructive rounded-md flex gap-2">
			<AlertCircle size={16} class="text-destructive flex-shrink-0 mt-0.5" />
			<p class="text-sm text-destructive">{error}</p>
		</div>
	{/if}

	<!-- Buttons -->
	<div class="flex gap-2 pt-4">
		<Button
			variant="outline"
			class="flex-1"
			onclick={onBack}
			disabled={loading || isValidating}
		>
			Back
		</Button>
		<Button
			class="flex-1"
			onclick={handleSubmit}
			disabled={loading || isValidating || !amount || isOnCorrectChain === false}
		>
			{isValidating ? 'Validating...' : loading ? 'Processing...' : 'Next'}
		</Button>
	</div>
</div>
