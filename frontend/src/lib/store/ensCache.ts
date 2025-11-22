import { writable } from 'svelte/store';

export interface EnsCacheEntry {
	address: string;
	ensName: string | null;
	timestamp: number;
}

const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

function createEnsCache() {
	const { subscribe, set, update } = writable<Map<string, EnsCacheEntry>>(new Map());

	return {
		subscribe,
		get: (address: string) => {
			let entry: EnsCacheEntry | undefined;
			subscribe((cache) => {
				entry = cache.get(address.toLowerCase());
			})();
			
			if (entry && Date.now() - entry.timestamp < CACHE_DURATION) {
				return entry.ensName;
			}
			return null;
		},
		set: (address: string, ensName: string | null) => {
			update((cache) => {
				cache.set(address.toLowerCase(), {
					address: address.toLowerCase(),
					ensName,
					timestamp: Date.now(),
				});
				return cache;
			});
		},
		clear: () => {
			set(new Map());
		},
	};
}

export const ensCache = createEnsCache();
