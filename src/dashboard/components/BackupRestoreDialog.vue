<template>
  <el-dialog
    v-model="visible"
    title="从备份恢复"
    class="backup-restore-dialog"
    width="min(520px, calc(100vw - 32px))"
    append-to-body
    align-center
    :close-on-click-modal="false"
    :close-on-press-escape="!restoring"
    :show-close="!restoring"
  >
    <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="selectFile" />
    <button
      type="button"
      class="backup-dropzone"
      :class="{ 'is-dragging': dragging }"
      :disabled="restoring"
      :aria-busy="reading"
      aria-label="选择或拖入 JSON 备份文件"
      @click="fileInput?.click()"
      @dragenter.prevent="dragging = !restoring"
      @dragover.prevent
      @dragleave="dragging = false"
      @drop.prevent.stop="dropFile"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4" />
      </svg>
      <strong>{{ fileName || "点击选择或拖入 JSON 备份" }}</strong>
      <small>{{ reading ? "正在校验备份…" : fileName ? "点击选择或拖入其他文件" : "支持 .json 文件" }}</small>
    </button>
    <p v-if="errorMessage" class="backup-error" role="alert">{{ errorMessage }}</p>

    <template v-if="backup">
      <dl class="backup-preview" aria-label="备份预览">
        <div class="backup-preview-date">
          <dt>备份时间</dt>
          <dd><time :datetime="backup.exportedAt">{{ formatTime(backup.exportedAt) }}</time></dd>
        </div>
        <div><dt>查询计划</dt><dd>{{ backup.plans.length }} 个</dd></div>
        <div><dt>航班报价</dt><dd>{{ backup.observations.length }} 条</dd></div>
        <div><dt>采集记录</dt><dd>{{ backup.runs.length }} 次</dd></div>
      </dl>

      <fieldset class="backup-strategies" :disabled="restoring">
        <legend>恢复方式</legend>
        <label class="backup-strategy" :class="{ 'is-selected': strategy === 'merge' }">
          <input v-model="strategy" type="radio" name="backup-strategy" value="merge" />
          <span><strong>智能合并</strong><small>保留本地记录，补充备份中尚未保存的记录。</small></span>
        </label>
        <label class="backup-strategy" :class="{ 'is-selected': strategy === 'overwrite', 'is-destructive': strategy === 'overwrite' }">
          <input v-model="strategy" type="radio" name="backup-strategy" value="overwrite" />
          <span><strong>完全覆盖</strong><small>清空本地的计划、报价和采集记录，再恢复该备份。</small></span>
        </label>
      </fieldset>
    </template>
    <p v-if="collectionBusy" class="backup-busy" role="status">采集结束后即可恢复。若在等待人工验证，请先继续或跳过当前任务。</p>

    <template #footer>
      <el-button :disabled="restoring" @click="visible = false">取消</el-button>
      <el-button
        :type="strategy === 'overwrite' ? 'danger' : 'primary'"
        :class="{ 'backup-overwrite-button': strategy === 'overwrite' }"
        :disabled="!backup || reading || collectionBusy"
        :loading="restoring"
        @click="confirmRestore"
      >{{ strategy === "overwrite" ? "覆盖并恢复" : "合并恢复" }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, shallowRef, watch } from "vue";
import { ElMessage } from "element-plus";
import { MAX_BACKUP_BYTES, parseBackup } from "../../shared/backup.js";

const visible = defineModel({ type: Boolean, required: true });
const props = defineProps({
  collectionBusy: { type: Boolean, default: false },
  restoreBackup: { type: Function, required: true },
});

const fileInput = ref(null);
const fileName = ref("");
const backup = shallowRef(null);
const strategy = ref("merge");
const dragging = ref(false);
const reading = ref(false);
const restoring = ref(false);
const errorMessage = ref("");
let readToken = 0;

const timeFormatter = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });

function formatTime(timestamp) {
  return timeFormatter.format(new Date(timestamp));
}

watch(visible, (open) => {
  if (open) return;
  readToken += 1;
  fileName.value = "";
  backup.value = null;
  strategy.value = "merge";
  dragging.value = false;
  reading.value = false;
  errorMessage.value = "";
});

function selectFile(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (file) void previewFile(file);
}

function dropFile(event) {
  dragging.value = false;
  const [file, extra] = event.dataTransfer.files;
  if (restoring.value || !file) return;
  if (extra) {
    readToken += 1;
    fileName.value = "";
    backup.value = null;
    strategy.value = "merge";
    reading.value = false;
    errorMessage.value = "每次只能恢复一个备份文件。";
    return;
  }
  void previewFile(file);
}

async function previewFile(file) {
  if (restoring.value) return;

  const token = ++readToken;
  fileName.value = file.name;
  backup.value = null;
  strategy.value = "merge";
  errorMessage.value = "";
  reading.value = true;
  try {
    if (!/\.json$/i.test(file.name)) throw new Error("请选择 .json 备份文件。");
    if (file.size > MAX_BACKUP_BYTES) throw new Error("这份备份超过 20 MB，无法读取。");
    const text = await file.text();
    if (readToken === token) backup.value = parseBackup(text);
  } catch (error) {
    if (readToken === token) errorMessage.value = error.message;
  } finally {
    if (readToken === token) reading.value = false;
  }
}

async function confirmRestore() {
  if (!backup.value || reading.value || restoring.value || props.collectionBusy) return;

  const mode = strategy.value;
  restoring.value = true;
  errorMessage.value = "";
  try {
    const { counts, warning } = await props.restoreBackup(backup.value, mode);
    visible.value = false;
    const action = mode === "merge" ? "合并完成，新增" : "已恢复";
    ElMessage.success({
      message: `${action} ${counts.plans} 个计划、${counts.observations} 条报价和 ${counts.runs} 次采集记录`,
      customClass: "data-transfer-toast",
    });
    if (warning) ElMessage.warning(warning);
  } catch (error) {
    errorMessage.value = /quota/i.test(error.message) ? "本地存储空间不足，无法恢复这份备份。" : error.message;
  } finally {
    restoring.value = false;
  }
}
</script>
