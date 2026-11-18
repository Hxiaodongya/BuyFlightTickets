import { normalizePlan } from "./domain.js";

const PLAN_PREFIX = "plan:";
const RUN_PREFIX = "run:";
const OBSERVATION_PREFIX = "observation:";

function hasPrefix(key, prefix) {
  return key.startsWith(prefix);
}

export function createStorage(storageArea) {
  if (!storageArea) {
    throw new TypeError("A Chrome storage area is required");
  }

  async function listByPrefix(prefix) {
    const values = await storageArea.get(null);
    return Object.entries(values)
      .filter(([key]) => hasPrefix(key, prefix))
      .map(([, value]) => value);
  }

  return {
    async listPlans() {
      return listByPrefix(PLAN_PREFIX);
    },

    async savePlan(plan) {
      const normalizedPlan = normalizePlan(plan);
      await storageArea.set({
        [`${PLAN_PREFIX}${normalizedPlan.id}`]: normalizedPlan,
      });
      return normalizedPlan;
    },

    async deletePlan(planId) {
      const observations = await listByPrefix(OBSERVATION_PREFIX);
      const keys = [
        `${PLAN_PREFIX}${planId}`,
        ...observations
          .filter((observation) => observation.planId === planId)
          .map((observation) => `${OBSERVATION_PREFIX}${observation.id}`),
      ];
      await storageArea.remove(keys);
    },

    async listRuns() {
      const runs = await listByPrefix(RUN_PREFIX);
      return runs.sort(
        (left, right) =>
          Date.parse(right.startedAt ?? "") - Date.parse(left.startedAt ?? ""),
      );
    },

    async saveRun(run) {
      if (!run?.id) {
        throw new TypeError("A run ID is required");
      }

      await storageArea.set({ [`${RUN_PREFIX}${run.id}`]: run });
      return run;
    },

    async listObservations(filters = {}) {
      const observations = await listByPrefix(OBSERVATION_PREFIX);
      return observations.filter((observation) =>
        Object.entries(filters).every(
          ([key, value]) => value === undefined || observation[key] === value,
        ),
      );
    },

    async saveObservations(observations) {
      if (!Array.isArray(observations)) {
        throw new TypeError("Observations must be an array");
      }

      const uniqueObservations = new Map();
      for (const observation of observations) {
        if (!observation?.id) {
          throw new TypeError("Every observation must have an ID");
        }
        uniqueObservations.set(observation.id, observation);
      }

      const values = Object.fromEntries(
        [...uniqueObservations].map(([id, observation]) => [
          `${OBSERVATION_PREFIX}${id}`,
          observation,
        ]),
      );
      if (Object.keys(values).length > 0) {
        await storageArea.set(values);
      }

      return [...uniqueObservations.values()];
    },
  };
}
