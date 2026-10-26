# frontend ui

This is the frontend ui based on [React 18](https://react.dev/), bundled with
[Vite](https://vitejs.dev/). It has no UI framework dependency: the dialogs,
dropdown and progress bar are small local components in `src/components`.

Building requires Node.js 20.19+ (or 22.12+), per Vite 7.

## Build Setup

``` bash
# install dependencies
npm install

# build the ui bundle into dist/
npm run build


# reinstall the python package from the repo root
cd ..
uv pip install -e .
# or, with plain pip:
# pip install -e .
```

For local development with hot reloading, run `npm run dev` and point it at a
running pdrive backend (see `vite.config.js` for the proxy configuration).
