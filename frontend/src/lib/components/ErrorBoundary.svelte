<script lang="ts" module>
export interface ErrorBoundaryProps {
	children?: any;
}
</script>

<script lang="ts">
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';

	interface Props {
		children: any;
	}

	let { children }: Props = $props();

	let error = $state<Error | null>(null);

	function reset() {
		error = null;
	}
</script>

{#if error}
	<div class="flex items-center justify-center min-h-screen bg-gradient-to-b from-[#211832] to-[#412B6B] p-4">
		<Alert class="max-w-md border-red-500 bg-red-950">
			<AlertTitle class="text-red-400">⚠️ Something went wrong</AlertTitle>
			<AlertDescription class="mt-3 space-y-3">
				<p class="text-sm text-red-300">{error.message}</p>
				<Button
					onclick={reset}
					class="w-full bg-[#F25912] hover:bg-orange-600 text-white"
				>
					Try Again
				</Button>
			</AlertDescription>
		</Alert>
	</div>
{:else}
	{@render children?.()}
{/if}
