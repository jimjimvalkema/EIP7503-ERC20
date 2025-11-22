<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Alert, AlertTitle, AlertDescription } from '$lib/components/ui/alert';
	import { getBalanceInfo } from '$lib/utils/balance';
	import { getMetakey } from '$lib/utils/metakey';
	import type { Address } from 'viem';
	import { Copy, Check, AlertCircle } from '@lucide/svelte';

	interface Props {
		address: Address;
		onBack?: () => void;
	}

	let { address, onBack }: Props = $props();

	let balance = $state<string | null>(null);
	let metakey = $state<string | null>(null);
	let copiedIndex = $state(-1);
	let isLoading = $state(true);
	let error: string | null = $state(null);

	async function loadReceiveInfo() {
		try {
			isLoading = true;
			error = null;

			// Load balance
			const balanceInfo = await getBalanceInfo(address);
			if (balanceInfo) {
				balance = balanceInfo.formattedBalance;
			}

			// Load metakey
			const metakeyData = await getMetakey(address);
			metakey = metakeyData;

			if (!metakey) {
				error = 'No metakey found for this address. Please set one first.';
			}
		} catch (err) {
			error = `Error loading receive info: ${err instanceof Error ? err.message : 'Unknown error'}`;
		} finally {
			isLoading = false;
		}
	}

	function copyToClipboard(text: string, index: number) {
		navigator.clipboard.writeText(text);
		copiedIndex = index;
		setTimeout(() => {
			copiedIndex = -1;
		}, 2000);
	}

	$effect(() => {
		loadReceiveInfo();
	});
</script>

<div class="space-y-6">
	{#if isLoading}
		<Alert>
			<AlertCircle size={16} />
			<AlertTitle>Loading</AlertTitle>
			<AlertDescription>
				Fetching your balance and MetaKey information...
			</AlertDescription>
		</Alert>
	{:else if error}
		<Alert variant="destructive">
			<AlertCircle size={16} />
			<AlertTitle>Error</AlertTitle>
			<AlertDescription>{error}</AlertDescription>
		</Alert>
	{:else}
		<!-- Balance Display -->
		{#if balance}
			<div class="p-6 bg-gradient-to-br from-primary/10 to-accent/10 rounded-lg border border-primary/20">
				<p class="text-sm text-muted-foreground mb-2">Total Balance</p>
				<p class="text-4xl font-bold">{balance}</p>
			</div>
		{/if}

		<!-- MetaKey Display -->
		{#if metakey}
			<div class="space-y-3">
				<p class="text-sm font-medium">Your MetaKey</p>
				<div class="p-3 bg-card border border-border rounded-md font-mono text-sm break-all flex items-center justify-between">
					<span>{metakey}</span>
					<Button
						variant="ghost"
						size="sm"
						onclick={() => copyToClipboard(metakey || '', 0)}
						class="ml-2"
					>
						{#if copiedIndex === 0}
							<Check size={16} />
						{:else}
							<Copy size={16} />
						{/if}
					</Button>
				</div>
				<p class="text-xs text-muted-foreground">
					Share this MetaKey with others to receive payments securely.
				</p>
			</div>
		{/if}

		<!-- Address Display -->
		<div class="space-y-3">
			<p class="text-sm font-medium">Your Address</p>
			<div class="p-3 bg-card border border-border rounded-md font-mono text-sm break-all flex items-center justify-between">
				<span>{address}</span>
				<Button
					variant="ghost"
					size="sm"
					onclick={() => copyToClipboard(address, 1)}
					class="ml-2"
				>
					{#if copiedIndex === 1}
						<Check size={16} />
					{:else}
						<Copy size={16} />
					{/if}
				</Button>
			</div>
		</div>
	{/if}

	<!-- Back Button -->
	<Button
		variant="outline"
		class="w-full"
		onclick={onBack}
		disabled={isLoading}
	>
		Back to Home
	</Button>
</div>
