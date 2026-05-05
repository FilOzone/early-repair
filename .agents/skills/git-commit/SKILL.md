---
name: git-commit
description: Generate and run well-formatted Git commits using Conventional Commits. Use when the user asks to commit changes, stage and commit work, write a commit message, or says phrases like "commit this" or "save my changes".
---

# Git Commit

Use this skill to inspect Git changes, choose an appropriate Conventional
Commit message, and create the commit when the user has asked for one.

## Workflow

1. Run `git status --short` to see staged, unstaged, and untracked files.
2. If the user asked to stage changes, stage only the files implied by the
   request. If the request is broad, use the whole worktree, but do not revert
   or discard unrelated changes.
3. Inspect the staged change with `git diff --staged --stat` and
   `git diff --staged`.
4. If nothing is staged and the user did not ask you to stage files, tell the
   user what is unstaged and ask what to stage.
5. Generate a Conventional Commit message from the intent of the staged change.
6. If the user asked to commit, run `git commit` with the generated message. If
   the user only asked for a message, provide the message without committing.

## Commit Message Format

Follow Conventional Commits:

```text
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

## Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation-only changes
- `style`: Changes that do not affect behavior, such as formatting
- `refactor`: Code changes that neither fix a bug nor add a feature
- `perf`: Performance improvements
- `test`: Adding or correcting tests
- `build`: Build system or dependency changes
- `ci`: CI configuration or script changes
- `chore`: Maintenance that does not modify source or test behavior

Choose the type by the intent of the change:

- Config change enabling a feature: `feat`
- Dependency update fixing a vulnerability: `fix`
- Comment typo in code: `style`
- Variable rename for clarity: `refactor`

## Scope

Use a short noun for the affected area, such as `auth`, `api`, `cli`, or
`parser`. Omit the scope when the change is broad or no single area fits.

## Subject Rules

- Use imperative mood, such as "add" instead of "added" or "adds".
- Do not capitalize the first word after the type prefix.
- Do not end with a period.
- Keep the subject concise. Aim for 50 characters or less after the prefix.

## Body Rules

- Explain what changed and why, not how.
- Wrap body lines near 72 characters.
- Use a body only when the subject alone is not enough.

## Footer Rules

- Reference issues when applicable: `Fixes #123` or `Closes #456`.
- Use `BREAKING CHANGE: ...` for breaking changes and include migration
  guidance.

## Commit Execution

Use multiple `-m` flags so Git preserves paragraphs:

```bash
git commit -m "type(scope): subject line" -m "Body paragraph." -m "Footer."
```

Omit body or footer flags when they are not needed. After committing, report the
created commit hash and subject from `git log -1 --oneline`.

## Examples

```text
feat(auth): add JWT token refresh on expiry
```

```text
fix(api): handle null response from upstream service

The payments API occasionally returns null instead of an error
object when the service is degraded. This caused unhandled
exceptions in the response parser.

Fixes #342
```

```text
feat(config): switch from YAML to TOML for config files

TOML provides better type safety and clearer syntax for nested
configuration values.

BREAKING CHANGE: config files must be migrated from .yaml to .toml
format. Run `migrate-config` to convert automatically.
```

```text
chore: update gitignore for new build artifacts
```
