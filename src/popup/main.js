import { createApp } from "vue";
import { ElAlert, ElButton } from "element-plus";
import "element-plus/dist/index.css";
import "../shared/theme.css";
import "./app.css";
import App from "./App.vue";

const app = createApp(App);
app.component(ElAlert.name, ElAlert);
app.component(ElButton.name, ElButton);
app.mount("#app");
