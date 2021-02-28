const fs = require('fs');
const path = require('path');
const relative = require('require-relative');
const { createFilter } = require('@rollup/pluginutils');
const { compile, preprocess, walk } = require('svelte/compiler');
const { createMakeHot } = require('svelte-hmr');

const PREFIX = '[rollup-plugin-svelte]';
const pkg_export_errors = new Set();

const splitQuery = url => {
	const parts = url.split('?');
	if (parts.length < 2) return [parts[0], ''];
	const query = parts.pop();
	return [parts.join('?'), '?' + query];
};

const trimQuery = url => splitQuery(url)[0];

const readJsonFile = async (file, encoding = 'utf8') => JSON.parse(await fs.promises.readFile(file, encoding));

const plugin_options = new Set([
	'emitCss',
	'exclude',
	'extensions',
	'include',
	'onwarn',
	'preprocess',
	'hot',
]);

/**
 * @param [options] {Partial<import('.').Options>}
 * @returns {import('rollup').Plugin}
 */
module.exports = function (options = {}) {
	const { compilerOptions={}, ...rest } = options;
	const extensions = rest.extensions || ['.svelte'];
	const filter = createFilter(rest.include, rest.exclude);

	compilerOptions.format = 'esm';

	for (const key in rest) {
		if (plugin_options.has(key)) continue;
		console.warn(`${PREFIX} Unknown "${key}" option. Please use "compilerOptions" for any Svelte compiler configuration.`);
	}

	// --- Virtual CSS ---

	// [filename]:[chunk]
	const cache_emit = new Map;
	const { onwarn, emitCss=true } = rest;

	if (emitCss) {
		if (compilerOptions.css) {
			console.warn(`${PREFIX} Forcing \`"compilerOptions.css": false\` because "emitCss" was truthy.`);
		}
		compilerOptions.css = false;
	}

	// --- HMR ---

	let makeHot;

	const initMakeHot = () => {
		if (rest.hot) {
			makeHot = createMakeHot({
				walk,
				// Resolving runtime deps of svelte-hmr to absolute path because it is
				// a transitive deps to the user's app, and it might not be "visible" with
				// strict package managers like pnpm.
				// NOTE Can't use require.resolve here, because this moduled might end up
				// 		  bundled to ESM in Kit.
				adapter: relative.resolve('svelte-hmr/runtime/proxy-adapter-dom.js'),
				hotApi: relative.resolve('svelte-hmr/runtime/hot-api-esm.js'),
			});
		} else {
			makeHot = null;
		}
	};

	// --- Vite 2 support ---

	let viteConfig;
	let isViteDev = !!process.env.ROLLUP_WATCH;

	const isVite = () => !!viteConfig;

	const resolveViteUrl = id => {
		if (!viteConfig) return id;
		const { root, base } = viteConfig;
		if (!id.startsWith(root + '/')) return id;
		return base + id.substr(root.length + 1);
	};

	const resolveVitePath = url => {
		if (!viteConfig) return url;
		const { root, base } = viteConfig;
		if (!url.startsWith(base)) return url;
		return root + '/' + url.substr(base.length);
	};

	// === Hooks ===

	return {
		name: 'svelte',

		// --- Vite specific hooks ---

		/**
		 * Vite specific. Ensure our resolver runs first to resolve svelte field.
		 */
		enforce: 'pre',

		/**
		 * Vite specific hook. Used to determine if we're running Vite in dev mode,
		 * meaning we need to add cache buster query params to modules for HMR, and
		 * to customize customize config for Svelte.
		 */
		config(config, { mode, command }) {
			// TODO is this the only case we want to catch?
			isViteDev = mode === 'development' && command === 'serve';
			return {
				// Svelte exports prebundled ESM modules, so it doesn't need to be
				// optimized. Exluding it might avoid a false starts, where the page
				// isn't immediately available while optimizing and generates "strict
				// mime type" errors in the browser (e.g. on very first run, or when
				// running dev after build sometimes).
				optimizeDeps: {
					exclude: ['svelte']
				},
				resolve: {
					// Prevent duplicated svelte runtimes with symlinked Svelte libs.
					dedupe: ['svelte']
				}
			};
		},

		/**
		 * Vite specific hook. Vite config is needed to know root directory and
		 * base URL.
		 */
		configResolved(config) {
			viteConfig = config;
		},

		// --- Shared Rollup / Vite hooks ---

		/**
		 * We need to resolve hot or not after knowing if we are in Vite or not.
		 *
		 * For hot and dev, Rollup defaults are off, while Vite defaults are auto
		 * (that is, enabled in dev serve).
		 */
		buildStart() {
			if (isViteDev) {
				// enable if not specified
				if (compilerOptions.dev == null) compilerOptions.dev = true;
				if (rest.hot == null) rest.hot = true;
			}
			if (rest.hot && !compilerOptions.dev) {
				console.info(`${PREFIX} Disabling HMR because "dev" option is disabled.`);
				rest.hot = false;
			}
			initMakeHot();
		},

		/**
		 * Resolve an import's full filepath.
		 */
		async resolveId(importee, importer, options, ssr = false) {
			if (isVite()) {
				const [fname, query] = splitQuery(importee);
				if (cache_emit.has(fname)) {
					return ssr ? resolveVitePath(fname + query) : importee;
				}
			} else {
				 if (cache_emit.has(importee)) return importee;
			}

			if (!importer || importee[0] === '.' || importee[0] === '\0' || path.isAbsolute(importee)) return null;

			// if this is a bare import, see if there's a valid pkg.svelte
			const parts = importee.split('/');

			let dir, pkg, name = parts.shift();
			if (name && name[0] === '@') {
				name += `/${parts.shift()}`;
			}

			try {
				const file = `${name}/package.json`;
				const resolved = relative.resolve(file, path.dirname(importer));
				dir = path.dirname(resolved);
				// NOTE this can't be a "dynamic" CJS require, because this might end
				//      up compiled as ESM in Kit
				pkg = await readJsonFile(resolved);
			} catch (err) {
				if (err.code === 'MODULE_NOT_FOUND') return null;
				if (err.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
					pkg_export_errors.add(name);
					return null;
				}
				throw err;
			}

			// use pkg.svelte
			if (parts.length === 0 && pkg.svelte) {
				return path.resolve(dir, pkg.svelte);
			}
		},

		/**
		 * Returns CSS contents for a file, if ours
		 */
		load(id) {
			const cacheKey = isVite() ? trimQuery(resolveViteUrl(id)) : id;
			return cache_emit.get(cacheKey) || null;
		},

		/**
		 * Transforms a `.svelte` file into a `.js` file.
		 * NOTE: If `emitCss`, append static `import` to virtual CSS file.
		 */
		async transform(code, id, ssr = false) {
			if (!filter(id)) return null;

			const extension = path.extname(id);
			if (!~extensions.indexOf(extension)) return null;

			const dependencies = [];
			const filename = path.relative(process.cwd(), id);
			const svelte_options = { ...compilerOptions, filename };

			if (ssr) {
				svelte_options.generate = 'ssr';
			}

			if (rest.preprocess) {
				const processed = await preprocess(code, rest.preprocess, { filename });
				if (processed.dependencies) dependencies.push(...processed.dependencies);
				if (processed.map) svelte_options.sourcemap = processed.map;
				code = processed.code;
			}

			const compiled = compile(code, svelte_options);

			(compiled.warnings || []).forEach(warning => {
				if (!emitCss && warning.code === 'css-unused-selector') return;
				if (onwarn) onwarn(warning, this.warn);
				else this.warn(warning);
			});

			if (emitCss && compiled.css.code) {
				let fname;
				if (isVite()) {
					const url = resolveViteUrl(id);
					fname = url + '.css';
					// NOTE don't use `?t=`, it gets stripped by Vite
					const vname = isViteDev ? fname + '?vt=' + Date.now() : fname;
					compiled.js.code += `\nimport ${JSON.stringify(vname)};\n`;
				} else {
					fname = id.replace(new RegExp(`\\${extension}$`), '.css');
					compiled.js.code += `\nimport ${JSON.stringify(fname)};\n`;
				}
				cache_emit.set(fname, compiled.css);
			}

			if (makeHot && !ssr) {
				compiled.js.code = makeHot({
					id,
					compiledCode: compiled.js.code,
					hotOptions: {
						injectCss: !rest.emitCss,
						...rest.hot,
					},
					compiled,
					originalCode: code,
					compileOptions: compilerOptions,
				});
			}

			if (this.addWatchFile) {
				dependencies.forEach(this.addWatchFile);
			} else {
				compiled.js.dependencies = dependencies;
			}

			return compiled.js;
		},

		/**
		 * All resolutions done; display warnings wrt `package.json` access.
		 */
		generateBundle() {
			if (pkg_export_errors.size > 0) {
				console.warn(`\n${PREFIX} The following packages did not export their \`package.json\` file so we could not check the "svelte" field. If you had difficulties importing svelte components from a package, then please contact the author and ask them to export the package.json file.\n`);
				console.warn(Array.from(pkg_export_errors, s => `- ${s}`).join('\n') + '\n');
			}
		}
	};
};
