# Price History and Verification Resume Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans in the existing isolated worktree. Run each regression test before changing its production code.

**Goal:** 让用户能找到图上的低价航班、准确比较报价，并在手动验证后免点击续采。

**Architecture:** 采集端根据明确标签或可识别航段确定经停/中转；价格历史在现有 Vue 页面内关联图点、原始记录和表格排序。原航司标签页只在暂停后观察有效结果，后台用同一会话的暂停检查点恢复任务。

**Tech Stack:** Chrome Manifest V3、Vue 3、Element Plus、Node.js 内置测试运行器。

**Spec:** 2026-11-19 聊天中批准的方案：参考 `jobs-trends` 风格；保留原航司标签页，手动验证后自动续采；不内嵌或代答验证。

## Global Constraints

- 沿用现有隔离工作树、依赖和授权范围，不修改参考插件或历史报价。
- 不对验证码进行操作，只接受原标签页、原航线和原日期的有效报价。
- 无法确认行程类型时保留报价，不用航班号出现次数伪造中转次数。

### Task 1: Correct Itinerary Parsing

**Files:** `src/collectors/price-parser.js`、`src/shared/domain.js`、`tests/airline-adapters.test.js`、`tests/domain.test.js`。

- [x] 增加 `中转\n08:25`、真实多航段、共享航班号和未知行程的反例；运行 `node --test tests/airline-adapters.test.js tests/domain.test.js` 观察红灯。
- [x] 仅识别带次数单位的标签，国航使用卡片内独立航段作为后备；没有证据时保存 `stopCount: null`。
- [x] 重跑以上测试，确认票面价采集和经停筛选行为保持一致。

### Task 2: Make Trend Points and Table Work Together

**Files:** `src/shared/chart-model.js`、`src/dashboard/components/PriceHistory.vue`、`src/dashboard/app.css`、`src/shared/theme.css`、两个入口的 `main.js` 与弹窗 CSS、`tests/chart-model.test.js`。

- [x] 测试同日同价合并、不同日期和不同价格分开、最新最低价、原始行 ID 和金额升降序；运行 `node --test tests/chart-model.test.js` 观察红灯。
- [x] 保留原折线，画一次分组后的交互点；标出最低价与航班；列表展示当前点的航班和出行日期，按观测 ID 高亮。
- [x] 去掉逐航班图例和行程列；表头切换数值排序；套用参考插件的浅绿主题和卡片样式。复验模型和构建。

### Task 3: Resume After Verified Results Appear

**Files:** `src/collectors/result-page.js`、`src/background/collector.js`、`src/background/service-worker.js`、`src/shared/VerificationPanel.vue`、`tests/airline-adapters.test.js`、`tests/collector.test.js`、`README.md`。

- [x] 测试原标签页跨刷新回到同一查询后才回传有效报价、拒绝错误标签页和路线日期、续采一次并保留手动回退；运行 `node --test tests/airline-adapters.test.js tests/collector.test.js` 观察红灯。
- [x] 通过 `GET_VERIFICATION_WATCH` 从暂停检查点获取查询范围，只有稳定报价才发送 `VERIFICATION_RESULTS_READY`；校验消息来源并消费一次当前检查点。
- [x] 更新操作提示和使用说明；运行 `npm test`、`npm run verify`、`git diff --check` 验证实际产物。
