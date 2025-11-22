<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { connectedAccount, connectedProvider } from '$lib/providers';
	import { getEnsName } from '$lib/utils/wallet';
	import type { Address } from 'viem';
	import { Wallet, LogOut } from '@lucide/svelte';


	interface Props {
		onOpenWalletModal?: () => void;
		onDisconnect?: () => void;
	}

	let { onOpenWalletModal, onDisconnect }: Props = $props();

	let displayName: string | null = $state(null);
	let isLoadingName = $state(false);

	async function loadEnsName() {
		if (!$connectedAccount) return;

		try {
			isLoadingName = true;
			const ensName = await getEnsName($connectedAccount as Address);
			if (ensName) {
				displayName = ensName;
			} else {
				// Show shortened address if no ENS name
				displayName = `${$connectedAccount.slice(0, 6)}...${$connectedAccount.slice(-4)}`;
			}
		} catch (error) {
			console.error('Failed to load ENS name:', error);
			displayName = `${$connectedAccount.slice(0, 6)}...${$connectedAccount.slice(-4)}`;
		} finally {
			isLoadingName = false;
		}
	}

	function handleDisconnect() {
		displayName = null;
		onDisconnect?.();
	}

	$effect(() => {
		if ($connectedAccount) {
			loadEnsName();
		} else {
			displayName = null;
		}
	});
</script>

<div class="absolute top-4 right-4 flex items-center gap-2">
	{#if $connectedAccount}
		<div class="flex items-center gap-3 px-4 py-2 bg-card border border-border rounded-lg">
			<div class="flex items-center gap-2">
				<div class="w-2 h-2 bg-green-500 rounded-full"></div>
				<div class="text-sm">
					{#if isLoadingName}
						<span class="text-muted-foreground">Loading...</span>
					{:else}
						<p class="font-medium text-foreground">{displayName}</p>
						<p class="text-xs text-muted-foreground">{$connectedProvider || 'Connected'}</p>
					{/if}
				</div>
			</div>
		</div>
		<Button
			onclick={handleDisconnect}
			variant="outline"
			size="icon"
			class="h-10 w-10"
			title="Disconnect wallet"
		>
			<LogOut size={18} />
		</Button>
	{:else}
		<Button onclick={onOpenWalletModal} variant="outline" class="gap-2">
			<Wallet size={18} />
			Connect Wallet
		</Button>
	{/if}
</div>
