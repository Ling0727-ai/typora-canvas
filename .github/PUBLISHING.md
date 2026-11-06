# Publishing Typora Canvas

The source repository is private-to-npm (`private: true`) deliberately. Publish
the prebuilt distribution tarball, not the source checkout. The distribution
package is `@ling0727-ai/typora-canvas`; its CLI is `typora-canvas`.

## One-time npm setup

The npm package must exist before adding a trusted publisher. Log in as its owner,
complete npm's interactive account verification, and configure:

```bash
npm trust github @ling0727-ai/typora-canvas --repo Ling0727-ai/typora-canvas --file release.yml --allow-publish
npm trust list @ling0727-ai/typora-canvas
```

No GitHub environment is configured, so leave the npm trust environment empty.
The workflow filename is `release.yml`, not its full repository path. See the
[npm trust reference](https://docs.npmjs.com/cli/v11/commands/npm-trust/).

After confirming the binding, enable the repository variable:

```bash
gh variable set NPM_TRUSTED_PUBLISHING --body true --repo Ling0727-ai/typora-canvas
```

Until this variable is `true`, npm publication is skipped and GitHub Releases
continue working. There is no `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret to configure.
The npm job uses a GitHub-hosted runner, Node.js 24, npm 11.20.0, and
`id-token: write` for OIDC. It publishes with provenance.

## Release a version

1. Update the version, both READMEs, and `RELEASE_NOTES.md`.
2. Run `npm test`, `npm run build`, `npm run package`, and `npm run test:package`.
3. Commit and push. Create and push a matching version tag, for example `v0.6.12`.

`release.yml` calls the three-platform validation workflow. Only after all tests,
builds, package installation checks and Chromium regressions pass does it create
the GitHub Release. The npm job downloads the same validated Linux release
artifact, verifies `SHA256SUMS.txt`, and publishes its `.tgz` with the `latest` tag.
It does not compile or repack another artifact during publication.

An existing package version is skipped without modifying its contents or
dist-tags, so rerunning an older workflow cannot move `latest` backwards. A
registry/network error other than 404 stops publication rather than being treated
as an unpublished version. Failed npm jobs can be retried after fixing trust
configuration; published npm versions cannot be replaced.

## Manual fallback

After building and packaging, run:

```bash
npm run publish:registry -- --dry-run
npm run publish:registry
```

Local publishing uses your npm login and may require interactive 2FA. Never send
credentials or one-time passwords through issues or chat. Installing the published
package does not require an npm account:

```bash
npm install -g @ling0727-ai/typora-canvas@latest
typora-canvas --version
typora-canvas --mode canvas-editor --dry-run
```
