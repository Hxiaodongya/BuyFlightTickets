# Flight Price Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-only Chrome extension that records daily airline-list displayed fares and charts observations by capture date, route, travel date, airline, and flight.

**Architecture:** Use a Manifest V3 service worker for alarms, run coordination, and tab lifecycle. Use static airline content scripts to collect displayed fare rows, `chrome.storage.local` for plans and observations, and a dashboard page for editing, filtering, and an accessible SVG chart.

**Tech Stack:** Chrome Manifest V3, plain JavaScript modules, HTML/CSS/SVG, Node.js built-in `node:test`; no runtime or test dependencies.

**Spec:** `docs/superpowers/specs/2026-11-18-flight-price-tracker-design.md`

## Global Constraints

- Collect only Air China (CA/中国国际航空) and China Southern Airlines (CZ/中国南方航空) in v1.
- Record the displayed list fare before taxes/fees; label it “列表价（未含税费）” and never call it the payable total.
- Store records locally; do not add a server, account, remote code, login automation, order submission, or CAPTCHA/access-control bypass.
- Support multiple one-way plans and travel dates; default one adult, economy, and local 09:00 collection time.
- Collect direct and connecting results; apply direct/transfer and airline/flight filters locally after collection without re-querying.
- Scheduled and manual runs share one queue and cannot overlap; manual run is available from the popup.
- Chrome or computer sleep can delay or miss scheduled collection; show missing/partial status and allow manual collection after Chrome resumes.
- Do not launch Playwright. Validate extension behavior with unit tests and the user-operated Chrome “Load unpacked” flow.

---

## File Map

- `manifest.json`: MV3 permissions, popup, service worker, and narrowly scoped airline host matches.
- `package.json`: dependency-free Node test and verification scripts.
- `src/shared/domain.js`: plan validation, defaults, observation normalization, and stable series identity.
- `src/shared/storage.js`: promise-based local persistence for plans, runs, and observations.
- `src/shared/chart-model.js`: local filters and line-series construction.
- `src/collectors/price-parser.js`: dependency-free fare-text parser exposed to classic content scripts.
- `src/background/scheduler.js`: local-time daily alarm calculations and missed-run status.
- `src/background/collector.js`: serialized collection queue, inactive tabs, timeout, result messages, and cleanup.
- `src/background/service-worker.js`: Chrome event registration and popup/dashboard message routing.
- `src/collectors/airchina.js`: Air China search URL and result-list content adapter.
- `src/collectors/csair.js`: China Southern public search-form and result-list content adapter.
- `src/popup/index.html`, `src/popup/popup.js`, `src/popup/popup.css`: compact run status, “立即采集”, and dashboard navigation.
- `src/dashboard/index.html`, `src/dashboard/dashboard.js`, `src/dashboard/dashboard.css`: plan form, history filters, chart, and run details.
- `tests/domain.test.js`, `tests/storage.test.js`, `tests/chart-model.test.js`, `tests/scheduler.test.js`, `tests/collector.test.js`, `tests/airline-adapters.test.js`: Node unit tests.
- `scripts/verify-extension.mjs`: manifest/resource validation and JavaScript syntax checks.

### Task 1: Domain Contracts and Test Harness

**Files:** Create `package.json`, `src/shared/domain.js`, `tests/domain.test.js`.

**Interfaces:** `validatePlan(plan)` returns a field-error object; `normalizePlan(input)` returns a persisted plan with defaults; `normalizeObservations(plan, airlineCode, rows, capturedAt)` returns observations with a `listedFareCny` and no inferred taxes; `getSeriesKey(observation)` returns `planId|travelDate|airlineCode|flightNo|cabin|fareProduct`, using `unknown` when fare product is unavailable.

- [x] **Step 1: Create a minimal `package.json` and write the domain tests first.** Set `"type": "module"` and `"test": "node --test"`. Cover missing airport codes, invalid/empty travel dates, no airline selected, defaults, and the series key. Example:

```js
test("normalizes the example plan with one adult and economy defaults", () => {
  const plan = normalizePlan({
    originCode: "HGH",
    destinationCode: "CGQ",
    travelDates: ["2027-02-04", "2027-02-05"],
    airlineCodes: ["CA", "CZ"],
  });
  assert.equal(plan.adultCount, 1);
  assert.equal(plan.cabin, "economy");
  assert.deepEqual(plan.travelDates, ["2027-02-04", "2027-02-05"]);
});
```

- [x] **Step 2: Confirm the test fails.** Run `npm test`; expect module-not-found because `src/shared/domain.js` does not exist yet.
- [x] **Step 3: Implement the minimum domain functions.** Keep validation pure; use `CA` and `CZ` as the only accepted airline codes, use `YYYY-MM-DD` for travel dates, and preserve the displayed fare as a number in CNY without adding fees.
- [x] **Step 4: Run `npm test`.** The new domain tests must pass.
- [x] **Step 5: Add invalid-price tests.** `normalizeObservations` must discard rows with non-finite or non-positive fares and must not create a record from a missing fare.
- [x] **Step 6: Run `npm test` again.** All domain tests must pass before adding persistence.

