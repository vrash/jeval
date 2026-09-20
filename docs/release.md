# Release

Nothing has been published yet. Package names and the domain are provisional.

## Before the first publish

1. **Names.** On 2026-09-19 the unscoped npm name `jeval` was taken by an unrelated project (a stdin JavaScript evaluator), and the GitHub user `jeval` exists. `@jeval/core`, `@jeval/provider-jev` and `@jeval/cli` return 404 on the registry, but publishing under the `@jeval` scope requires owning that npm scope, which was not verified. Decide the scope (create the npm org or choose another, e.g. `@jeval-dev/*`) and update every `package.json`, the README, the site's `PACKAGES` constant and the docs together.
2. **Source publication.** Make the repository public, then set `NEXT_PUBLIC_REPO_URL` so the site shows GitHub links. Until then the site deliberately shows no repository link.
3. **Maintainer identity.** `LICENSE` names "vrash and Jeval contributors" from the local git config. Update if the project moves to an organisation.
4. **Verify from tarballs.** `pnpm verify:packed` packs the three packages, installs them into a fresh npm project and runs the CLI and both module formats.
5. **Live smoke test.** Done 2026-09-19 through Vercel AI Gateway (model id `typesafe-ai/jev`, 620 input tokens, 1.17 s). Repeat against the direct TypeSafe API once a key exists so a versioned `jev-1.x` id is on record.
6. **Recorded benchmark.** Done 2026-09-19: `examples/benchmark.live.md`. Re-record after any rubric or threshold change.

## Publishing

```bash
pnpm check && pnpm verify:packed
pnpm -r --filter './packages/*' exec npm version 0.1.0     # or changesets, once adopted
pnpm -r --filter './packages/*' publish --access public --dry-run
pnpm -r --filter './packages/*' publish --access public
git tag v0.1.0 && git push --tags
```

`files` in each package.json restricts tarballs to `dist` and `README.md`; `.gitignore` keeps runs, reports, `.env` files and build output out of the repository.

## Launch checklist

- [ ] npm scope owned; package names final; `npm view` confirms no collisions.
- [ ] Repository public; `NEXT_PUBLIC_REPO_URL` set; README clone URL filled in.
- [x] One live Jev smoke test recorded (2026-09-19, gateway; direct-API run still to do).
- [ ] Supabase migration applied; test signup persisted and deleted with the admin script.
- [ ] Production `NEXT_PUBLIC_SITE_URL` set to the real domain; robots and sitemap verified on the live URL.
- [ ] Vercel spend limit set; live demo left disabled unless a key and ceiling are configured.
