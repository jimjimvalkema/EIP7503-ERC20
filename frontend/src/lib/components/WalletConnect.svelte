<script lang="ts" module>
	import type { DetectedProvider } from '$lib/providers'

	export type WalletConnectProps = {
		onConnect?: (provider: DetectedProvider) => void
		onDisconnect?: () => void
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte'
	import { detectedProviders, connectedAccount, connectedProvider, currentProvider, connectWithProvider, disconnectProvider, initializeProviders } from '$lib/providers'
	import Button from '$lib/components/ui/button/button.svelte'
	import * as Card from '$lib/components/ui/card'
	import * as Alert from '$lib/components/ui/alert'

	let { onConnect, onDisconnect }: WalletConnectProps = $props()

	onMount(() => {
		initializeProviders()
	})

	const handleConnect = async (provider: typeof $detectedProviders[0]) => {
		try {
			await connectWithProvider(provider)
			currentProvider.set(provider.provider)
			onConnect?.(provider)
		} catch (error) {
			console.error('Connection failed:', error)
		}
	}

	const handleDisconnect = () => {
		disconnectProvider()
		currentProvider.set(null)
		onDisconnect?.()
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>Connect Wallet</Card.Title>
		<Card.Description>Connect your Web3 wallet to get started</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if $connectedAccount}
			<div class="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950">
				<div class="flex flex-col gap-1">
					<p class="text-sm font-semibold text-green-900 dark:text-green-100">
						Connected to {$connectedProvider}
					</p>
					<p class="font-mono text-xs text-green-700 dark:text-green-300">
						{$connectedAccount.slice(0, 6)}...{$connectedAccount.slice(-4)}
					</p>
				</div>
				<Button variant="destructive" size="sm" onclick={handleDisconnect}>
					Disconnect
				</Button>
			</div>
		{:else if $detectedProviders.length > 0}
			<div class="space-y-4">
				<p class="text-sm font-medium">Select a wallet to connect:</p>
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
					{#each $detectedProviders as provider (provider.info.uuid)}
						<button
							class="flex flex-col items-center gap-2 rounded-lg border border-border p-3 transition-all hover:border-primary hover:bg-accent active:scale-95"
							onclick={() => handleConnect(provider)}
						>
							<img
								src={provider.info.icon}
								alt={provider.info.name}
								class="h-8 w-8 object-contain"
							/>
							<span class="text-center text-xs font-medium">{provider.info.name}</span>
						</button>
					{/each}
				</div>
			</div>
		{:else}
			<Alert.Root>
				<Alert.Title>No Wallets Detected</Alert.Title>
				<Alert.Description>
					Please install MetaMask or another Web3 wallet extension to continue.
				</Alert.Description>
			</Alert.Root>
		{/if}
	</Card.Content>
</Card.Root>
