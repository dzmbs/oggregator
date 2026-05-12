import { render, screen } from "@testing-library/react";

import { HeroStatement } from "./HeroStatement";
import { LandingHeader } from "./LandingHeader";
import { TopTicker } from "./TopTicker";

describe("hero shell", () => {
  it("renders crypto-options ticker items and both header actions", () => {
    render(
      <>
        <TopTicker />
        <LandingHeader />
        <HeroStatement />
      </>,
    );

    expect(screen.getAllByText(/btc 30d iv/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/eth 25d rr/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /docs/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /request access/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /live iv\. cross-venue liquidity\. desk-grade context\./i,
      ),
    ).toBeInTheDocument();
  });
});
