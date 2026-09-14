# Onboarding

This page is the human version of the `self-onboarding` skill in
`.claude/skills/self-onboarding/SKILL.md`. Coding agents opened in this repository run that
skill first; contributors follow the same steps by hand. Both end with the same brief.

## Why a skill

A new contributor, human or agent, makes the same first mistakes: changing behaviour that the
architecture doc forbids, guessing at configuration instead of reading `doctor`, and stepping
on another session's uncommitted work. The skill front-loads the reading and the checks so the
first change is made with the same context a maintainer has.

## The steps

1. **Read** `README.md`, then `docs/ARCHITECTURE.md` (the design of record), `docs/PLAN.md`,
   and `CONTRIBUTING.md`. Read the storage, Computer, and deployment docs only when the task
   touches them.
2. **Verify the toolchain**: Node 22, pnpm via Corepack, Docker if you need the Docker
   Computer or image builds. Check `git status` before touching anything.
3. **Configure**: copy `.env.example` to `.env`, `pnpm install`, `pnpm run doctor`. The doctor
   output is the source of truth for what is configured.
4. **Run the checks**: `pnpm typecheck`, `pnpm lint`, `pnpm test`. Know the baseline before
   your first change.
5. **Map the area** you will change and its tests.
6. **Write a brief**: product and phase, commands that passed or failed, what is configured,
   files you expect to touch, anything that looks wrong.

## Using the skill

In Claude Code, type `/self-onboarding` in this repository. Other agents that read
`SKILL.md` files (Cursor, Codex with skills enabled) pick it up from the same path. The skill
is intentionally short; the depth lives in the docs it points to.

## Keeping it current

When a document moves or a command changes, update the skill and this page in the same
change. The skill is part of the repository so that it ships with every clone and every
deployment, and so that a mismatch between it and the code is a reviewable diff.
