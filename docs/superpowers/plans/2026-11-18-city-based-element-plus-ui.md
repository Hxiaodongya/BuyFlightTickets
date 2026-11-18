# 城市选择与 Element Plus 界面实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将航班查询计划改为全国国内航线城市选择与多日期配置，并以 Vue 3、Vite、Element Plus 实现可安装的 Chrome 扩展界面。

**Architecture:** 后台继续使用 Manifest V3 Service Worker、Chrome 本地存储和现有串行采集器。计划数据以城市 ID/名称为主，旧机场代码只用于一次性迁移；国航和南航适配器向其官方城市查询表单输入城市名，并在后台固定一位成人、经济舱。Vite 构建 popup 与 dashboard，Manifest、后台模块和经典 content scripts 复制到 `dist/`。

**Tech Stack:** Chrome Manifest V3、Vue 3、Element Plus、Vite、Node.js 内置 `node:test`；城市选项使用本地静态中国民航城市表。

**Spec:** `docs/superpowers/specs/2026-11-18-city-based-element-plus-ui-design.md`

## Global Constraints

- 只支持中国国内城市、国航（CA）和南航（CZ）。
- 出发地和到达地只显示城市名；机场名和三字码只允许留在内部兼容映射中。
- 计划字段不包括计划名称、成人数和舱位；采集固定一位成人、经济舱。
- 保存并展示航司列表显示的票面价，不含税费；不将其称为最终支付价。
- 调度、手动采集、直达/中转筛选和航司/航班筛选继续保留；本地筛选不触发网络采集。
- 查询页面拒绝、验证码、未识别表单或无明确票价时按失败记录，不尝试绕过。
- 扩展页面不从远程 CDN 加载脚本或样式；Chrome 加载目录为 `dist/`。
- 不启动 Playwright 或其浏览器进程；真实页面验证由东哥在 Chrome 中手动完成。

---

## File Map

- `src/shared/china-cities.json`: 静态国内航线城市数据，包含城市 ID、显示名、拼音及仅供旧数据迁移的机场代码；遵循原数据许可证并记录来源。
- `src/shared/cities.js`: `listCities()`、`getCityById(id)`、`findCityByAirportCode(code)` 城市查询 API。
- `src/shared/domain.js`: 新计划验证/归一化、城市级历史观察归一化、旧计划迁移。
- `src/shared/storage.js`: 读取旧计划时无损迁移；未知城市记录保留、停用并提示修复。
- `src/background/collector.js`: 将固定的 `adultCount: 1`、`cabin: "economy"` 仅放入单次采集请求，不回写计划。
- `src/background/service-worker.js`: 城市级杭州至长春示例计划和现有消息路由。
- `src/collectors/airline-config.js`: 构建国航/南航官方城市查询入口，并限制目标主机。
- `src/collectors/airchina.js`, `src/collectors/csair.js`: 从城市名填表、固定采集选项、读取已显示列表价。
- `manifest.json`: 增加国航官方城市查询所需的主机匹配和资源路径。
- `src/popup/index.html`, `src/popup/main.js`, `src/popup/App.vue`, `src/popup/popup.css`: Vue/Element Plus 弹窗状态、手动采集和“管理计划”入口。
- `src/dashboard/index.html`, `src/dashboard/main.js`, `src/dashboard/App.vue`, `src/dashboard/components/PlanEditor.vue`, `src/dashboard/components/PriceHistory.vue`, `src/dashboard/dashboard.css`: Vue/Element Plus 城市与日期表单、计划管理、历史筛选和现有 SVG 图表。
- `vite.config.js`, `scripts/copy-extension-assets.mjs`, `scripts/verify-extension.mjs`, `.gitignore`: 多页面构建、MV3 静态资源打包、产物校验和生成目录忽略。
- `package.json`, `package-lock.json`, `README.md`, `docs/THIRD_PARTY_NOTICES.md`: 安装依赖、打包命令、扩展安装路径和城市数据来源/许可证。
- `tests/cities.test.js`, `tests/domain.test.js`, `tests/storage.test.js`, `tests/collector.test.js`, `tests/airline-adapters.test.js`: 城市数据、迁移、固定采集选项及航司入口测试。

### Task 1: 城市数据与计划契约

