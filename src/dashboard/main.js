import { createApp, h } from "vue";
import {
  ElAlert,
  ElButton,
  ElCheckbox,
  ElCheckboxGroup,
  ElConfigProvider,
  ElDatePicker,
  ElDialog,
  ElDrawer,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElOption,
  ElSegmented,
  ElSelect,
  ElSwitch,
  ElTag,
  ElTimeSelect,
  ElTooltip,
} from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn.mjs";
import "dayjs/locale/zh-cn.js";
import "element-plus/dist/index.css";
import "../shared/theme.css";
import "./app.css";
import App from "./App.vue";

const app = createApp({
  render: () => h(ElConfigProvider, { locale: zhCn }, () => h(App)),
});
for (const component of [
  ElAlert,
  ElButton,
  ElCheckbox,
  ElCheckboxGroup,
  ElDatePicker,
  ElDialog,
  ElDrawer,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElOption,
  ElSegmented,
  ElSelect,
  ElSwitch,
  ElTag,
  ElTimeSelect,
  ElTooltip,
]) {
  app.component(component.name, component);
}
app.mount("#app");
