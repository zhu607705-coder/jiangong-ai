# Coding-agent operating contract

## Mission
Read `agent/mission.md`, `docs/工程架构与AI执行计划_v2.md`, `agent/tasks.json`, and `agent/state.json` before changing code. Current request supersedes the earlier price-centered architecture.

## Reuse first
Before implementing a capability, find the exact existing package/function in the reuse manifest. Prefer importing it, then a wrapper, then a documented selective port. Keep upstream license/attribution/patch history. Do not add a parallel scheduler, context system, search client or parser merely to rename it. Do not port dangerous defaults such as cleartext credentials, unconstrained SQL or predetermined verdicts.

## Delegation
One lead coding agent owns the mission. Delegate only tasks with satisfied dependencies, named inputs, write scopes and test requirements. Contract changes have one owner; use separate branches/worktrees for independent modules. Business runtime agents must not inherit coding-agent shell/network/file permissions.

## Persistent context
After each completed node, record changed files, tests, unresolved questions, artifact references and the next runnable task in `agent/state.json`. Save decisions, not private reasoning traces. A resumed agent reloads the files. Do not rely on an unbounded chat context.

## Verification
Never equate fixture output with real analysis. Separate contract checks, live endpoint checks and decision-quality evaluation. Golden labels remain in the test harness, never model inputs. `skipped` is not `passed`; missing credentials produce `blocked_external`. Run the upstream baseline where feasible, then adapter tests, then end-to-end tests.

## Completion
Do not state a task is implemented without files and a reproducible test log. Do not claim enterprise effectiveness without actual permitted enterprise evaluation. Continue through the task DAG in one overarching mission; do not stop after producing a plan if the agent has been commissioned and equipped to implement it.

## Local tests already provided
`python fixtures/generate.py`
`python -m unittest discover -s tests -v`
These cover only a small RETQA selective port and fixture integrity, not the application.
