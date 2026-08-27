// Entry point: loads the dataset and starts the interactive Klimaspirale
// (tilted spiral + vertical funnel + horizontal time series) on a canvas.

import { loadDataset, loadMultiDataset, loadStations, loadWeatherMap, loadGermany } from "./data.js";
import { runKlimaspirale, runKlimaspiraleMulti } from "./engine.js";

export async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) throw new Error("#app container not found");
  const dataUrl = root.getAttribute("data-src") ?? "./data/klimaspirale.json";
  const stationsUrl = root.getAttribute("data-stations") ?? "./data/stations.json";
  const weatherUrl = root.getAttribute("data-weather") ?? "./data/weather_map.json";
  const germanyUrl = root.getAttribute("data-germany") ?? "./data/germany.json";
  try {
    const dataset = await loadMultiDataset(dataUrl);
    runKlimaspiraleMulti(
      root,
      dataset,
      () => loadStations(stationsUrl),
      async () => {
        const [weather, geo] = await Promise.all([loadWeatherMap(weatherUrl), loadGermany(germanyUrl)]);
        return { weather, geo };
      },
    );
  } catch (err) {
    console.warn(`Klimaspirale: multi-region dataset unavailable, using sample (${String(err)})`);
    const data = await loadDataset(dataUrl);
    runKlimaspirale(root, data);
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void main());
  } else {
    void main();
  }
}
