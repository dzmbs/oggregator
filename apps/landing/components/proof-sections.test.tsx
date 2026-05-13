import { fireEvent, render, screen } from "@testing-library/react";

import { FaqSection } from "./FaqSection";
import { FeatureBentoSection } from "./FeatureBentoSection";
import { HowItWorksSection } from "./HowItWorksSection";

describe("proof sections", () => {
  it("renders workflow and feature proof for the terminal", () => {
    render(
      <>
        <HowItWorksSection />
        <FeatureBentoSection />
      </>,
    );

    expect(
      screen.getByRole("heading", {
        name: /from fragmented feeds to one execution-ready terminal/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /^ingest$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /fast enough for flow\. structured enough for conviction\./i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/venue-level route scoring/i)).toBeInTheDocument();
    expect(screen.getByText(/custom command execution/i)).toBeInTheDocument();
  });

  it("opens and closes FAQ items", () => {
    render(<FaqSection />);

    expect(
      screen.getByText(/the platform is designed for multi-exchange options aggregation/i),
    ).toBeInTheDocument();

    const button = screen.getByRole("button", {
      name: /how fast is the feed and routing update cycle/i,
    });

    fireEvent.click(button);

    expect(
      screen.getByText(/the terminal is tuned for sub-second visibility/i),
    ).toBeInTheDocument();
  });
});
