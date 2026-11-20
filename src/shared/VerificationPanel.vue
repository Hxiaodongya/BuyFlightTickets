<template>
  <section class="verification-panel" aria-label="人工验证任务">
    <el-alert
      title="采集暂停，等待人工验证"
      :description="description"
      type="warning"
      :closable="false"
      show-icon
    />
    <div class="verification-actions" role="group" aria-label="人工验证操作">
      <el-button size="small" :disabled="Boolean(pendingAction)" @click="perform('OPEN_VERIFICATION_TAB')">
        打开验证页
      </el-button>
      <el-button
        size="small"
        type="primary"
        :disabled="Boolean(pendingAction)"
        :loading="pendingAction === 'RESUME_COLLECTION_RUN'"
        @click="perform('RESUME_COLLECTION_RUN')"
      >
        手动继续
      </el-button>
      <el-button size="small" :disabled="Boolean(pendingAction)" @click="perform('SKIP_VERIFICATION_TASK')">
        跳过本项
      </el-button>
    </div>
    <p v-if="errorMessage" class="verification-error" role="alert">{{ errorMessage }}</p>
  </section>
</template>

<script setup>
import { computed, ref } from "vue";

const props = defineProps({ run: { type: Object, required: true } });
const emit = defineEmits(["change"]);
const airlineNames = { CA: "国航", CZ: "南航", GJ: "长龙航空" };
const description = computed(() => {
  const { taskIndex, message } = props.run.manualVerification;
  const task = props.run.tasks?.[taskIndex];
  const instructions = `${message ?? "请在原航司标签页手动验证。"}本次航班列表出现后会自动续采。`;
  return task
    ? `${airlineNames[task.airlineCode] ?? task.airlineCode} · ${task.travelDate}。${instructions}`
    : instructions;
});
const pendingAction = ref("");
const errorMessage = ref("");

async function perform(type) {
  if (pendingAction.value) return;
  pendingAction.value = type;
  errorMessage.value = "";
  try {
    const response = await chrome.runtime.sendMessage({
      type,
      runId: props.run.id,
      taskIndex: props.run.manualVerification.taskIndex,
    });
    if (response?.error) throw new Error(response.error);
    if (type !== "OPEN_VERIFICATION_TAB") emit("change");
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    pendingAction.value = "";
  }
}
</script>

<style scoped>
.verification-panel {
  margin-top: 12px;
}

.verification-error {
  margin: 6px 0 0;
  color: #aa3731;
  line-height: 1.5;
}

.verification-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.verification-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
</style>
