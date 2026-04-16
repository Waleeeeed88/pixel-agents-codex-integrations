# Releasing CodexEconPixel

This fork packages the VS Code extension as `waleeeeed88.codexeconpixel`.

## Local release check

Run the same core release steps locally before you tag anything:

```sh
npm run setup
npm run release:check
npm run package:vsix
```

That produces:

```text
dist-vsix/codexeconpixel.vsix
```

## GitHub release flow

The publish workflow runs on `release.published`.

What it does:

1. Installs root, webview, and server dependencies.
2. Runs `npm run release:check`.
3. Builds `dist-vsix/codexeconpixel.vsix`.
4. Uploads the VSIX as both a workflow artifact and a GitHub release asset.
5. Publishes to VS Code Marketplace and Open VSX when the required secrets are present.

## Required repository secrets

- `VSCE_PAT`: Visual Studio Marketplace publisher token
- `OPEN_VSX_TOKEN`: Open VSX access token

Without those secrets, the workflow still packages the VSIX and attaches it to the GitHub release, but it skips marketplace publishing.

## Suggested release steps

1. Update `CHANGELOG.md`.
2. Run `npm run release:check`.
3. Run `npm run package:vsix`.
4. Create and push a version tag.
5. Publish a GitHub release for that tag.
6. Confirm the workflow uploaded the VSIX asset.
7. Confirm both marketplace publishes if the secrets are configured.
