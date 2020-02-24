# rollup-plugin-svelte-hot

This is a fork of official [rollup-plugin-svelte](https://github.com/rollup/rollup-plugin-svelte) with added HMR support.

It supports HMR both with [Nollup](https://github.com/PepsRyuu/nollup), or [Rollup](https://github.com/rollup/rollup) with (experimental) [rollup-plugin-hot](https://github.com/rixo/rollup-plugin-hot).

HMR is not officially supported by Svelte 3 yet. Progress can be tracked in [this issue](https://github.com/sveltejs/svelte/issues/3632).

Meanwhile, please report your issues regarding HMR (with Rollup / Nollup) in this project's [issue tracker](https://github.com/rixo/rollup-plugin-svelte-hot/issues).

**:warning: Experimental :warning:**

This HMR implementation relies on Svelte's private & non documented API. This means that it can stop working with any new version of Svelte.

**Update 2020-02-24** We're [making progress](https://github.com/sveltejs/svelte/pull/3822) :)

## Templates

To quickly bootstrap a new project, or for example purpose, you can use the following templates. They are copies of official templates, with the bare minimum added to support HMR with this plugin.

- [svelte-template-hot](https://github.com/rixo/svelte-template-hot): hot version of the official Svelte template for Rollup.

- [sapper-template-hot](https://github.com/rixo/sapper-template-hot/tree/rollup): the `rollup` branch of this template uses this plugin to do Sapper + Rollup + HMR. This one is still very (very) much a work in progress.

## Installation

```bash
npm install --save-dev rollup-plugin-svelte-hot
```

## Usage

This plugin can be used as a drop-in replacement for `rollup-plugin-svelte`. It adds just one additional config option to enable HMR: `hot`. It aims to remain as close to the official plugin as possible. Please refer to official docs for general usage of the plugin. For HMR specific stuff, see bellow.

```js
// rollup.config.js
import svelte from 'rollup-plugin-svelte-hot';

...

const hot = !production && !!watch

export default {
  input: 'src/main.js',
  output: {
    file: 'public/bundle.js',
    // format will be overridden to 'system' when using Rollup + HMR
    format: 'iife'
  },
  plugins: [
    svelte({
      // Use `hot: true` to use default options (as follow).
      //
      // Set `hot: false` to completely disable HMR shenanigans (you need this
      // for `npm run build`, for example).
      //
      hot: hot && {
        // Prevent preserving local component state
        noPreserveState: false,

        // If this string appears anywhere in your component's code, then local
        // state won't be preserved, even when noPreserveState is false
        noPreserveStateKey: '@!hmr',

        // Prevent doing a full reload on next HMR update after fatal error
        noReload: false,

        // Try to recover after runtime errors in component init
        optimistic: false

        // Set true to enable support for Nollup (note: when not specified, this
        // is automatically detected based on the NOLLUP env variable)
        nollup: false,
      },

      // `dev: true` is required with HMR
      dev: hot,

      // Separate CSS file is not supported during HMR (neither with Nollup
      // nor rollup-plugin-hot), so we just disable it when `hot` is true.
      ...(!hot && {
        css: css => {
          css.write('public/bundle.css')
        },
      }),

      // See official rollup-plugin-svelte docs for all available options:
      //
      //   https://github.com/rollup/rollup-plugin-svelte
      //
      ...
    })
  ]
}
```