**Files:** Create `src/shared/china-cities.json`, `src/shared/cities.js`, `tests/cities.test.js`; modify `src/shared/domain.js`, `src/shared/storage.js`, `tests/domain.test.js`, `tests/storage.test.js`.

**Interfaces:** `listCities()` returns unique domestic flight-city records; `getCityById(id)` returns one city or `null`; `findCityByAirportCode(code)` is migration-only. `normalizePlan(input)` accepts `originCityId`, `destinationCityId`, matching display names, `travelDates`, `airlineCodes`, `collectionTime`, and `enabled`; it does not persist `name`, `originCode`, `destinationCode`, `adultCount`, or `cabin`. `migrateStoredPlan(raw)` converts known legacy airport codes and retains unknown plans disabled with `migrationStatus: "needs-city-selection"`.

- [ ] **Step 1: Write failing city and plan tests.** Assert city IDs/names are unique; Hangzhou and Changchun exist; airport codes for a multi-airport city resolve to the same city; valid plans normalize city fields and fixed UI-free schema; identical cities and unknown IDs are rejected.
- [ ] **Step 2: Run focused tests and confirm the expected missing API/schema failures.** Run `node --test tests/cities.test.js tests/domain.test.js`; expect failures for missing city helpers and old airport-only validation.
- [ ] **Step 3: Add compact licensed city data and pure lookup functions.** Vendor only required city fields from the domestic city list, retain airport codes solely for legacy lookup, sort by Chinese display name, and record attribution plus MIT notice in `docs/THIRD_PARTY_NOTICES.md`.
- [ ] **Step 4: Implement plan normalization and legacy migration.** Resolve names from the static city table instead of trusting form text; map known legacy codes, mark unknown records disabled without deleting them, and preserve their IDs and timestamps.
- [ ] **Step 5: Write failing storage migration tests, then implement migration in `listPlans()`.** Verify a legacy HGH/CGQ plan becomes Hangzhou/Changchun and an unknown legacy route remains present, disabled, and editable.
- [ ] **Step 6: Run focused tests and confirm all city/domain/storage cases pass.** Run `node --test tests/cities.test.js tests/domain.test.js tests/storage.test.js`.

### Task 2: 城市查询采集契约

**Files:** Modify `src/collectors/airline-config.js`, `src/collectors/airchina.js`, `src/collectors/csair.js`, `src/background/collector.js`, `src/background/service-worker.js`, `src/shared/domain.js`, `manifest.json`; modify `tests/airline-adapters.test.js`, `tests/collector.test.js`, `tests/domain.test.js`.

**Interfaces:** Adapter URLs open the airlines' official city search pages. A collection message contains a normalized city plan plus fixed `adultCount: 1`, `cabin: "economy"`, and one `travelDate`. Observation records store city ID/name and the fixed economy value, never a user-editable airport code.

- [ ] **Step 1: Write failing adapter and collector tests.** Assert both adapters accept Hangzhou/Changchun city values and return HTTPS official URLs; assert every collection message contains one adult and economy while the persisted plan contains neither field.
- [ ] **Step 2: Run `node --test tests/airline-adapters.test.js tests/collector.test.js` and confirm failures.** Existing adapters require airport codes and collection requests do not carry fixed defaults.
- [ ] **Step 3: Implement city-based query URLs and request payload.** Use the official city-form entry pages, resolve IDs to canonical Chinese names before dispatch, set constants in the collector, and add the Air China mobile host to the MV3 allowlist.
- [ ] **Step 4: Update content scripts to select city suggestions and fixed options.** Set the visible origin/destination fields by Chinese city name, date, one adult, and economy; if a suggestion or required option cannot be selected, return a clear adapter failure before submitting.
- [ ] **Step 5: Preserve fare and error safeguards.** Keep reading only explicit visible list fares; return no observation for login, CAPTCHA, validation, unavailable route, or missing fare states.
- [ ] **Step 6: Run adapter, collector, and domain tests.** Run `node --test tests/airline-adapters.test.js tests/collector.test.js tests/domain.test.js` and confirm all pass.

### Task 3: Vue 与 Element Plus 页面

**Files:** Modify `package.json`; create/update popup and dashboard Vue entry files listed in the File Map; retire the replaced imperative `src/popup/popup.js` and `src/dashboard/dashboard.js` entrypoints; update `src/shared/chart-model.js` only if the Vue history view needs a tested model adjustment.

