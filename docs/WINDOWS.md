# Windows launcher — alpha.5

[Türkçe](WINDOWS.tr.md) · [Beta reports](BETA.md) · [Model licenses](../THIRD_PARTY_NOTICES.md)

Download `voicebridge-0.1.0-alpha.5-windows-x64.zip` and `SHA256SUMS.txt` from the matching GitHub release. Compare the SHA-256, then fully extract the ZIP to a **private, writable local folder**. Run `VoiceBridge.exe`. Do not run it from inside the ZIP. The package is unsigned; no publisher identity is established by a Windows signature. Decide whether you trust the source and release before running it.

The x64 launcher uses Windows' .NET Framework 4.8 and the bundled Node 24 runtime. No Node/Python installation, administrator rights, registry changes, system PATH changes or SDK are required. The tested Windows versions and actual verification scope are listed in [validation](VALIDATION.md); an automated runner is not an independent human installation.

## First setup

1. The launcher opens a **private local setup page**. No model download starts until you approve downloads and choose **Prepare setup**.
2. Allow approximately 3 GB installed space and **6 GB free** during first preparation, plus internet access. The launcher downloads a pinned Astral standalone Python 3.12 distribution, creates a private virtual environment, installs the pinned speech dependencies from PyPI and downloads the separately licensed models. The bundled Node license and dependency licenses remain in the package; the Python archive retains its licenses.
3. **Pause** keeps verified files and partial runtime/model downloads. Open the launcher again and choose **Check and resume**. HTTP Range is used when the source supports it; a source that ignores Range restarts that file. Every completed download must match its pinned size and SHA-256. An incomplete or corrupt file is never executed as a runtime or loaded as a verified model.
4. When ready, choose **Start VoiceBridge**, then **Open Discord settings**. Configure a dedicated Discord bot and OAuth application in the existing local operator panel. You supply the credentials; the launcher does not create accounts, connect the bot or activate paid cloud processing.
5. Continue with the [beta guide](BETA.md). The recorded demo, automated installation and two-human live acceptance are separate evidence.

The default Discord OAuth callback remains `http://127.0.0.1:4347/auth/callback` across restarts. If port 4347 or worker port 4351 is occupied, the launcher reports a conflict rather than stopping another process or silently changing the callback.

## Files and closing

Keep the extracted folder in place while running. `data/` contains models and the private application configuration/database. `.installer/` contains download caches and a private local access link. Never upload either directory, the operator link or a runtime virtual environment to an issue. **Close launcher** pauses preparation and stops only the app/worker it started. Closing only the browser tab leaves the local launcher running so you can reopen it.

Do not overlay an old working installation with a new ZIP. Extract a new version into another folder; stop the old one first. Back up private data before any manual migration. An automatic migration/import of an older source installation is outside this release. No existing source install or models elsewhere on the computer are modified or automatically copied.

Repair/resume rechecks immutable package files and installed modules. Modified package files require re-extracting a verified release; the installer does not download arbitrary replacement code. If an invalid managed Python runtime is replaced, its previous directory is kept under `.installer/previous-python-*` for inspection. Keep the folder writable; cloud placeholders/junctions in program paths are not supported.

## Remote listeners / advanced ports

The local panel and worker bind to loopback. Remote guests need your reachable **HTTPS** reverse proxy, configured as described in [setup](SETUP.md#remote-listeners). While VoiceBridge is stopped, create `.installer/options.json` in the extracted package if needed:

```json
{"port":4347,"workerPort":4351,"publicUrl":"https://voice.example.com"}
```

Use your actual HTTPS origin and configure its exact `/auth/callback` in Discord. Keep panel and worker ports distinct. `publicUrl` is optional for local use. This file accepts only these settings; no executable or download-source overrides are supported. Never publish private configuration or the launcher access token.

## Build and verify from source

On Windows x64 with Node 24.17+ and Python 3.12: run `npm ci --ignore-scripts`, `npm run check`, `python scripts/package_source.py`, then `npm run package:windows`. The matching source ZIP is hashed into `BUILD.json`. Run `npm run test:launcher` for the synthetic UI and `npm run test:windows -- --full` for a fresh extracted native package with actual runtime/model installation. The latter uses disk/network and can take several minutes; it does not connect Discord or exercise human speech. Keep the source ZIP, Windows ZIP and their SHA-256 file together when distributing.
