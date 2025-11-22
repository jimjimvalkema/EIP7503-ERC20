<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import WalletConnect from './WalletConnect.svelte';

	interface Props {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		onConnect?: () => void;
	}

	let { open = false, onOpenChange, onConnect }: Props = $props();

	function handleConnect() {
		onConnect?.();
		onOpenChange?.(false);
	}

	function handleOpenChange(newOpen: boolean) {
		onOpenChange?.(newOpen);
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Connect Your Wallet</Dialog.Title>
		</Dialog.Header>
		<div class="py-4">
			<WalletConnect
				onConnect={handleConnect}
				onDisconnect={() => {
					// Optional: handle disconnect
				}}
			/>
		</div>
	</Dialog.Content>
</Dialog.Root>
