import { writable } from 'svelte/store';

export type PageType = 'home' | 'send' | 'receive' | 'legacy';

function createRouter() {
	const { subscribe, set } = writable<PageType>('home');

	return {
		subscribe,
		navigate: (page: PageType) => {
			set(page);
			window.scrollTo(0, 0);
			// Update hash for browser history
			if (page === 'home') {
				window.location.hash = '';
			} else {
				window.location.hash = page;
			}
		},
		getCurrentPage: () => {
			const hash = window.location.hash.slice(1) || 'home';
			if (hash === 'send' || hash === 'receive' || hash === 'legacy') {
				return hash as PageType;
			}
			return 'home' as PageType;
		},
	};
}

export const router = createRouter();
