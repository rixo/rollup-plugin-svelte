# rollup-plugin-svelte-hot changelog

## 0.11.0 (merge 6.0.0)

* merge `rollup-plugin-svelte@6.0.0`

* Breaking changes:
	* Rollup 1.19.2+ is now required
	* The path passed to `css.write()` is now relative to the destination directory.

## 0.10.0

* merge `rollup-plugin-svelte@5.2.3`

## 0.5.0

* Remove previously added CSS stylesheet on hot update.

* Set `css` option to false when `hot` option is enabled (breaking change).

* Add `noDisableCss` option to prevent this behaviour.

## 0.2.0

* Drop HMR support for Svelte < 3.19

* Support for preservation of local state and reactive expressions with Svelte 3.19+ ([svelte#3822](https://github.com/sveltejs/svelte/pull/3822))

* _(Ported from `rollup-plugin-svelte@5.1.1`)_ Use Svelte 3's built-in logic for automatically determining the component name from its file path ([#74](https://github.com/rollup/rollup-plugin-svelte/issues/74))

## 0.1.x

* Warming up :muscle:

## before

* Forked from `rollup-plugin-svelte` (see [changelog](https://github.com/sveltejs/rollup-plugin-svelte/blob/master/CHANGELOG.md) until 5.1.0)
