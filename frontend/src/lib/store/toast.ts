import { writable } from 'svelte/store';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
	id: string;
	message: string;
	type: ToastType;
	duration?: number;
}

function createToastStore() {
	const { subscribe, set, update } = writable<Toast[]>([]);

	const remove = (id: string) => {
		update((toasts) => toasts.filter((t) => t.id !== id));
	};

	const add = (message: string, type: ToastType = 'info', duration = 4000) => {
		const id = Math.random().toString(36).substring(2, 11);
		const toast: Toast = { id, message, type, duration };

		update((toasts) => [...toasts, toast]);

		if (duration > 0) {
			setTimeout(() => {
				remove(id);
			}, duration);
		}

		return id;
	};

	return {
		subscribe,
		add,
		remove,
		clear: () => {
			set([]);
		},
		success: (message: string, duration?: number) => {
			return add(message, 'success', duration);
		},
		error: (message: string, duration?: number) => {
			return add(message, 'error', duration);
		},
		info: (message: string, duration?: number) => {
			return add(message, 'info', duration);
		},
		warning: (message: string, duration?: number) => {
			return add(message, 'warning', duration);
		},
	};
}

export const toasts = createToastStore();
