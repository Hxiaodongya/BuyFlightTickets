import { getSeriesKey } from "./domain.js";

export function filterObservations(observations, filters = {}) {
  const selectedValues = Array.isArray(filters.selectedValues)
    ? new Set(filters.selectedValues)
    : null;

  return observations.filter((observation) => {
    if (filters.planId && observation.planId !== filters.planId) {
      return false;
    }
    if (filters.travelDate && observation.travelDate !== filters.travelDate) {
      return false;
    }
    if (filters.tripType === "direct" && observation.stopCount !== 0) {
      return false;
    }
    if (
      filters.tripType === "transfer" &&
      !(Number.isInteger(observation.stopCount) && observation.stopCount > 0)
    ) {
      return false;
    }
    if (selectedValues) {
      if (selectedValues.size === 0) {
        return false;
      }
      if (
        filters.filterMode === "airline" &&
        !selectedValues.has(observation.airlineCode)
      ) {
        return false;
      }
      if (
        filters.filterMode === "flight" &&
        !selectedValues.has(observation.flightNo)
      ) {
        return false;
      }
    }
    return true;
  });
}

export function buildChartModel(observations, collectionDates = []) {
  const seriesByKey = new Map();

  for (const observation of observations) {
    const key = getSeriesKey(observation);
    let series = seriesByKey.get(key);
    if (!series) {
      series = {
        key,
        planId: observation.planId,
        travelDate: observation.travelDate,
        airlineCode: observation.airlineCode,
        flightNo: observation.flightNo,
        cabin: observation.cabin,
        fareProduct: observation.fareProduct || null,
        pointsByDate: new Map(),
      };
      seriesByKey.set(key, series);
    }

    const current = series.pointsByDate.get(observation.captureDate);
    if (!current || Date.parse(observation.capturedAt) > Date.parse(current.capturedAt)) {
      series.pointsByDate.set(observation.captureDate, {
        captureDate: observation.captureDate,
        capturedAt: observation.capturedAt,
        listedFareCny: observation.listedFareCny,
      });
    }
  }

  const series = [...seriesByKey.values()]
    .map(({ pointsByDate, ...metadata }) => ({
      ...metadata,
      points: [...pointsByDate.values()].sort((left, right) =>
        left.captureDate.localeCompare(right.captureDate),
      ),
    }))
    .sort((left, right) =>
      [left.airlineCode, left.travelDate, left.flightNo, left.cabin].join("|")
        .localeCompare(
          [right.airlineCode, right.travelDate, right.flightNo, right.cabin].join("|"),
        ),
    );
  const captureDates = [
    ...new Set([
      ...observations.map((observation) => observation.captureDate),
      ...collectionDates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)),
    ]),
  ].sort();

  return { captureDates, series };
}
