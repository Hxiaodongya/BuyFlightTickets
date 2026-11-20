<template>
  <section id="history-observations" class="quotes-section dashboard-card" aria-labelledby="quotes-title">
    <div class="section-heading">
      <h2 id="quotes-title">航班报价</h2>
      <div class="quote-heading-meta">
        <p class="section-subtitle">{{ rows.length }} 条报价 · 未含税费</p>
        <el-tooltip content="导出当前筛选结果为 CSV" placement="top" :show-after="250">
          <button
            type="button"
            class="data-ghost-button quote-export-button"
            aria-label="导出当前筛选结果为 CSV"
            :disabled="!rows.length"
            @click="exportQuotes"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4" />
            </svg>
          </button>
        </el-tooltip>
      </div>
    </div>
    <div v-if="selection" class="quote-selection">
      <div class="quote-selection-heading">
        <p role="status"><strong>{{ selection.key === 'lowest' ? '历史最低价' : `${selection.captureDate} 采集` }}</strong> · {{ formatFare(selection.listedFareCny) }} · 已定位 {{ highlightedIds.size }} 条报价</p>
        <button type="button" @click="$emit('clear-selection')">清除定位</button>
      </div>
      <ul v-if="selection.key !== 'lowest' && highlightedIds.size > 1" class="quote-selection-list" aria-label="该点包含的航班">
        <li v-for="row in highlightedRows" :key="row.id"><strong>{{ row.flightNo }}</strong> · {{ row.travelDate.slice(5) }} 出发</li>
      </ul>
    </div>
    <el-empty v-if="!rows.length" description="当前筛选条件下没有航班报价" :image-size="85" />
    <div v-else ref="tableScroll" class="quote-table-scroll" tabindex="0" role="region" aria-label="航班报价表格">
      <table class="observation-table" aria-labelledby="quotes-title">
        <thead>
          <tr>
            <th scope="col">航班</th>
            <th scope="col">起飞</th>
            <th scope="col">到达</th>
            <th scope="col">是否经停</th>
            <th scope="col">总用时</th>
            <th scope="col">采集日期</th>
            <th scope="col" class="quote-price-column" :aria-sort="priceOrder || 'none'">
              <button type="button" class="price-sort-button" :aria-label="priceSortLabel" @click="togglePriceOrder">
                价格 <span aria-hidden="true">{{ priceOrder === 'ascending' ? '↑' : priceOrder === 'descending' ? '↓' : '↕' }}</span>
              </button>
            </th>
            <th scope="col" class="quote-action-column">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id" :class="{ 'is-chart-match': highlightedIds.has(row.id) }">
            <td>
              <div class="quote-flight">
                <span class="airline-mark" :style="{ '--airline-color': airlineColor(row.airlineCode) }" aria-hidden="true">{{ row.airlineCode }}</span>
                <div class="quote-flight-text">
                  <div class="quote-flight-name">
                    <strong class="flight-number">{{ row.flightNo }}</strong>
                    <span v-if="row.listedFareCny === lowestPrice" class="quote-lowest-badge">最低</span>
                  </div>
                  <span class="quote-detail">{{ row.airlineName || row.airlineCode }}</span>
                </div>
              </div>
            </td>
            <td>
              <time v-if="row.departureTime" class="quote-clock" :datetime="row.departureTime">{{ row.departureTime }}</time>
              <span v-else class="muted-text">—</span>
              <time class="quote-detail quote-date" :datetime="row.travelDate">{{ row.travelDate }}</time>
            </td>
            <td>
              <time v-if="row.arrivalTime" class="quote-clock" :datetime="row.arrivalTime">{{ row.arrivalTime }}</time>
              <span v-else class="muted-text">—</span>
              <time v-if="row.arrivalDate" class="quote-detail quote-date" :datetime="row.arrivalDate">{{ row.arrivalDate }}</time>
            </td>
            <td><span :class="row.hasStopover ? 'quote-stopover' : 'muted-text'">{{ formatStopover(row) ?? '—' }}</span></td>
            <td class="quote-duration">{{ formatDuration(row.durationMinutes) ?? '—' }}</td>
            <td><time class="quote-date muted-text" :datetime="row.captureDate">{{ row.captureDate }}</time></td>
            <td class="quote-price-column">
              <strong class="observation-fare" :class="{ 'is-lowest': row.listedFareCny === lowestPrice }">{{ formatFare(row.listedFareCny) }}</strong>
            </td>
            <td class="quote-action-column">
              <el-button
                v-if="row.searchUrl && formQuoteMessages[row.airlineCode]"
                class="quote-search-link"
                link
                :loading="openingQuoteId === row.id"
                :aria-label="quoteSearchLabel(row)"
                @click="openFormQuote(row)"
              >跳转 <span aria-hidden="true">↗</span></el-button>
              <a v-else-if="row.searchUrl" class="quote-search-link" :href="row.searchUrl" :aria-label="quoteSearchLabel(row)" target="_blank" rel="noopener noreferrer">跳转 <span aria-hidden="true">↗</span></a>
              <span v-else class="muted-text">不可用</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { buildQuoteSearchUrl } from "../../collectors/airline-config.js";
