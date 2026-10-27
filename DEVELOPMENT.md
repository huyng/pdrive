# Building and publishing pdrive

Short version: build the UI, commit it, bump the version, `uv build`, `uv publish`.

## Build

pdrive ships a **pre-built** React bundle: `uv build` only copies what is in
`pdrive/frontend/dist`, it never runs npm. So whenever the UI changes, rebuild
and commit `dist/` first — that is the package data users get.

```bash
# 1. the UI (start of every release, and of every UI commit)
cd pdrive/frontend
npm install            # first time only
npm run build          # writes pdrive/frontend/dist
cd ../..

# 2. the Python artifact
uv build               # -> dist/pdrive-<version>-py3-none-any.whl and .tar.gz
```

The version lives in one place, `pyproject.toml` (`version = "..."`). PyPI
refuses to accept the same version twice, so bump it before every upload.

To try the result, install the package and run it — the Flask app serves
`frontend/dist` from the installed package:

```bash
uv venv /tmp/t && uv pip install --python /tmp/t/bin/python dist/pdrive-*.whl
/tmp/t/bin/pdrive -p 8124        # http://127.0.0.1:8124, then kill it
```

Check the wheel really contains the fresh UI (`frontend/dist/assets/…` hashes
change with every build) and the Python modules:

```bash
unzip -l dist/pdrive-*.whl
tar tzf dist/pdrive-*.tar.gz | head    # the sdist also keeps src/ and package.json
uvx twine check dist/*                 # README/metadata render check
```

`build/`, `dist/` and `pdrive.egg-info/` in the repository root are leftovers
from the old setuptools setup; they are gitignored, and clearing them before a
release avoids uploading something stale.

## Publish

Needs a PyPI API token (*Account settings → API tokens*), or a TestPyPI token
for a rehearsal.

```bash
export UV_PUBLISH_TOKEN=pypi-...

# optional rehearsal
uv publish --publish-url https://test.pypi.org/legacy/ --token pypi-test-token

# the real thing
uv publish

# tag what was published
git tag -a v0.8.5 -m "pdrive 0.8.5" && git push origin master --tags
```

`python -m twine upload dist/*` (user `__token__`) is the equivalent if twine is
already in your toolbelt.

## Release checklist

```bash
cd pdrive/frontend && npm run build && cd ../..
git add -A pdrive/frontend/dist pdrive/frontend/src && git commit -m "..."
# bump `version` in pyproject.toml, commit
rm -rf build dist && uv build
unzip -l dist/pdrive-*.whl && uvx twine check dist/*
uv venv /tmp/t && uv pip install --python /tmp/t/bin/python dist/pdrive-*.whl
/tmp/t/bin/pdrive -p 8124                       # spot-check the UI in a browser
uv publish
git tag -a vX.Y.Z -m "pdrive X.Y.Z" && git push origin master --tags
```