### Task 2: Local Persistence and Plan Lifecycle

**Files:** Create `src/shared/storage.js`, `tests/storage.test.js`; update `src/shared/domain.js` only if its tests reveal a contract gap.

**Interfaces:** `createStorage(storageArea)` returns `listPlans()`, `savePlan(plan)`, `deletePlan(planId)`, `listRuns()`, `saveRun(run)`, `listObservations(filters)`, and `saveObservations(observations)`. Each method uses the injected Chrome storage area so tests can use an in-memory implementation.

- [x] **Step 1: Write storage tests.** Verify plan upsert by ID, deletion of a plan and its associated observations, run ordering by `startedAt`, observation deduplication by observation ID, and preservation of earlier observations when a later run is partial.
- [x] **Step 2: Run `npm test`.** Expect import/API failures for `createStorage`.
- [x] **Step 3: Implement the injected storage wrapper.** Store records under stable prefixes (`plan:`, `run:`, `observation:`), avoid storing all history as one mutable array, and propagate Chrome storage errors to callers.
- [x] **Step 4: Run `npm test`.** The repository tests must pass using the in-memory storage stub.
- [x] **Step 5: Add a quota/error test.** When the storage area rejects `set`, the caller receives the error and the run is not marked complete.
- [x] **Step 6: Run `npm test` again.** Persistence tests must pass.

### Task 3: Chart Model and Local Filters

**Files:** Create `src/shared/chart-model.js`, `tests/chart-model.test.js`.

**Interfaces:** `filterObservations(observations, filters)` accepts `planId`, `travelDate`, `tripType` (`all`, `direct`, `transfer`), `filterMode` (`airline`, `flight`), and `selectedValues`; it returns only matching saved rows. `buildChartModel(observations)` returns sorted capture dates and series keyed by `getSeriesKey`.

- [x] **Step 1: Write tests for filter intersections.** Test direct-only (`stopCount === 0`), transfer-only (`stopCount > 0`), airline mode, flight mode, route/date intersection, and empty results.
- [x] **Step 2: Run `npm test`.** Expect missing exports from `src/shared/chart-model.js`.
- [x] **Step 3: Implement filters as pure array operations.** Do not call Chrome APIs, fetch, or collection code from this module.
- [x] **Step 4: Write tests for chart points.** Verify capture dates sort chronologically, multiple flights remain separate series, a missing day is absent (not zero), and fare values are used without tax additions.
- [x] **Step 5: Implement `buildChartModel`.** Each point contains the actual local capture date and `listedFareCny`; preserve gaps for absent observations.
- [x] **Step 6: Run `npm test`.** All filter and chart-model tests must pass.

### Task 4: Scheduler, Queue, and Tab Lifecycle

**Files:** Create `src/background/scheduler.js`, `src/background/collector.js`, `src/background/service-worker.js`, `tests/scheduler.test.js`, `tests/collector.test.js`.

**Interfaces:** `getNextDailyRun(now, hour, minute)` returns the next local scheduled timestamp; `createCollector({ tabsApi, storage, adapters, timeoutMs })` exposes `startRun(trigger)` and `getStatus()`. `startRun` returns a run result and rejects a second concurrent start with a typed `RUN_ALREADY_ACTIVE` error.

- [x] **Step 1: Write scheduler tests.** Cover before/after local schedule time, next-day rollover, and the 09:00 default.
- [x] **Step 2: Run `npm test`.** Expect missing `getNextDailyRun`.
- [x] **Step 3: Implement pure local-time scheduling.** Recreate one alarm per enabled plan on install/startup and schedule the next occurrence after each alarm; on startup compare the latest run date to today and expose `not-collected` or `partial` status.
- [x] **Step 4: Run scheduler tests.** All timestamp expectations must pass without waiting for real alarms.
- [x] **Step 5: Write collector tests with injected tab and adapter fakes.** Verify one inactive tab per airline-plan-date job, all plans run sequentially, result messages persist observations, timeout records an error, duplicate start is rejected, and every created tab is removed in `finally`.
- [x] **Step 6: Implement the queue.** Persist `running` before opening a tab; set terminal state to `complete`, `partial`, or `failed`; never convert an adapter error into a price observation.
- [x] **Step 7: Run `npm test`.** Scheduler and queue tests must pass.

### Task 5: Airline Content Adapters

**Files:** Create `src/collectors/airchina.js`, `src/collectors/csair.js`, extend `tests/airline-adapters.test.js`.

