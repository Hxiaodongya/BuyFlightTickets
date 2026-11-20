# Manual Verification Pause Implementation Plan

> **For agentic workers:** Execute this plan inline, task by task. Use the test-first steps and keep each change independently verifiable.

**Goal:** Pause a collection when an airline page requires human verification, retain and foreground that tab, then resume the same run after the user finishes verification.

**Architecture:** The result-page content script reports a distinct manual-verification pause response. The background collector persists the paused run and tab ID, then resumes pending work through the same tab on an explicit user command. Popup and dashboard expose the paused state and a continue action.

**Tech Stack:** Chrome Manifest V3, JavaScript modules, Vue 3, Node.js built-in test runner.

**Spec:** Approved interaction in chat on 2026-11-19: keep the verification page open; after the user solves it, they click “继续采集”.

## Global Constraints

- Never solve or bypass airline verification automatically.
- Do not persist fares from a verification page.
- Keep completed tasks and observations when pausing the remaining run.
- Preserve the existing user's uncommitted baseline in the source checkout.

---

### Task 1: Report Manual Verification Separately

**Files:**
- Modify: `src/collectors/result-page.js`
- Test: `tests/airline-adapters.test.js`

**Interface:** A verification page returns `{ type: "COLLECTION_PAUSED", reason: "human-verification" }`; a normal result keeps the existing `COLLECTION_RESULT` contract.

- [x] Change the verification regression test to assert the pause response and absence of fare rows.
- [x] Run `node --test --test-name-pattern='human verification' tests/airline-adapters.test.js`; confirm it fails because the current response is an error.
- [x] Return a distinct pause response only for the existing human-verification detector.
- [x] Re-run the targeted test and confirm it passes.

### Task 2: Persist and Resume the Current Task

**Files:**
- Modify: `src/background/collector.js`
- Test: `tests/collector.test.js`

**Interface:** `resumeRun(runId, taskIndex)` checks the browser-session checkpoint, reuses the retained `tabId`, and resumes the remaining pending tasks. `openVerificationTab(runId, taskIndex)` focuses that tab; `skipVerificationTask(runId, taskIndex)` skips only the paused task. The paused run has `status: "paused"`; its active task has `status: "awaiting-manual"`.

- [x] Add a regression test where collection pauses, a new collector instance resumes it, the same tab is reused, and remaining tasks finish.
- [x] Run the targeted collector tests and observe the initial failure: verification counts as a failed job rather than a pause.
- [x] Retain and activate the tab on pause; persist its ID only in browser-session storage; release the in-memory active-run lock after saving the paused state.
- [x] Continue on the same tab, keep waiting if its result page is not ready, and allow skipping the paused task.
- [x] Re-run targeted collector tests, including existing sequential-run and timeout tests.

### Task 3: Expose Continue Controls and Verify the Extension

**Files:**
- Modify: `src/background/service-worker.js`
- Modify: `src/background/scheduler.js`
- Modify: `src/popup/App.vue`
- Modify: `src/dashboard/App.vue`
- Create: `src/shared/VerificationPanel.vue`
- Modify: `README.md`
- Test: `tests/scheduler.test.js`

- [x] Add scheduler/status tests for paused runs and confirm the existing implementation reports the wrong status.
- [x] Restore pauses only within the original Chrome session, route the three explicit actions, and reuse a single verification panel in popup and dashboard.
- [x] Document the manual verification workflow and its safety boundary.
- [x] Run `npm test`, `npm run verify`, and `git diff --check`; verify and sync the output to the already-loaded directory.
