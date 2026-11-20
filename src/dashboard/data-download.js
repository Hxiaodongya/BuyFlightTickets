import { formatDuration, formatStopover } from "./dashboard-model.js";

function dateStamp(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export function getBackupFilename(date = new Date()) {
  return `flight-tracker-backup-${dateStamp(date)}.json`;
}

function quoteRoute(row) {
  return [row.originCityName || row.originName || row.originCode, row.destinationCityName || row.destinationName || row.destinationCode];
}

export function getQuoteCsvFilename(rows, date = new Date()) {
  const routes = new Set(rows.map((row) => quoteRoute(row).join("-")));
  const route = routes.size > 1 ? "多航线" : ([...routes][0] ?? "");
  const safeRoute = route.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").slice(0, 80).replace(/^[.\s-]+|[.\s-]+$/g, "");
  return `${safeRoute ? `${safeRoute}-` : ""}航班报价-${dateStamp(date)}.csv`;
}

function csvCell(value) {
  let text = String(value ?? "");
  if (typeof value === "string" && /^(?:\s*[=+\-@＝＋－＠]|[\t\r\n])/.test(text)) text = `'${text}`;
  return /[,"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function formatQuoteCsv(rows) {
  const headers = ["出发城市", "到达城市", "航司", "航班号", "起飞日期与时间", "到达日期与时间", "是否经停", "总用时", "采集日期", "价格（CNY，未含税费）"];
  const lines = rows.map((row) => [
    ...quoteRoute(row), row.airlineName || row.airlineCode, row.flightNo,
    [row.travelDate, row.departureTime].filter(Boolean).join(" "),
    [row.arrivalDate, row.arrivalTime].filter(Boolean).join(" "),
    formatStopover(row), formatDuration(row.durationMinutes), row.captureDate, row.listedFareCny,
  ].map(csvCell).join(","));
  return `\uFEFF${[headers.join(","), ...lines].join("\r\n")}\r\n`;
}

export function downloadData(contents, filename, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}
