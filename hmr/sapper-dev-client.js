/**
 * FIXME
 *
 * We need to use a custom sapper dev client currently, because the official
 * one does not support our "hot API" (only webpack-style, when it sees rollup,
 * it does force reloads).
 */
export function connect() {
	// eslint-disable-next-line no-console
	console.log('[SAPPER] dev client: bails out in favor of Rollup HMR');
}
