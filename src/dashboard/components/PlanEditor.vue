<template>
  <el-dialog
    :model-value="visible"
    :title="plan ? '编辑查询计划' : '新建查询计划'"
    width="min(680px, calc(100vw - 32px))"
    :close-on-click-modal="false"
    @close="$emit('cancel')"
  >
    <el-alert
      v-if="plan?.migrationStatus === 'needs-city-selection'"
      title="旧计划的城市无法自动确认，请重新选择出发地和到达地。"
      type="warning"
      :closable="false"
      show-icon
      class="migration-alert"
    />
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-position="top"
      @submit.prevent="submitForm"
    >
      <div class="plan-form-grid">
        <el-form-item label="出发地" prop="originCityId">
          <el-select
            v-model="form.originCityId"
            filterable
            clearable
            placeholder="选择出发城市"
            :filter-method="filterCities"
            @visible-change="onCityPickerVisible"
          >
            <el-option
              v-for="city in filteredCities"
              :key="city.id"
              :label="city.name"
              :value="city.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="到达地" prop="destinationCityId">
          <el-select
            v-model="form.destinationCityId"
            filterable
            clearable
            placeholder="选择到达城市"
            :filter-method="filterCities"
            @visible-change="onCityPickerVisible"
          >
            <el-option
              v-for="city in filteredCities"
              :key="city.id"
              :label="city.name"
              :value="city.id"
            />
          </el-select>
        </el-form-item>
      </div>

      <el-form-item label="目标出行日期" prop="travelDates">
        <el-date-picker
          v-model="form.travelDates"
          type="dates"
          value-format="YYYY-MM-DD"
          format="YYYY-MM-DD"
          placeholder="选择一个或多个日期"
          class="full-width"
        />
      </el-form-item>

      <el-form-item label="采集航司" prop="airlineCodes">
        <el-checkbox-group v-model="form.airlineCodes">
          <el-checkbox v-for="(name, code) in AIRLINE_NAMES" :key="code" :value="code">{{ name }}</el-checkbox>
        </el-checkbox-group>
      </el-form-item>

      <div class="plan-form-grid plan-form-footer">
        <el-form-item label="每日采集时间" prop="collectionTime">
          <el-time-select
            v-model="form.collectionTime"
            start="00:00"
            step="00:15"
            end="23:45"
            placeholder="选择时间"
          />
        </el-form-item>
        <el-form-item label="计划状态">
          <el-switch
            v-model="form.enabled"
            active-text="启用每日采集"
            inactive-text="已停用"
          />
        </el-form-item>
      </div>
    </el-form>

    <template #footer>
      <el-button @click="$emit('cancel')">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submitForm">
        保存计划
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, nextTick, reactive, ref, watch } from "vue";
import { AIRLINE_NAMES } from "../../shared/domain.js";

const props = defineProps({
  visible: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  cities: { type: Array, default: () => [] },
  plan: { type: Object, default: null },
});

const emit = defineEmits(["save", "cancel"]);
const formRef = ref();
const cityQuery = ref("");
const form = reactive(makeEmptyForm());

function makeEmptyForm() {
  return {
    originCityId: "",
    destinationCityId: "",
    travelDates: [],
    airlineCodes: Object.keys(AIRLINE_NAMES),
    collectionTime: "09:00",
    enabled: true,
  };
}

const filteredCities = computed(() => {
  const query = cityQuery.value.trim().toLowerCase();
  if (!query) {
    return props.cities;
  }
  return props.cities.filter((city) =>
    city.name.includes(query) || city.pinyin.includes(query),
  );
});

const rules = {
  originCityId: [{ required: true, message: "请选择出发城市", trigger: "change" }],
  destinationCityId: [
    {
      validator(_rule, value, callback) {
        if (!value) {
          callback(new Error("请选择到达城市"));
        } else if (value === form.originCityId) {
          callback(new Error("出发地和到达地不能相同"));
        } else {
          callback();
        }
      },
      trigger: "change",
    },
  ],
  travelDates: [
    { type: "array", required: true, min: 1, message: "请选择目标出行日期", trigger: "change" },
  ],
  airlineCodes: [
    { type: "array", required: true, min: 1, message: "至少选择一家航司", trigger: "change" },
  ],
  collectionTime: [{ required: true, message: "请选择每日采集时间", trigger: "change" }],
};

function filterCities(query) {
  cityQuery.value = query;
}

function onCityPickerVisible(visible) {
  if (!visible) {
    cityQuery.value = "";
  }
}

watch(
  () => props.visible,
  async (visible) => {
    if (!visible) {
      return;
    }
    Object.assign(form, makeEmptyForm(), props.plan
      ? {
          originCityId: props.plan.originCityId ?? "",
          destinationCityId: props.plan.destinationCityId ?? "",
          travelDates: [...(props.plan.travelDates ?? [])],
          airlineCodes: [...(props.plan.airlineCodes ?? [])],
          collectionTime: props.plan.collectionTime ?? "09:00",
          enabled: props.plan.enabled ?? false,
        }
      : {});
    cityQuery.value = "";
    await nextTick();
    formRef.value?.clearValidate();
  },
);

async function submitForm() {
  if (props.saving) {
    return;
  }
  try {
    await formRef.value.validate();
    emit("save", { ...form, travelDates: [...form.travelDates], airlineCodes: [...form.airlineCodes] });
  } catch {
    return;
  }
}
</script>
