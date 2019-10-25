import { makeApplyHmr } from 'svelte-hmr/runtime';

const g = typeof window !== 'undefined' ? window : global;

if (!g.__ROLLUP_PLUGIN_SVELTE_HMR) {
	g.__ROLLUP_PLUGIN_SVELTE_HMR = {};
}

export const applyHmr = makeApplyHmr(args => {
	const { m, id, hotOptions, reload } = args;

	const globState = g.__ROLLUP_PLUGIN_SVELTE_HMR;

	const hotState = (globState[id] = globState[id] || { declined: false });

	if (hotState.declined) {
		if (!hotOptions.noReload) {
			reload();
		} else {
			// eslint-disable-next-line no-console
			console.log('[HMR][Svelte] Full reload required');
		}
	}

	const dispose = handler => {
		m.hot.dispose(() => {
			if (!hotState.data) {
				hotState.data = {};
			}
			handler(hotState.data);
		});
	};

	// TODO not used anymore... remove?
	// eslint-disable-next-line no-unused-vars
	const decline = () => {
		hotState.declined = true;
	};

	const accept = handler => {
		m.hot.accept(() => {
			require(m.id);
			if (handler) {
				handler();
			}
		});
	};

	const hot = {
		data: hotState.data,
		dispose,
		accept,
	};

	return Object.assign({}, args, { hot });
});
