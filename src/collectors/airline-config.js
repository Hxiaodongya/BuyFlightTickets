export const airlineAdapters = Object.freeze({
  CA: Object.freeze({
    pushResult: true,
    buildSearchUrl() {
      return "https://m.airchina.com.cn/ac/c/invoke/qryFlights_activity%40pg";
    },
  }),
  CZ: Object.freeze({
    pushResult: true,
    buildSearchUrl() {
      return "https://b2c.csair.com/B2CNew/flight/search";
    },
  }),
});
