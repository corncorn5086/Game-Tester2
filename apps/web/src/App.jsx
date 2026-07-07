import MoltenCore from './components/MoltenCore.jsx';
import { useReveal, useScrollFx } from './lib/hooks.js';
import { Nav, Hero, Problem, Solution, Features, AppPreview } from './sections/core.jsx';
import { Connect, Engines, Workflow, DownloadSection, Pricing, Enterprise, Cta, Footer } from './sections/product.jsx';

export default function App() {
  useReveal();
  const { scrolled, stageOpacity } = useScrollFx();
  return (
    <div id="em-root">
      <MoltenCore opacity={stageOpacity} />
      <div className="vignette" />
      <Nav solid={scrolled} />
      <Hero />
      <Problem />
      <Solution />
      <Features />
      <AppPreview />
      <Connect />
      <Engines />
      <Workflow />
      <DownloadSection />
      <Pricing />
      <Enterprise />
      <Cta />
      <Footer />
    </div>
  );
}
