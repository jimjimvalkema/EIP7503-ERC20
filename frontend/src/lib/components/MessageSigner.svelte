<script lang="ts" module>
	export type MessageSignerProps = {
		onSign?: (signature: string) => void
	}
</script>

<script lang="ts">
	import { connectedAccount, currentProvider, signatureResult, signMessage } from '$lib/providers'
	import Button from '$lib/components/ui/button/button.svelte'
	import * as Card from '$lib/components/ui/card'
	import TextArea from '$lib/components/ui/textarea/textarea.svelte'
	import Label from '$lib/components/ui/label/label.svelte'
	import * as Alert from '$lib/components/ui/alert'

	let { onSign }: MessageSignerProps = $props()

	let message = $state('')
	let isLoading = $state(false)
	let error = $state<string | null>(null)

	const handleSign = async () => {
		if (!message.trim()) {
			error = 'Please enter a message'
			return
		}

		if (!$connectedAccount) {
			error = 'No account connected'
			return
		}

		if (!$currentProvider) {
			error = 'No provider available'
			return
		}

		isLoading = true
		error = null

		try {
			const signature = await signMessage(message, $connectedAccount, $currentProvider)
			onSign?.(signature)
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to sign message'
		} finally {
			isLoading = false
		}
	}

	const copySignature = () => {
		if ($signatureResult) {
			navigator.clipboard.writeText($signatureResult)
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>Sign a Message</Card.Title>
		<Card.Description>Sign a message using personal_sign (EIP-191)</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if !$connectedAccount}
			<Alert.Root>
				<Alert.Title>Wallet Not Connected</Alert.Title>
				<Alert.Description>Connect your wallet to sign messages</Alert.Description>
			</Alert.Root>
		{:else}
			<div class="space-y-4">
				<div class="space-y-2">
					<Label for="message-input">Message</Label>
					<TextArea
						id="message-input"
						bind:value={message}
						placeholder="Enter the message to sign..."
						disabled={isLoading}
						class="min-h-[100px] font-mono text-sm"
					/>
				</div>

				{#if error}
					<Alert.Root variant="destructive">
						<Alert.Title>Error</Alert.Title>
						<Alert.Description>{error}</Alert.Description>
					</Alert.Root>
				{/if}

				<Button
					onclick={handleSign}
					disabled={isLoading || !message.trim()}
					class="w-full"
				>
					{isLoading ? 'Signing...' : 'Sign Message (personal_sign)'}
				</Button>

				{#if $signatureResult}
					<div class="space-y-2 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950">
						<h4 class="font-semibold text-green-900 dark:text-green-100">Signature</h4>
						<div class="flex flex-col gap-2">
							<code class="block break-all rounded bg-background p-2 text-xs text-foreground overflow-y-auto max-h-24">
								{$signatureResult}
							</code>
							<Button variant="outline" size="sm" onclick={copySignature} class="w-full">
								Copy Signature
							</Button>
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</Card.Content>
</Card.Root>
