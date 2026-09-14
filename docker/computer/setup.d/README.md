# Per-user setup scripts

Put executable shell scripts ending in `.sh` in `/home/worker/setup.d` to install tools that
live under `$HOME`. Both that directory and the image-maintained
`/etc/superworkers/setup.d` run once, as `worker`, whenever the container starts.

Scripts must be safe to run again. Prefer installers with an explicit user destination,
for example `python3 -m pip install --user`, an npm prefix under `$HOME/.local`, or a release
archive unpacked below `$HOME/.local`. Add `$HOME/.local/bin` to your shell setup when an
installer needs it.

These scripts cannot install system packages. Add required apt packages to the Dockerfile
and rebuild the image because the container root filesystem is replaceable.
