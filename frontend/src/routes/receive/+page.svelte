<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Alert, AlertTitle, AlertDescription } from '$lib/components/ui/alert';
	import { router } from '$lib/store/router';
	import type { Address } from 'viem';
	import { ArrowLeft, Check } from '@lucide/svelte';
	import Copy from '@lucide/svelte/icons/copy';

	let currentStep = $state<'setup' | 'display'>('setup');
	let connectedAddress: Address | null = $state(null);
	let metakeyValue: string | null = $state(null);
	let totalBalance = $state('0');
	let isLoading = $state(false);
	let error: string | null = $state(null);
	let copiedIndex = $state(-1);

	function handleBack() {
		router.navigate('home');
	}

	async function initializeReceive() {
		isLoading = true;
		error = null;

		try {
			// This will be connected to actual wallet connection logic
			// For now, show the setup placeholder
			connectedAddress = null;
		} catch (err) {
			error = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
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

	// Initialize on component mount
	$effect(() => {
		initializeReceive();
	});
</script>

<main class="min-h-screen bg-background p-4">
	<div class="max-w-2xl mx-auto">
		<!-- Header -->
		<div class="flex items-center gap-3 mb-8">
			<Button
				onclick={handleBack}
				variant="outline"
				size="icon"
				class="rounded-full"
			>
				<ArrowLeft size={18} />
			</Button>
			<div>
				<h1 class="text-3xl font-bold">Receive Crypto</h1>
				<p class="text-muted-foreground text-sm">
					{currentStep === 'setup' ? 'Step 1: Connect Wallet' : 'Step 2: View Balance'}
				</p>
			</div>
		</div>

		<!-- Progress indicator -->
		<div class="flex gap-2 mb-8">
			<div class={`h-1 flex-1 rounded-full transition-colors ${currentStep === 'setup' ? 'bg-primary' : 'bg-muted'}`}></div>
			<div class={`h-1 flex-1 rounded-full transition-colors ${currentStep === 'display' ? 'bg-primary' : 'bg-muted'}`}></div>
		</div>

		<!-- Content -->
		{#if currentStep === 'setup'}
			<Card>
				<CardHeader>
					<CardTitle>Connect Your Wallet</CardTitle>
					<CardDescription>
						Connect your wallet to set up a MetaKey and view your balance.
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					<Alert>
						<AlertTitle>Setup Required</AlertTitle>
						<AlertDescription>
							Wallet connection component will be placed here. This will handle MetaKey generation if needed.
						</AlertDescription>
					</Alert>

					{#if error}
						<Alert variant="destructive">
							<AlertTitle>Error</AlertTitle>
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					{/if}

					<div class="flex gap-2">
						<Button variant="outline" class="flex-1" onclick={handleBack}>
							Back
						</Button>
						<Button class="flex-1" disabled={isLoading}>
							{isLoading ? 'Connecting...' : 'Connect Wallet'}
						</Button>
					</div>
				</CardContent>
			</Card>
		{:else}
			<!-- Display balance and receiving info -->
			<Card>
				<CardHeader>
					<CardTitle>Your Balance</CardTitle>
					<CardDescription>
						Total balance across all your addresses
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-6">
					<!-- Total Balance -->
					<div class="p-6 bg-gradient-to-br from-primary/10 to-accent/10 rounded-lg border border-primary/20">
						<p class="text-sm text-muted-foreground mb-2">Total Balance</p>
						<p class="text-4xl font-bold">{totalBalance} ETH</p>
					</div>

					<!-- MetaKey Display -->
					{#if metakeyValue}
						<div class="space-y-3">
							<p class="text-sm font-medium">Your MetaKey</p>
							<div class="p-3 bg-card border border-border rounded-md font-mono text-sm break-all flex items-center justify-between">
								<span>{metakeyValue}</span>
								<Button
									variant="ghost"
									size="sm"
									onclick={() => copyToClipboard(metakeyValue || '', 0)}
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

					<!-- Connected Address -->
					{#if connectedAddress}
						<div class="space-y-3">
							<p class="text-sm font-medium">Your Address</p>
							<div class="p-3 bg-card border border-border rounded-md font-mono text-sm break-all flex items-center justify-between">
								<span>{connectedAddress}</span>
								<Button
									variant="ghost"
									size="sm"
									onclick={() => copyToClipboard(connectedAddress || '', 1)}
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

					<Button class="w-full" onclick={handleBack}>
						Back to Home
					</Button>
				</CardContent>
			</Card>
		{/if}
	</div>
</main>
