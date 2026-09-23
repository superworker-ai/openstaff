# Onboarding

The first steps for anyone new to the repository, human or coding agent. Both end with the
same brief.

## Why a checklist

A new contributor, human or agent, makes the same first mistakes: changing behaviour that the
architecture doc forbids, guessing at configuration instead of reading `doctor`, and stepping
on another session's uncommitted work. The checklist front-loads the reading and the checks so
the first change is made with the same context a maintainer has.

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

## Coding agents

Point the agent at this page before its first change. When a document moves or a command
changes, update this page in the same change so that a mismatch between it and the code is a
reviewable diff.
