import { render, screen } from "@testing-library/react";

import HomePage from "./page";

describe("landing page", () => {
  it("renders the redesigned spatial landing architecture", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", {
        name: /navigate volatility as a live surface/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /one surface, three disclosure depths/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /technical answers before the onboarding call/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /3d volatility surface with depth-based telemetry/i })).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: /request access/i }).length,
    ).toBeGreaterThan(0);
  });
});
