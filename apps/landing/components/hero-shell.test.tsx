import { render, screen } from "@testing-library/react";

import { HeroTerminalSection } from "./HeroTerminalSection";
import { LandingHeader } from "./LandingHeader";
import { TopTicker } from "./TopTicker";

describe("hero shell", () => {
  it("renders live ticker items, navigation, and the terminal hero", () => {
    render(
      <>
        <TopTicker />
        <LandingHeader />
        <HeroTerminalSection />
      </>,
    );

    expect(screen.getByText(/btc 30d iv/i)).toBeInTheDocument();
    expect(screen.getByText(/latency budget/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /how it works/i }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: /request access/i }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", { name: /view terminal/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /institutional-grade options terminal/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/aggregate chain/i)).toBeInTheDocument();
  });
});
