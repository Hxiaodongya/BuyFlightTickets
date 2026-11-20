import { AIRLINE_NAMES, normalizePlan } from "./domain.js";

export function createPlanPayload(draft, existingPlan = null) {
  return normalizePlan({
    ...draft,
    ...(existingPlan
      ? { id: existingPlan.id, createdAt: existingPlan.createdAt }
      : {}),
  });
}

export function getRouteLabel(plan) {
  const origin = plan.originCityName || "请选择出发城市";
  const destination = plan.destinationCityName || "请选择到达城市";
  return `${origin} → ${destination}`;
}

export function getFilterOptions(observations, mode) {
  const values = new Map();
  for (const observation of observations) {
    const value = mode === "flight"
      ? String(observation.flightNo ?? "").trim()
      : String(observation.airlineCode ?? "").trim().toUpperCase();
    if (!value) {
      continue;
    }
    const label = mode === "flight"
      ? value
      : observation.airlineName || AIRLINE_NAMES[value] || value;
    values.set(value, label);
  }

  return [...values]
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
}
