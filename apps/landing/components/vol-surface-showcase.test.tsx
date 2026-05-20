import React from "react";
import { render, screen } from "@testing-library/react";

import { VolSurfaceShowcase } from "./VolSurfaceShowcase";

describe("vol surface showcase", () => {
  it("renders the approved headline and proof metrics", () => {
    render(React.createElement(VolSurfaceShowcase));

    expect(
      screen.getByRole("heading", { name: /see the surface/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/91 deltas/i)).toBeInTheDocument();
    expect(screen.getByText(/7 venues/i)).toBeInTheDocument();
    expect(screen.getByText(/interactive tenor map/i)).toBeInTheDocument();
  });
});
