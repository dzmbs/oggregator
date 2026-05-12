import { render, screen } from "@testing-library/react";

import { BringYourOwnDataSection } from "./BringYourOwnDataSection";
import { DeskWorkflowSection } from "./DeskWorkflowSection";
import { MarketContextSection } from "./MarketContextSection";
import { TestimonialsGrid } from "./TestimonialsGrid";

describe("proof sections", () => {
  it("renders the approved proof headlines and desk signals", () => {
    render(
      <>
        <MarketContextSection />
        <DeskWorkflowSection />
        <BringYourOwnDataSection />
        <TestimonialsGrid />
      </>,
    );

    expect(
      screen.getByRole("heading", { name: /market context,/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /built for desks/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /bring your own data/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/btc 30d atm iv/i)).toBeInTheDocument();
    expect(screen.getByText(/bestVenueSelection/i)).toBeInTheDocument();
    expect(screen.getByText(/crypto vol desk/i)).toBeInTheDocument();
  });
});
