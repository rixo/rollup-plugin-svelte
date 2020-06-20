const path = require('path');
const { createMakeHot } = require('svelte-hmr');
const { appendCompatNollup } = require('rollup-plugin-hot-nollup');

const { walk } = require('../resolve-svelte');

const hotApiAlias = 'rollup-plugin-svelte-hmr/_/hot-api';

const svelteHmr = (hotOptions = {}, pluginOptions = {}) => {
	const name = 'svelte (hot)';

	const { include, exclude } = pluginOptions;

	const {
		hot = true,
		compatNollup = !!process.env.NOLLUP,
		patchSapperDevClient = false,
		test = process.env.NODE_ENV === 'test',
	} = hotOptions;

	const makeHot = createMakeHot({ walk });

	const aliases = {
		[hotApiAlias]: makeHot.hotApi,
	};

	function _transform(code, id, compiled, originalCode, compileOptions) {
		if (!hot) return code;
		const transformed = makeHot(
			id,
			code,
			hotOptions,
			compiled,
			originalCode,
			compileOptions
		);
		return transformed;
	}

	let fs;
	const _setFs = _fs => {
		fs = _fs;
	};

	const resolveId = source => {
		const alias = aliases[source];
		if (alias) {
			return alias;
		}
		if (patchSapperDevClient) {
			// .* is because current nollup experimental sapper adds id hashs to names
			if (/\/sapper-dev-client.*.js$/.test(source)) {
				return path.join(__dirname, 'sapper-dev-client.js');
			}
		}
	};

	function load(id) {
		if (!fs) return null;
		if (id.substr(0, 1) === '\0') return null;
		return new Promise((resolve, reject) => {
			fs.readFile(id, 'utf8', (err, contents) => {
				if (err) reject(err);
				else resolve(contents);
			});
		});
	}

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

	const hooks = Object.assign(
		{
			name,
			generateBundle,
			renderError,
			transform(code, id) {
				return _transform.call(this, code, id);
			},
		},
		compatNollup && {
			options: appendCompatNollup(name, { include, exclude }),
		},
		patchSapperDevClient && {
			resolveId,
		},
		// used by test driver
		test && {
			resolveId,
			load,
			_setFs,
			// nollup
			_onBundleGenerated,
			_onRenderError,
		}
	);

	return { hooks, _transform };
};

module.exports = svelteHmr;
