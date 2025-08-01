# Publishing FAF to npm

This guide is for maintainers who need to publish new versions of FAF to npm.

## Prerequisites

1. You must have npm publish access to the `@xynehq` organization
2. You need to be authenticated to npm: `npm login`
3. Set up the NPM_TOKEN secret in GitHub repository settings

## Publishing Process

### Option 1: Using GitHub Release (Recommended)

1. Create a new release on GitHub:
   - Go to https://github.com/xynehq/faf/releases
   - Click "Create a new release"
   - Create a new tag (e.g., `v0.1.0`)
   - Fill in release notes
   - Publish the release

2. The GitHub Action will automatically:
   - Run tests
   - Build the package
   - Publish to npm

### Option 2: Manual Publishing

1. Update the version in `package.json`:
   ```bash
   npm version patch  # for bug fixes (0.1.0 -> 0.1.1)
   npm version minor  # for new features (0.1.0 -> 0.2.0)
   npm version major  # for breaking changes (0.1.0 -> 1.0.0)
   ```

2. This will automatically:
   - Update version in package.json
   - Run tests and build
   - Create a git commit and tag
   - Push to GitHub

3. Publish to npm:
   ```bash
   npm publish --access public
   ```

### Option 3: Using GitHub Actions Workflow

1. Go to Actions tab in GitHub
2. Select "Publish to npm" workflow
3. Click "Run workflow"
4. Enter the version number
5. Click "Run workflow"

## Version Guidelines

- **Patch** (0.1.0 → 0.1.1): Bug fixes, documentation updates
- **Minor** (0.1.0 → 0.2.0): New features, non-breaking changes
- **Major** (0.1.0 → 1.0.0): Breaking changes

## Pre-publish Checklist

- [ ] All tests pass: `npm test`
- [ ] Linting passes: `npm run lint`
- [ ] Build succeeds: `npm run build`
- [ ] Update CHANGELOG.md with release notes
- [ ] Update documentation if needed
- [ ] Review the files that will be published: `npm pack --dry-run`

## Post-publish Steps

1. Verify the package on npm: https://www.npmjs.com/package/@xynehq/faf
2. Test installation: `npm install @xynehq/faf@latest`
3. Update documentation site if needed
4. Announce the release (if major version)

## Troubleshooting

### Authentication Issues
```bash
npm login
npm whoami  # Should show your npm username
```

### Check what files will be published
```bash
npm pack --dry-run
```

### Test locally before publishing
```bash
npm pack
npm install ./xynehq-faf-0.1.0.tgz  # Use actual filename
```

## Important Notes

- The package is scoped under `@xynehq` organization
- Always use `--access public` when publishing
- The `prepublishOnly` script ensures tests pass before publishing
- The `files` field in package.json controls what gets published