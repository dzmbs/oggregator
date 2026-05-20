import createPlotlyComponent from 'react-plotly.js/factory';
import Plotly from 'plotly.js-gl3d-dist-min';

export const Plot = createPlotlyComponent(Plotly);

export const PLOTLY_3D_CONFIG: Partial<Plotly.Config> = {
  responsive: true,
  displayModeBar: false,
  scrollZoom: true,
};

export const SCENE_DEFAULTS: Partial<Plotly.Layout['scene']> = {
  bgcolor: '#0A0A0A',
  xaxis: { gridcolor: '#1A1A1A', color: '#555B5E', showbackground: false },
  yaxis: { gridcolor: '#1A1A1A', color: '#555B5E', showbackground: false },
  zaxis: { gridcolor: '#1A1A1A', color: '#555B5E', showbackground: false },
};
