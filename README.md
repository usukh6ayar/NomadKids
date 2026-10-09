# NomadKids — v2

Kindergarten child-development digital portfolio system.
Next.js · NestJS · Prisma · PostgreSQL · MinIO (S3-compatible).

**Live since 2026-09-10** on one Datacom VPS (`202.131.1.111`): web
`https://nomadkids.mn`, API `https://api.nomadkids.mn`, media
`https://media.nomadkids.mn`, all behind Caddy. Cloudflare is DNS only.

Teachers record observations and developmental assessments; parents see their
own child's portfolio, progress and photographs; administrators manage
kindergartens, groups, staff and configuration. Scope runs through RFP Phase III
plus the finance module, chat and the ESIS integration — [`CLAUDE.md`](CLAUDE.md)
§7 is the authority.

**Read [`CLAUDE.md`](CLAUDE.md) before writing code.** Its rules are mandatory.

## Quick start

```bash
pnpm install
cp .env.example .env                              # then fill in the secrets
pnpm --filter @kinder/contracts build
pnpm --filter @kinder/api prisma:generate
pnpm --filter @kinder/api prisma:deploy           # apply migrations
pnpm --filter @kinder/api seed                    # system configuration
pnpm --filter @kinder/api test:db:setup           # ★ the tests' own database
pnpm dev                                          # web :3000 · api :3001
```

`pnpm verify` runs typecheck, lint and tests. CI also runs `pnpm format:check`.

★ `test:db:setup` is not optional: the integration suite `TRUNCATE`s every table
between cases, and without `TEST_DATABASE_URL` it does that to `DATABASE_URL`.

## Layout

```
apps/web/           Next.js App Router — three shells: (teacher) (parent) (admin)
apps/api/           NestJS + Prisma — controller → service → repository → authz
packages/contracts/ shared Zod schemas and types, built before either app
scripts/            VPS backup, preflight and ESIS probe scripts
```

## Language

Documentation, code, comments, identifiers and commit messages: **English**.
All user-facing UI text: **Mongolian**.
