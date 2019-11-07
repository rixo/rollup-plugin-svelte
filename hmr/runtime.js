import { makeApplyHmr } from 'svelte-hmr/runtime';

export const applyHmr = makeApplyHmr(args =>
	Object.assign({}, args, {
		hot: args.m.hot,
	})
);
