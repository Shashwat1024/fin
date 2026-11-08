# Personal Finance Tracker

Private, local-first desktop finance tracker for personal use.

## Project workflow

This repository uses [GitHub Spec Kit](https://github.com/github/spec-kit) for specification-driven development. The workflow is:

1. `/speckit.constitution`
2. `/speckit.specify`
3. `/speckit.plan`
4. `/speckit.tasks`
5. `/speckit.implement`

The product requirements are in [docs/PRD.md](docs/PRD.md). Project principles are recorded in [.specify/memory/constitution.md](.specify/memory/constitution.md). The initial product specification is in [specs/001-personal-finance-tracker/spec.md](specs/001-personal-finance-tracker/spec.md).

## Privacy boundary

The initial product is single-user and local-only. It does not require an account, hosted backend, or bank credentials.
