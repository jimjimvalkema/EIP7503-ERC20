<script lang="ts">
	import { toasts } from '$lib/store/toast';
	import { cn } from '$lib/utils';

	const baseClasses =
		'fixed right-4 max-w-sm rounded-lg shadow-lg p-4 mb-3 flex items-start gap-3 animate-in fade-in duration-300';

	const typeClasses = {
		success: 'bg-green-900 text-green-100 border border-green-700',
		error: 'bg-red-900 text-red-100 border border-red-700',
		info: 'bg-blue-900 text-blue-100 border border-blue-700',
		warning: 'bg-yellow-900 text-yellow-100 border border-yellow-700',
	};
</script>

<div class="fixed top-4 right-4 z-50 space-y-2 pointer-events-none">
	{#each $toasts as toast (toast.id)}
		<div
			class={cn(baseClasses, typeClasses[toast.type])}
			role="alert"
		>
			<div class="flex-1 text-sm">
				{toast.message}
			</div>
			<button
				onclick={() => toasts.remove(toast.id)}
				class="text-current opacity-70 hover:opacity-100 flex-shrink-0 pointer-events-auto"
				aria-label="Close toast"
			>
				✕
			</button>
		</div>
	{/each}
</div>
