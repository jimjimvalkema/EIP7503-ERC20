<script lang="ts" module>
	export type TypedDataSignerProps = {
		onSign?: (signature: string) => void
	}
</script>

<script lang="ts">
	import { connectedAccount, currentProvider, signatureResult, signTypedData, createSampleTypedData } from '$lib/providers'
	import Button from '$lib/components/ui/button/button.svelte'
	import * as Card from '$lib/components/ui/card'
	import TextArea from '$lib/components/ui/textarea/textarea.svelte'
	import Label from '$lib/components/ui/label/label.svelte'
	import * as Alert from '$lib/components/ui/alert'

	let { onSign }: TypedDataSignerProps = $props()

	let isLoading = $state(false)
	let error = $state<string | null>(null)
	let typedDataJson = $state('')

	$effect(() => {
		if ($connectedAccount) {
			const sampleData = createSampleTypedData($connectedAccount)
			typedDataJson = JSON.stringify(sampleData, null, 2)
		}
	})

	const handleSign = async () => {
		if (!typedDataJson.trim()) {
			error = 'Please enter typed data'
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
			const typedData = JSON.parse(typedDataJson)
			const signature = await signTypedData(typedData, $connectedAccount, $currentProvider)
			onSign?.(signature)
		} catch (err) {
			if (err instanceof SyntaxError) {
				error = 'Invalid JSON format'
			} else {
				error = err instanceof Error ? err.message : 'Failed to sign typed data'
			}
		} finally {
			isLoading = false
		}
	}

	const useSampleData = () => {
		if ($connectedAccount) {
			const sampleData = createSampleTypedData($connectedAccount)
			typedDataJson = JSON.stringify(sampleData, null, 2)
			error = null
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
		<Card.Title>Sign Typed Data (EIP-712)</Card.Title>
		<Card.Description>Sign structured data that can be verified onchain</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if !$connectedAccount}
			<Alert.Root>
				<Alert.Title>Wallet Not Connected</Alert.Title>
				<Alert.Description>Connect your wallet to sign typed data</Alert.Description>
			</Alert.Root>
		{:else}
			<div class="space-y-4">
				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<Label for="typed-data-input">Typed Data (JSON)</Label>
						<Button variant="outline" size="sm" onclick={useSampleData}>
							Load Sample
						</Button>
					</div>
					<TextArea
						id="typed-data-input"
						bind:value={typedDataJson}
						placeholder="Enter typed data JSON..."
						disabled={isLoading}
						class="min-h-[300px] font-mono text-xs"
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
					disabled={isLoading || !typedDataJson.trim()}
					class="w-full"
				>
					{isLoading ? 'Signing...' : 'Sign Typed Data (eth_signTypedData_v4)'}
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
