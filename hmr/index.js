const path = require('path');
const { createFilter } = require('rollup-pluginutils');
const { createMakeHot } = require('svelte-hmr');

const hotApiAlias = 'rollup-plugin-svelte-hmr/_/hot-api';

const svelteHmr = (options = {}) => {
	const { hot = true, nollup = false, patchSapperDevClient = false } = options;

	const filter = createFilter('**/*.svelte', []);

	const hotApiPath = `${__dirname}/hot-api/${nollup ? 'nollup' : 'rollup'}.js`;
	const hotApi = path.resolve(hotApiPath);
	const makeHot = createMakeHot(hotApi, {
		meta: nollup ? 'module' : 'import.meta',
	});
	const aliases = {
		[hotApiAlias]: hotApi,
	};

	function _transform(code, id, compiled) {
		if (!hot) return;
		if (!filter(id)) return;

		this.addWatchFile(hotApi);

		const transformed = makeHot(id, code, options, compiled);

		return transformed;
	}

	let fs;
	const _setFs = _fs => {
		fs = _fs;
	};

	const resolveId = (target, from) => {
		const alias = aliases[target];
		if (alias) {
			return alias;
		}
		if (patchSapperDevClient) {
			if (/\/sapper-dev-client.js$/.test(target)) {
				return path.join(__dirname, 'sapper-dev-client.js');
			}
		}
		if (fs) {
			const name = path.join(path.dirname(from), target);
			const extensions = ['.js', '.svelte'];
			for (const ext of extensions) {
				const filename = name + ext;
				if (fs.existsSync(filename) && fs.lstatSync(filename).isFile()) {
					return filename;
				}
			}
		}
	};

	function load(id) {
		if (!fs) return;
		return new Promise((resolve, reject) => {
			fs.readFile(id, 'utf8', (err, contents) => {
				if (err) reject(err);
				else resolve(contents);
			});
		});
	}

	// We need to pass _after_ Nollup's HMR plugin, that registers itself last.
	const nollupBundleInit = () => `
    const init = () => {
      if (typeof window === 'undefined') return
      if (!window.__hot) return
      if (!window.__hot.addErrorHandler) return
      window.__hot.addErrorHandler(
        err => {
          const adapter = window.__SVELTE_HMR_ADAPTER
          if (adapter && adapter.renderCompileError) {
            adapter.renderCompileError(err)
          }
        }
      )
    }
    setTimeout(init)
  `;

	const listeners = {
		generateBundle: [],
		renderError: [],
	};

	const addListener = type => listener => {
		listeners[type].push(listener);
	};

	const fire = type => (...args) => {
		listeners[type].forEach(listener => listener(...args));
	};

	const generateBundle = fire('generateBundle');
	const renderError = fire('renderError');

	const _onBundleGenerated = addListener('generateBundle');

	const _onRenderError = addListener('renderError');

	return {
		name: 'svelte-hmr',
		nollupBundleInit,
		resolveId,
		load,
		generateBundle,
		renderError,
		transform(code, id) {
			return _transform.call(this, code, id);
		},
		// used by rollup-plugin-svelte
		_transform,
		// used by test driver
		_setFs,
		_onBundleGenerated,
		_onRenderError,
	};
};

module.exports = svelteHmr;
