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

    expect(screen.getByText(/btc 30d iv/i)).toBeInTheDocument();
    expect(screen.getByText(/eth 25d rr/i)).toBeInTheDocument();
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
