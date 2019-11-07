const path = require('path');
const { createMakeHot } = require('svelte-hmr');

const hotApiAlias = 'rollup-plugin-svelte-hmr/_/hot-api';

const svelteHmr = (options = {}) => {
	const {
		hot = true,
		nollup = false,
		patchSapperDevClient = false,
		test = false,
	} = options;

	const hotApi = path.join(__dirname, 'runtime.js');
	const makeHot = createMakeHot(hotApi);

	const aliases = {
		[hotApiAlias]: hotApi,
	};

	function _transform(code, id, compiled) {
		if (!hot) return code;

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
			const base = from ? path.dirname(from) : process.cwd();
			const name = path.join(base, target);
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
		if (!fs) return null;
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

	return Object.assign(
		{
			name: 'svelte-hmr',
			generateBundle,
			renderError,
			transform(code, id) {
				return _transform.call(this, code, id);
			},
			// used by rollup-plugin-svelte-hot (i.e. that's here, now!)
			_transform,
		},
		nollup && Object.assign({
			nollupBundleInit,
		}, test && {
			_onBundleGenerated,
			_onRenderError,
		}),
		patchSapperDevClient && {
			resolveId,
		},
		// used by test driver
		test && {
			resolveId,
			load,
			_setFs,
		}
	);
};

module.exports = svelteHmr;
