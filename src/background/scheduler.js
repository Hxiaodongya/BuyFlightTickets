const ALARM_PREFIX = "daily-collection:";

function asDate(value) {
  const date = value instanceof Date ? new Date(value.valueOf()) : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new TypeError("A valid current date is required");
  }
  return date;
}

function getLocalDate(value) {
  const date = asDate(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function getNextDailyRun(now = new Date(), hour = 9, minute = 0) {
  if (
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    throw new RangeError("Schedule must be a valid local time");
  }

  const current = asDate(now);
  const next = new Date(current);
  next.setHours(hour, minute, 0, 0);
  if (next <= current) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}

export function getTodayCollectionStatus(runs, now = new Date()) {
  const today = getLocalDate(now);
  const latestTodayRun = runs
    .filter((run) => run.startedAt && getLocalDate(run.startedAt) === today)
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))[0];

  if (!latestTodayRun) {
    return "not-collected";
  }
  if (latestTodayRun.status === "running") {
    return "running";
  }
  if (latestTodayRun.status === "complete" || latestTodayRun.status === "completed") {
    return "complete";
  }
  if (latestTodayRun.status === "partial") {
    return "partial";
  }
  return "failed";
}

export async function markInterruptedRuns(storage, now = new Date()) {
  const endedAt = asDate(now).toISOString();
  const runs = await storage.listRuns();
  const interrupted = runs.filter((run) => run.status === "running");

  for (const run of interrupted) {
    run.status = run.successCount > 0 ? "partial" : "failed";
    run.endedAt = endedAt;
    run.updatedAt = endedAt;
    run.error = "Chrome closed before this collection run finished";
    await storage.saveRun(run);
  }

  return interrupted.length;
}

export function createScheduler({ alarmsApi, storage, onScheduledRun, now = () => new Date() }) {
  if (!alarmsApi || !storage) {
    throw new TypeError("Alarm and storage APIs are required");
  }

  async function schedulePlan(plan) {
    const alarmName = `${ALARM_PREFIX}${plan.id}`;
    if (!plan.enabled) {
      await alarmsApi.clear(alarmName);
      return;
    }

    const [hour, minute] = plan.collectionTime.split(":").map(Number);
    await alarmsApi.create(alarmName, {
      when: getNextDailyRun(now(), hour, minute),
    });
  }

  return {
    async rescheduleAll() {
      const plans = await storage.listPlans();
      const activeAlarmNames = new Set(
        plans
          .filter((plan) => plan.enabled)
          .map((plan) => `${ALARM_PREFIX}${plan.id}`),
      );
      const alarms = await alarmsApi.getAll();

      for (const alarm of alarms) {
        if (
          alarm.name.startsWith(ALARM_PREFIX) &&
          !activeAlarmNames.has(alarm.name)
        ) {
          await alarmsApi.clear(alarm.name);
        }
      }

      for (const plan of plans) {
        await schedulePlan(plan);
      }
    },

    async reschedulePlan(planId) {
      const plans = await storage.listPlans();
      const plan = plans.find((candidate) => candidate.id === planId);
      if (plan) {
        await schedulePlan(plan);
      } else {
        await alarmsApi.clear(`${ALARM_PREFIX}${planId}`);
      }
    },

    async handleAlarm(alarm) {
      if (!alarm?.name?.startsWith(ALARM_PREFIX)) {
        return false;
      }

      const planId = alarm.name.slice(ALARM_PREFIX.length);
      try {
        await onScheduledRun?.(planId);
      } finally {
        await this.reschedulePlan(planId);
      }
      return true;
    },
  };
}
