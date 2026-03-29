import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-gl3d-dist-min";

export const Plot = createPlotlyComponent(Plotly);
export type { Plotly };

export const PLOTLY_LAYOUT_BASE: Partial<Plotly.Layout> = {
  autosize: true,
  paper_bgcolor: "#0A0A0A",
  plot_bgcolor: "#0A0A0A",
  font: { family: "'IBM Plex Mono', monospace", size: 11, color: "#555B5E" },
  margin: { l: 50, r: 20, t: 10, b: 40 },
  xaxis: {
    gridcolor: "#1A1A1A",
    zerolinecolor: "#1A1A1A",
    color: "#555B5E",
    fixedrange: true,
  },
  yaxis: {
    gridcolor: "#1A1A1A",
    zerolinecolor: "#1A1A1A",
    color: "#555B5E",
    ticksuffix: "%",
    fixedrange: true,
  },
  hovermode: "x unified" as const,
  showlegend: false,
};

export const PLOTLY_CONFIG: Partial<Plotly.Config> = {
  responsive: true,
  displayModeBar: false,
  scrollZoom: false,
};