**Interfaces:** `PlanEditor.vue` emits `save(plan)`, `edit(plan)`, and `cancel`; it receives city options and a selected plan. The dashboard app owns plans, runs, observations, and filters. `PriceHistory.vue` receives saved observations and filters and renders the existing `buildChartModel()` output. Popup and dashboard continue using the existing `chrome.runtime.sendMessage` message names.

- [ ] **Step 1: Add Vue view-model tests before replacing the current pages.** Add tests for constructing a city-only plan payload, rejecting same-city/empty-date input, formatting route labels from city names, and deriving available airline/flight filter values from stored observations.
- [ ] **Step 2: Run the focused view-model tests and confirm they fail because the helpers are not implemented.** Run `node --test tests/ui-model.test.js`.
- [ ] **Step 3: Install Vue 3, Element Plus, Vite, and `@vitejs/plugin-vue` with npm.** Commit the generated lockfile and record the exact `node_modules` and npm cache paths in a user-level memory note as required.
- [ ] **Step 4: Implement pure UI models and the Vue popup.** Use Element Plus buttons and status components; keep the popup compact, retain manual collection, and label the dashboard link “管理计划与价格历史”.
- [ ] **Step 5: Implement the dashboard plan editor with Element Plus.** Use filterable `el-select` city pickers showing only city names and an `el-date-picker` in multiple-date mode; include airline selection, daily time, enabled state, inline validation, and edit/reset behavior; omit plan name, airport, passenger, and cabin fields.
- [ ] **Step 6: Implement plan list and history filters in Vue.** Preserve add/edit/enable/disable/delete flows, route/date filters, direct/transfer control, and airline/flight mode; each filter change recomputes from local observations only.
- [ ] **Step 7: Render existing chart data in `PriceHistory.vue`.** Preserve capture-date x-axis, listed-fare y-axis, missing-day gaps, stable airline colors, accessible table summary, and “列表价（未含税费）” label.
- [ ] **Step 8: Run `node --test tests/ui-model.test.js` and the full `npm test`.** Confirm page models and existing chart/filter tests pass before proceeding to packaging.

### Task 4: Vite 打包、Chrome 产物校验与交付

**Files:** Create `vite.config.js`, `scripts/copy-extension-assets.mjs`, `.gitignore`; modify both HTML entry files, `scripts/verify-extension.mjs`, `manifest.json`, `package.json`, `README.md`, and the original design doc `docs/superpowers/specs/2026-11-18-flight-price-tracker-design.md`.

**Interfaces:** `npm run build` emits `dist/` with `manifest.json`, popup/dashboard HTML and local assets, plus `src/background`, `src/collectors`, and `src/shared` scripts at manifest paths. `npm run verify` validates the built manifest and resources after the build.

- [ ] **Step 1: Add a failing packaging assertion.** Extend `scripts/verify-extension.mjs` to require built `dist/manifest.json`, both HTML pages, every manifest script, and all local imports/resources; run `npm run verify` and confirm it fails before the build pipeline exists.
- [ ] **Step 2: Configure Vite for two extension pages with relative asset URLs.** Keep all UI dependencies bundled locally; copy Manifest V3 background modules and classic content scripts without remote code.
- [ ] **Step 3: Add build/verify scripts and ignore generated files.** Set `build` to run Vite then copy `manifest.json` and runtime script directories; set `verify` to run the build and validate `dist/`; ignore `node_modules/` and `dist/`.
- [ ] **Step 4: Update README and design documentation.** Tell users to run `npm install`, `npm run build`, then load `dist/` via Chrome “加载已解压的扩展程序”; document the new city fields, fixed collection parameters, city data notice, and that Chrome/manual real-site checks remain required.
- [ ] **Step 5: Run the verification sequence.** Run `npm test`, `npm run build`, and `npm run verify`; inspect `dist/manifest.json` and assert no remote scripts/styles are referenced by the extension pages.
- [ ] **Step 6: Review the final diff and merge the verified feature branch into local `main`.** Preserve the pre-existing untracked `.DS_Store`; do not push. Real Chrome and official airline result-page behavior remain a manual follow-up for Dong because this run must not launch Playwright or a browser.
