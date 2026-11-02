---
description: One iteration of the VIC/JAF sandbox split (pick the next ready task from VIC_SANDBOX_SPLIT_PLAN.md, implement, verify, Fable review, update the ledger, mirror the plan, commit). Run with /loop /split-next.
---

You are executing exactly ONE task of the plan in `VIC_SANDBOX_SPLIT_PLAN.md` at the repo root. Read that file
fully before doing anything. Sections 0 to 3 are the rules; section 4 is the ledger; section 5 has the task specs.

## 0. Orientation

- `TOP=$(git rev-parse --show-toplevel)`; `THIS_REPO=$(basename "$TOP")`, which must be `jaf` or `agentic-commerce`.
- `SIBLING` is the other one, located at `$TOP/../<sibling-name>`. `PLAN=VIC_SANDBOX_SPLIT_PLAN.md`.
- Tasks whose `Repo` column equals `THIS_REPO` are yours. Infra tasks (`I*`) belong to `agentic-commerce`.

## 1. Preconditions (stop the loop if any fails; say which one)

1. Current branch is `feat/vic-sandbox-split`.
2. `git status --porcelain` shows no modified tracked files other than `$PLAN` (untracked files are fine; never touch them).
3. `diff "$TOP/$PLAN" "$TOP/../$SIBLING/$PLAN"` is empty. If not: print the diff, set nothing, stop the loop and ask a human.
   Never merge the two copies yourself.
4. If `THIS_REPO=agentic-commerce` and any `J*` task is `done` since the last iteration, run `pnpm build` in `../jaf` first
   (the library is linked locally, see plan section 3.4).

## 2. Pick a task

- If a task for this repo is `in_progress` or `review`, resume it at the matching step below.
- Otherwise pick the first ledger row (top to bottom) with `Repo == THIS_REPO`, `Status == todo`, and every ID in
  `Depends on` equal to `done`.
- If none: if some `todo` task for the sibling repo is ready, report "next ready task is <ID> in <sibling>; run /loop /split-next there"
  and stop the loop with `ScheduleWakeup({ stop: true })`. If every row is `done`, report that the plan is complete and stop the loop.
  If rows remain but all are `blocked`, list them and stop the loop.

## 3. Start

Set the task's Status to `in_progress` in `$PLAN`, mirror (step 7), and commit in both repos:
`plan: <ID> in_progress` here and `plan: <ID> in_progress (mirror)` in the sibling.

## 4. Implement

Follow the task spec in section 5 literally: the listed files, the exact signatures, the acceptance criteria. Do not widen
scope, do not refactor neighbours, do not rename tools or change prompt text. Follow JAF conventions: readonly data,
pure functions, effects only in providers and servers. If the spec is impossible, contradictory or depends on a decision
in section 6 that the default does not cover, write the question into the task's Notes, set Status `blocked`, mirror,
commit, and stop the loop.

## 5. Verify

Run the task's Verify commands. Every command must pass. A pre-existing failing test is acceptable only if it fails
identically on the base branch; prove it by checking the base in a `git worktree`, and record it in Notes.

## 6. Review by Fable 5.1

Set Status to `review` (no commit needed yet). Spawn the reviewer exactly as plan section 3.5 describes:
`Agent({ subagent_type: "general-purpose", model: "fable", description: "Review <ID>", prompt: <filled template> })`
with `<base-sha>` = the commit before this task's first change (use `git log` to find the `plan: <ID> in_progress` commit).
Wait for the result. Fix every `blocking` finding, re-run step 5, re-review. Maximum 3 rounds. After 3 rounds without
`VERDICT: APPROVE`, set `blocked` with the open findings in Notes, mirror, commit, stop the loop.

## 7. Record, mirror, commit

1. In `$PLAN`: Status `done`; Notes `commit <short sha>, review: <n> rounds, APPROVE` plus anything the spec asked to record.
2. Commit here: `<ID>: <one-line summary>` (code + plan in the same commit). Message ends with the attribution line this
   session uses for commits, if any.
3. `cp "$TOP/$PLAN" "$TOP/../$SIBLING/$PLAN"`, then in the sibling: `git -C "$TOP/../$SIBLING" add $PLAN && git -C ... commit -m "plan: <ID> done (mirror)"`.
   The sibling must also be on `feat/vic-sandbox-split`; if it is not, stop and say so.
4. Re-run the diff from precondition 3; it must be empty.
5. Never `git push`, never rebase, never amend a commit from a previous iteration.

## 8. Report and continue

Print three lines: task done, review rounds, next ready task (and in which repo). Then schedule the next iteration with
`ScheduleWakeup` (short delay, `noop: false`), or stop the loop when step 2 says there is nothing left for this repo.
