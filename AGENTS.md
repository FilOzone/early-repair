# Early Repair

Root package is the CLI. There is no workspace split.

## Commands

- Run CLI directly from TypeScript: `pnpm dev -- --help` or `node src/index.ts --help`
- Build: `pnpm run build`
- Lint: `pnpm run lint`
- Auto-fix lint/format issues: `pnpm run lint:fix`
- Full check: `pnpm run check`

## Tests

There is no test runner configured yet. Until tests are added, use `pnpm run check` as the verification command.

## Conventions

- Use pnpm.
- Keep source in `src/`.
- TypeScript should stay erasable so it can run directly with Node.
- Use ESM and explicit `.ts` extensions for local TypeScript imports.
- Follow Biome formatting: 2-space indentation, single quotes, no semicolons unless needed.
- Use kebab-case filenames.
