import { BringYourOwnDataSection } from "@/components/BringYourOwnDataSection";
import { DeskWorkflowSection } from "@/components/DeskWorkflowSection";
import { Footer } from "@/components/Footer";
import { HeroStatement } from "@/components/HeroStatement";
import { LandingHeader } from "@/components/LandingHeader";
import { MarketContextSection } from "@/components/MarketContextSection";
import { TestimonialsGrid } from "@/components/TestimonialsGrid";
import { TopTicker } from "@/components/TopTicker";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[var(--landing-bg)] text-[var(--landing-text)]">
      <TopTicker />
      <LandingHeader />
      <HeroStatement />
      <MarketContextSection />
      <DeskWorkflowSection />
      <BringYourOwnDataSection />
      <TestimonialsGrid />
      <Footer />
    </main>
  );
}
