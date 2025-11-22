import { writable } from 'svelte/store';

export interface TransactionRecord {
	hash: string;
	from: string;
	to: string;
	toEnsName?: string | null;
	amount: string; // in ETH
	timestamp: number;
	status: 'pending' | 'confirmed' | 'failed';
	explorerUrl: string;
}

const STORAGE_KEY = 'schwarzschild_transactions';

function createTransactionStore() {
	const { subscribe, set, update } = writable<TransactionRecord[]>([]);

	// Load transactions from localStorage on init
	if (typeof window !== 'undefined') {
		try {
			const stored = localStorage.getItem(STORAGE_KEY);
			if (stored) {
				set(JSON.parse(stored));
			}
		} catch (err) {
			console.error('Failed to load transactions from storage:', err);
		}
	}

	const saveToStorage = (transactions: TransactionRecord[]) => {
		try {
			if (typeof window !== 'undefined') {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
			}
		} catch (err) {
			console.error('Failed to save transactions to storage:', err);
		}
	};

	return {
		subscribe,
		add: (transaction: TransactionRecord) => {
			update((transactions) => {
				// Add to beginning of list (most recent first)
				const updated = [transaction, ...transactions];
				saveToStorage(updated);
				return updated;
			});
		},
		updateStatus: (hash: string, status: 'pending' | 'confirmed' | 'failed') => {
			update((transactions) => {
				const updated = transactions.map((t) =>
					t.hash === hash ? { ...t, status } : t
				);
				saveToStorage(updated);
				return updated;
			});
		},
		clear: () => {
			set([]);
			try {
				if (typeof window !== 'undefined') {
					localStorage.removeItem(STORAGE_KEY);
				}
			} catch (err) {
				console.error('Failed to clear transactions:', err);
			}
		},
		getRecent: (count: number = 5) => {
			let recentTxs: TransactionRecord[] = [];
			subscribe((txs) => {
				recentTxs = txs.slice(0, count);
			})();
			return recentTxs;
		},
	};
}

export const transactions = createTransactionStore();
