import { migrateStoredPlan, normalizePlan } from "./domain.js";
import { createBackup, validateBackup } from "./backup.js";

const PLAN_PREFIX = "plan:";
const RUN_PREFIX = "run:";
const OBSERVATION_PREFIX = "observation:";
const BACKUP_PREFIXES = { plans: PLAN_PREFIX, observations: OBSERVATION_PREFIX, runs: RUN_PREFIX };

function entriesByPrefix(values, prefix) {
  return Object.entries(values).filter(([key, value]) => key.startsWith(prefix) && value != null);
}

export function createStorage(storageArea) {
  if (!storageArea) {
    throw new TypeError("A Chrome storage area is required");
  }

  let pendingWrite = Promise.resolve();

  function orderedWrite(write) {
    return (...args) => {
      const result = pendingWrite.then(() => write(...args));
      pendingWrite = result.catch(() => {});
      return result;
    };
  }

  async function listByPrefix(prefix) {
    return entriesByPrefix(await storageArea.get(null), prefix).map(([, value]) => value);
  }

  return {
    listPlans: orderedWrite(async () => {
      const values = await storageArea.get(null);
      const entries = entriesByPrefix(values, PLAN_PREFIX);
      const migratedEntries = entries.map(([key, value]) => [
        key,
        migrateStoredPlan(value),
      ]);
      const changedPlans = Object.fromEntries(
        migratedEntries.filter(([key, value]) =>
          JSON.stringify(values[key]) !== JSON.stringify(value),
        ),
      );

      if (Object.keys(changedPlans).length > 0) {
        await storageArea.set(changedPlans);
      }

      return migratedEntries.map(([, value]) => value);
    }),

    savePlan: orderedWrite(async (plan) => {
      const normalizedPlan = normalizePlan(plan);
      await storageArea.set({
        [`${PLAN_PREFIX}${normalizedPlan.id}`]: normalizedPlan,
      });
      return normalizedPlan;
    }),

    deletePlan: orderedWrite(async (planId) => {
      const observations = await listByPrefix(OBSERVATION_PREFIX);
      const keys = [
        `${PLAN_PREFIX}${planId}`,
        ...observations
          .filter((observation) => observation.planId === planId)
          .map((observation) => `${OBSERVATION_PREFIX}${observation.id}`),
      ];
      await storageArea.remove(keys);
    }),

    async listRuns() {
      const runs = await listByPrefix(RUN_PREFIX);
      return runs.sort(
        (left, right) =>
          Date.parse(right.startedAt ?? "") - Date.parse(left.startedAt ?? ""),
      );
    },

    saveRun: orderedWrite(async (run) => {
      if (!run?.id) {
        throw new TypeError("A run ID is required");
      }

      await storageArea.set({ [`${RUN_PREFIX}${run.id}`]: run });
      return run;
    }),

    async listObservations(filters = {}) {
      const observations = await listByPrefix(OBSERVATION_PREFIX);
      return observations.filter((observation) =>
        Object.entries(filters).every(
          ([key, value]) => value === undefined || observation[key] === value,
        ),
      );
    },

    saveObservations: orderedWrite(async (observations) => {
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
    }),

    async exportBackup(now = new Date()) {
      const values = await storageArea.get(null);
      const records = Object.fromEntries(Object.entries(BACKUP_PREFIXES).map(([category, prefix]) => [
        category, entriesByPrefix(values, prefix).map(([, value]) => value),
      ]));
      return createBackup(records, now);
    },

    restoreBackup: orderedWrite(async (input, strategy) => {
      if (strategy !== "merge" && strategy !== "overwrite") throw new TypeError("请选择有效的恢复方式。");
      const backup = validateBackup(input);
      const existing = await storageArea.get(null);
      const changes = {};
      const obsoleteKeys = [];
      const counts = {};

      for (const [category, prefix] of Object.entries(BACKUP_PREFIXES)) {
        counts[category] = 0;
        for (const record of backup[category]) {
          const key = `${prefix}${record.id}`;
          if (strategy === "merge" && existing[key] != null) continue;
          changes[key] = record;
          counts[category] += 1;
        }
        if (strategy === "overwrite") {
          for (const key of Object.keys(existing)) {
            if (!key.startsWith(prefix) || Object.hasOwn(changes, key)) continue;
            changes[key] = null;
            obsoleteKeys.push(key);
          }
        }
      }

      if (Object.keys(changes).length) await storageArea.set(changes);
      if (obsoleteKeys.length) await storageArea.remove(obsoleteKeys).catch(() => {});
      return counts;
    }),
  };
}