import { sortPriceHistoryRows } from "../../shared/chart-model.js";
import { downloadData, formatQuoteCsv, getQuoteCsvFilename } from "../data-download.js";
import { airlineColor, formatDuration, formatFare, formatStopover } from "../dashboard-model.js";

const props = defineProps({
  observations: { type: Array, required: true },
  lowestPrice: { type: Number, default: null },
  selection: { type: Object, default: null },
});
defineEmits(["clear-selection"]);

const priceOrder = ref(null);
const openingQuoteId = ref(null);
const tableScroll = ref(null);
const formQuoteMessages = { GJ: "OPEN_LOONG_AIR_QUOTE", "3U": "OPEN_SICHUAN_AIR_QUOTE" };
const highlightedIds = computed(() => new Set(props.selection?.observationIds));
const rows = computed(() => sortPriceHistoryRows(props.observations, priceOrder.value).map((observation) => ({
  ...observation, searchUrl: buildQuoteSearchUrl(observation),
})));
const highlightedRows = computed(() => rows.value.filter((row) => highlightedIds.value.has(row.id)));

function exportQuotes() {
  const exportRows = rows.value;
  if (!exportRows.length) return;

  try {
    downloadData(formatQuoteCsv(exportRows), getQuoteCsvFilename(exportRows), "text/csv;charset=utf-8");
    ElMessage.success({
      message: `已导出 ${exportRows.length} 条报价记录`,
      customClass: "data-transfer-toast",
    });
  } catch (error) {
    ElMessage.error(`报价导出失败。${error.message}`);
  }
}

function revealHighlightedRow() {
  tableScroll.value?.querySelector("tr.is-chart-match")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

defineExpose({ revealHighlightedRow });

const priceSortLabel = computed(() => {
  if (priceOrder.value === "ascending") return "价格当前升序，切换为降序";
  if (priceOrder.value === "descending") return "价格当前降序，切换为升序";
  return "价格，按金额升序排列";
});

function togglePriceOrder() {
  priceOrder.value = priceOrder.value === "ascending" ? "descending" : "ascending";
}

function quoteSearchLabel(row) {
  return `跳转至${row.airlineName || row.airlineCode}航班查询结果：${row.flightNo}，${row.travelDate}（新标签页）`;
}

async function openFormQuote(row) {
  if (openingQuoteId.value !== null) return;
  openingQuoteId.value = row.id;
  try {
    const response = await chrome.runtime.sendMessage({
      type: formQuoteMessages[row.airlineCode],
      quote: {
        airlineCode: row.airlineCode,
        originCityId: row.originCityId,
        destinationCityId: row.destinationCityId,
        originCode: row.originCode,
        destinationCode: row.destinationCode,
        travelDate: row.travelDate,
        sourceUrl: row.sourceUrl,
      },
    });
    if (response?.error) throw new Error(response.error);
    if (response?.pauseReason === "human-verification") ElMessage.warning(`请在${row.airlineName || "航司"}官网标签页手动验证`);
  } catch (error) {
    ElMessage.error(error.message);
  } finally {
    openingQuoteId.value = null;
  }
}
</script>
