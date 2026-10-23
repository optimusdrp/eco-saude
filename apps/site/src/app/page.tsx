import { Contact } from "@/components/sections/Contact";
import { Ecosystem } from "@/components/sections/Ecosystem";
import { Faq } from "@/components/sections/Faq";
import { Features } from "@/components/sections/Features";
import { Hero } from "@/components/sections/Hero";
import { Lab } from "@/components/sections/Lab";
import { Offline } from "@/components/sections/Offline";
import { Roadmap } from "@/components/sections/Roadmap";
import { Security } from "@/components/sections/Security";

/**
 * Página inicial: apenas organiza a ordem das seções.
 * Cada seção vive em src/components/sections, e o texto em src/content.
 */
export default function HomePage() {
  return (
    <>
      <Hero />
      <Ecosystem />
      <Features />
      <Lab />
      <Offline />
      <Security />
      <Roadmap />
      <Faq />
      <Contact />
    </>
  );
}
