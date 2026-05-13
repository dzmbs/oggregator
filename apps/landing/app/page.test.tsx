import { render, screen } from "@testing-library/react";

import HomePage from "./page";

describe("landing page", () => {
  it("renders the redesigned terminal landing architecture", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", {
        name: /the options terminal for fragmented markets/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /from fragmented feeds to one execution-ready terminal/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /technical answers before the onboarding call/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: /request access/i }).length,
    ).toBeGreaterThan(0);
  });
});
