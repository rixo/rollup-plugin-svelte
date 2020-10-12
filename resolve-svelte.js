const path = require('path');
const relative = require('require-relative');

function tryResolve(pkg, importer) {
	try {
		return relative.resolve(pkg, importer);
	} catch (err) {
		if (err.code === 'MODULE_NOT_FOUND') return null;
		throw err;
	}
}

const absolute = (name, base) =>
	path.isAbsolute(name) ? name : path.join(base, name);

const resolveSveltePkg = () => {
	const { SVELTE } = process.env;
	const cwd = process.cwd();

	// forcefuly set by env
	if (SVELTE) {
		const dir = absolute(SVELTE, cwd);
		// eslint-disable-next-line no-console
		console.log(
			'[HMR:Svelte]',
			`Use Svelte location from SVELTE env variable: ${dir}`
		);
		return path.join(dir, 'package.json');
	}

	const possiblePaths = [ require.main.path, cwd ];
	for (const from of possiblePaths) {
		const file = tryResolve('svelte/package.json', from);
		if (file) {
			return file;
		}
	}

	throw new Error('Failed to find Svelte location');
};

const sveltePkg = resolveSveltePkg();
const svelteDir = path.dirname(sveltePkg);

const { version } = require(sveltePkg);

const major_version = +String(version.split('.'))[0];

const { compile, preprocess, walk } =
	major_version >= 3 ? require(`${svelteDir}/compiler`) : require(`${svelteDir}`);

const parentDir = path.dirname(svelteDir);

// resolveId hook to force resolution of Svelte imports to the same location as
// the one that will be used to compile
function resolveSvelteId (importee, importer) {
	// in practice, it should be safe against infinite recursion because target
	// will be an absolute path. 'svelte' or 'svelte/...' can't be valid absolute
	// paths AFAIK
	if (importee === 'svelte' || importee.startsWith('svelte/')) {
		const target = path.resolve(parentDir, importee);
		return this.resolve
			? this.resolve(target, importer, { skipSelf: true })
			: this.resolveId(target, importer);
	}
	return null;
}

module.exports = {
	version,
	major_version,
	compile,
	preprocess,
	walk,
	resolveSvelteId,
};
