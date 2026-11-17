# Changesets

Describe each user-facing change in a changeset: run `npm run changeset`, pick the bump
(patch, minor or major) and write a line for the changelog. Commit the generated file with your PR.

To release, run `npx changeset version` in a PR: it bumps `package.json` and writes `CHANGELOG.md`.
Merging that PR to `main` publishes the new version (see `.github/workflows/publish.yml`).
