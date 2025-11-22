<script lang="ts">
	import "./app.css";
	import { router, type PageType } from '$lib/store/router';
	
	// Pages
	import LandingPage from './routes/+page.svelte';
	import SendPage from './routes/send/+page.svelte';
	import ReceivePage from './routes/receive/+page.svelte';
	
	// Legacy components
	import WalletConnect from "./lib/components/WalletConnect.svelte";
	import MessageSigner from "./lib/components/MessageSigner.svelte";
	import TypedDataSigner from "./lib/components/TypedDataSigner.svelte";
	import ERC7730Signer from "./lib/components/ERC7730Signer.svelte";

	let currentPage: PageType = $state(router.getCurrentPage());

	// Subscribe to router changes
	$effect(() => {
		const unsubscribe = router.subscribe((page) => {
			currentPage = page;
		});
		return unsubscribe;
	});

	// Listen for browser back/forward
	$effect(() => {
		const handlePopState = () => {
			const page = router.getCurrentPage();
			currentPage = page;
		};

		window.addEventListener('popstate', handlePopState);
		return () => window.removeEventListener('popstate', handlePopState);
	});
</script>

{#if currentPage === 'home'}
	<LandingPage />
{:else if currentPage === 'send'}
	<SendPage />
{:else if currentPage === 'receive'}
	<ReceivePage />
{:else if currentPage === 'legacy'}
	<main>
		<div class="card">
			<WalletConnect />
		</div>

		<div class="card">
			<MessageSigner />
		</div>

		<div class="card">
			<TypedDataSigner />
		</div>

		<div class="card">
			<ERC7730Signer />
		</div>
	</main>
{/if}

<style>
	:global(body) {
		margin: 0;
		padding: 0;
	}
</style>
