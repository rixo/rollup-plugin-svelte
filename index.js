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

const cssChanged = (a, b) => {
	if (!a && !b) return false;
	if (!a && b) return true;
	if (a && !b) return true;
	return a !== b;
};

const normalizeNonCss = (code, cssHash) => {
	// trim HMR transform
	const indexHmrTransform = code.indexOf('import * as ___SVELTE_HMR_HOT_API from');
	if (indexHmrTransform !== -1) code = code.slice(0, indexHmrTransform);
	// remove irrelevant bits
	return code
		// ignore css hashes in the code (that have changed, necessarily)
		.replace(new RegExp('\\s*\\b' + cssHash + '\\b\\s*', 'g'), '')
		.replace(/\s*attr_dev\([^,]+,\s*"class",\s*""\);?\s*/g, '')
		// Svelte now adds locations in dev mode, code locations can change when
		// CSS change, but we're unaffected (not real behaviour changes)
		.replace(/\s*\badd_location\s*\([^)]*\)\s*;?/g, '');
};

const jsChanged = (hash, a, b) => {
	if (!a && !b) return false;
	if (!a && b) return true;
	if (a && !b) return true;
	return normalizeNonCss(a, hash) !== normalizeNonCss(b, hash);
};

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

	// --- Log ---

	let log = console;

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
			makeHot = createMakeHot({ walk });
		} else {
			makeHot = null;
		}
	};

	// --- Vite 2 support ---

	const transformCache = new Map();
	const cssHashes = new Map();

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

		async handleHotUpdate(ctx) {
			const { file, server, read } = ctx;
			// guards
			if (!emitCss) return;
			if (!rest.hot) return;
			if (!filter(file)) return;

			// resolve existing from caches
			const id = resolveViteUrl(file);
			const cssId = id + '.css';
			const cachedCss = cache_emit.get(cssId);
			const cachedJs = transformCache.get(id);

			// clear cache to avoid transform from using it
			transformCache.delete(id);

			// guard: no cached result
			if (!cachedCss || !cachedJs) return;

			// repopulate caches by running transform
			const { code: newJs } = await this.transform(await read(), file, false) || {};
			const { code: newCss } = cache_emit.get(cssId) || {};

			const affectedModules = [];
			const cssModules = server.moduleGraph.getModulesByFile(file + '.css');
			const jsModules = server.moduleGraph.getModulesByFile(file);

			const hasJsModules = jsModules && jsModules.size > 0;
			const hasCssModules = cssModules && cssModules.size > 0;

			if (!hasJsModules && !hasCssModules) return;

			const hash = cssHashes.get(file);
			if (hasJsModules && jsChanged(hash, cachedJs.code, newJs)) {
				affectedModules.push(...jsModules);
			}
			if (hasCssModules && cssChanged(cachedCss.code, newCss)) {
				affectedModules.push(...cssModules);
			}

			for (const m of affectedModules) {
				server.moduleGraph.invalidateModule(m);
			}

			return affectedModules;
		},

		// --- Shared Rollup / Vite hooks ---

		/**
		 * We need to resolve hot or not after knowing if we are in Vite or not.
		 *
		 * For hot and dev, Rollup defaults are off, while Vite defaults are auto
		 * (that is, enabled in dev serve).
		 */
		buildStart() {
			if (!isVite()) {
				log = this;
			}
			if (isViteDev) {
				// enable dev/hot in dev serve, if not specified
				if (compilerOptions.dev == null) compilerOptions.dev = true;
				if (rest.hot == null) rest.hot = true;
				if (rest.hot && emitCss && !compilerOptions.cssHash) {
					compilerOptions.cssHash = ({hash, filename}) => {
						const file = path.resolve(filename);
						const id = hash(file).padEnd(12, 0).slice(0, 12);
						const cssHash = `svelte-${id}`;
						cssHashes.set(file, cssHash);
						return cssHash;
					};
				}
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

			if (isVite()) {
				const cacheKey = resolveViteUrl(id);
				const cached = transformCache.get(cacheKey);
				if (cached) {
					return cached;
				}
			}

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
				if (onwarn) onwarn(warning, log.warn);
				else log.warn(warning);
			});

			if (emitCss) {
				const fname = isVite()
					? resolveViteUrl(id) + '.css'
					: id.replace(new RegExp(`\\${extension}$`), '.css');
				if (compiled.css.code) {
					compiled.js.code += `\nimport ${JSON.stringify(fname)};\n`;
					cache_emit.set(fname, compiled.css);
				} else {
					cache_emit.set(fname, {code: ''});
				}
			}

			if (makeHot && !ssr) {
				compiled.js.code = makeHot({
					id,
					compiledCode: compiled.js.code,
					hotOptions: {
						injectCss: !emitCss,
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

			if (isVite()) {
				const cacheKey = resolveViteUrl(id);
				transformCache.set(cacheKey, compiled.js);
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
