import { BringYourOwnDataSection } from "@/components/BringYourOwnDataSection";
import { DeskWorkflowSection } from "@/components/DeskWorkflowSection";
import { Footer } from "@/components/Footer";
import { HeroStatement } from "@/components/HeroStatement";
import { LandingHeader } from "@/components/LandingHeader";
import { LeadCaptureSection } from "@/components/LeadCaptureSection";
import { MarketContextSection } from "@/components/MarketContextSection";
import { SectionReveal } from "@/components/SectionReveal";
import { TestimonialsGrid } from "@/components/TestimonialsGrid";
import { TopTicker } from "@/components/TopTicker";
import { VolSurfaceShowcase } from "@/components/VolSurfaceShowcase";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[var(--landing-bg)] text-[var(--landing-text)]">
      <TopTicker />
      <LandingHeader />
      <SectionReveal>
        <HeroStatement />
      </SectionReveal>
      <SectionReveal>
        <MarketContextSection />
      </SectionReveal>
      <SectionReveal>
        <VolSurfaceShowcase />
      </SectionReveal>
      <SectionReveal>
        <DeskWorkflowSection />
      </SectionReveal>
      <SectionReveal>
        <BringYourOwnDataSection />
      </SectionReveal>
      <SectionReveal>
        <TestimonialsGrid />
      </SectionReveal>
      <SectionReveal>
        <LeadCaptureSection />
      </SectionReveal>
      <Footer />
    </main>
  );
}