**Interfaces:** Each adapter handles `GET_COLLECTION_REQUEST` and responds with `{ type: "COLLECTION_RESULT", requestId, airlineCode, rows, error }`. Each row has `flightNo`, `listedFareCny`, `cabin`, `stopCount`, and optional departure/arrival times.

- [x] **Step 1: Write pure parser tests using sanitized row objects.** Cover Chinese yuan formatting, comma separators, direct flights, one-stop flights, missing fare, and missing flight number. Load `src/collectors/price-parser.js` into a Node `vm` context and assert its `FlightPriceParser` API; do not place synthetic fixtures in the production UI.
- [x] **Step 2: Run `npm test`.** Expect missing parser exports.
- [ ] **Step 3: Validate the official Air China result route.** Use `https://www.airchina.com.cn/flight/oneway/{origin-lower}-{destination-lower}/{travel-date}`; wait for actual result rows with a bounded `MutationObserver` timeout. If the public page does not produce rows, return an explicit adapter error.
- [ ] **Step 4: Validate the China Southern public search flow.** Start at `https://b2c.csair.com/B2CNew/flight/search`, fill the public one-way route/date form from the plan, submit once, and parse only the resulting visible fare list. Keep the adapter scoped to the observed official booking host.
- [x] **Step 5: Implement adapter-specific parsing.** Parse the displayed list fare only; store `listedFareCny`, never infer taxes or total payment. Detect login, CAPTCHA, blocked, empty, and unrecognized result states as errors and do not attempt bypasses.
- [x] **Step 6: Run `npm test`.** Parser fixtures must pass for both adapters.
- [ ] **Step 7: Manually validate one real route/date in Chrome for each carrier.** Confirm the visible fare equals the saved `listedFareCny`, and confirm the extension reports failure rather than fabricating data if either site blocks automated access.

### Task 6: Popup, Dashboard, and SVG Chart

**Files:** Create `src/popup/index.html`, `src/popup/popup.js`, `src/popup/popup.css`, `src/dashboard/index.html`, `src/dashboard/dashboard.js`, `src/dashboard/dashboard.css`.

**Interfaces:** Popup messages are `GET_STATUS` and `START_MANUAL_RUN`; dashboard uses `GET_PLANS`, `SAVE_PLAN`, `DELETE_PLAN`, `GET_OBSERVATIONS`, and `GET_RUNS`. The chart consumes `buildChartModel(filterObservations(...))`.

- [x] **Step 1: Create the MV3 manifest and empty popup/dashboard pages.** Include only `alarms` and `storage` permissions plus host matches for the two official booking domains; use a module service worker and static content scripts. The popup entry action is “立即采集”; the dashboard opens in a normal extension tab.
- [x] **Step 2: Add form behavior.** Provide route name/code inputs, multiple target dates, airline checkboxes (CA/CZ), adult count (default 1), cabin (economy default), and local collection time (09:00 default); prevent saving invalid plans.
- [x] **Step 3: Add popup states.** Render `今日尚未采集`, `采集中`, `采集完成`, `部分失败`, and `采集失败`; disable the trigger while a run is active and show last run time and result counts.
- [x] **Step 4: Add dashboard filters.** Provide route/date controls, a segmented direct/transfer control, and airline/flight filter mode. Changing a filter reuses saved observations and immediately redraws without starting a run.
- [x] **Step 5: Draw the chart.** Use accessible inline SVG with labeled axes, stable airline colors, one line per route/date/airline/flight/cabin, `listedFareCny` on the y-axis, actual capture date on the x-axis, visible gaps for missing samples, and a text/table summary for screen readers.
- [x] **Step 6: Add explicit fare copy.** Show “列表价（未含税费）” next to the chart and in each price detail; do not use “总价” or “最终支付价”.
- [ ] **Step 7: Manually exercise the UI.** Save, edit, disable, and delete the example plan; trigger a run; change each filter; confirm the chart changes without a new collection run.

### Task 7: Extension Verification and Handoff

**Files:** Create `scripts/verify-extension.mjs`; update `package.json` and `manifest.json` as needed.

- [x] **Step 1: Add `npm run verify`.** Parse `manifest.json`, verify every popup, service worker, icon-free action, and content-script path exists, and run `node --check` on all JavaScript files.
- [x] **Step 2: Run `npm test`.** Expected result: all Node tests pass.
- [x] **Step 3: Run `npm run verify`.** Expected result: manifest resource checks and JavaScript syntax checks pass.
- [ ] **Step 4: Load the project root as an unpacked extension in Chrome.** Verify popup and dashboard open, the manual control reports state, the daily alarm is recreated on restart, and no errors appear in extension service-worker logs.
- [ ] **Step 5: Verify real collection constraints.** Confirm one displayed fare per flight is stored as a list fare; if the airline page blocks or changes, the run shows a source-specific failure and the chart keeps prior observations.
