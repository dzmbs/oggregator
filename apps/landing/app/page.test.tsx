import { render, screen } from "@testing-library/react";

import HomePage from "./page";

describe("landing page", () => {
  it("renders the hero headline and CTA", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", { name: /stop venue hopping/i }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /request access/i }).length,
    ).toBeGreaterThan(0);
  });
});
