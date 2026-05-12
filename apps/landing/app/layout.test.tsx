import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import RootLayout from "./layout";

vi.mock("next/font/google", () => ({
  IBM_Plex_Mono: () => ({ variable: "font-mono" }),
  Inter_Tight: () => ({ variable: "font-display" }),
}));

vi.mock("@vercel/analytics/react", () => ({
  Analytics: () => <div data-testid="analytics" />,
}));

vi.mock("@vercel/speed-insights/next", () => ({
  SpeedInsights: () => <div data-testid="speed-insights" />,
}));

describe("RootLayout", () => {
  it("includes the analytics hooks in the document shell", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        RootLayout,
        undefined,
        React.createElement("div", undefined, "child"),
      ),
    );

    expect(html).toContain('data-testid="analytics"');
    expect(html).toContain('data-testid="speed-insights"');
  });
});
