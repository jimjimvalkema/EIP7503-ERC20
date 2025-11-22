<script lang="ts">
	import { transactions } from '$lib/store/transactions';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';

	function formatDate(timestamp: number): string {
		const date = new Date(timestamp);
		return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	function getStatusColor(status: string): string {
		switch (status) {
			case 'confirmed':
				return 'text-green-500';
			case 'failed':
				return 'text-red-500';
			default:
				return 'text-yellow-500';
		}
	}

	function getStatusBgColor(status: string): string {
		switch (status) {
			case 'confirmed':
				return 'bg-green-950';
			case 'failed':
				return 'bg-red-950';
			default:
				return 'bg-yellow-950';
		}
	}

	function shortenHash(hash: string): string {
		return hash.slice(0, 6) + '...' + hash.slice(-4);
	}
</script>

<Card class="border-purple-900">
	<CardHeader>
		<CardTitle class="flex items-center justify-between">
			<span>Recent Transactions</span>
			{#if $transactions.length > 0}
				<Button
					variant="outline"
					size="sm"
					onclick={() => transactions.clear()}
					class="text-xs"
				>
					Clear History
				</Button>
			{/if}
		</CardTitle>
	</CardHeader>
	<CardContent>
		{#if $transactions.length === 0}
			<p class="text-sm text-muted-foreground text-center py-6">
				No transactions yet
			</p>
		{:else}
			<div class="space-y-2">
				{#each $transactions as tx (tx.hash)}
					<div class="p-3 border border-border rounded-md hover:bg-card/50 transition-colors">
						<div class="flex items-start justify-between gap-2 mb-2">
							<div class="flex-1">
								<p class="font-mono text-sm">{shortenHash(tx.hash)}</p>
								<p class="text-xs text-muted-foreground">{formatDate(tx.timestamp)}</p>
							</div>
							<div class={`px-2 py-1 rounded text-xs font-medium ${getStatusBgColor(tx.status)} ${getStatusColor(tx.status)}`}>
								{tx.status}
							</div>
						</div>
					<div class="flex flex-col gap-1 text-sm mb-2">
						<div>
							<span class="text-muted-foreground">From: </span>
							<span class="font-mono text-xs">{shortenHash(tx.from)}</span>
						</div>
						<div class="flex items-center justify-between">
							<div>
								<span class="text-muted-foreground">To: </span>
								<span class="font-mono text-xs">{tx.toEnsName ? `${tx.toEnsName} (${shortenHash(tx.to)})` : shortenHash(tx.to)}</span>
							</div>
							<span class="font-semibold">{tx.amount} ETH</span>
						</div>
					</div>
						<a
							href={tx.explorerUrl}
							target="_blank"
							rel="noreferrer"
							class="text-xs text-[#F25912] hover:underline"
						>
							View on Explorer →
						</a>
					</div>
				{/each}
			</div>
		{/if}
	</CardContent>
</Card>
