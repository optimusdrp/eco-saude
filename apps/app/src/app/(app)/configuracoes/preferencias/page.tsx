import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/server";
import { PreferencesPanel } from "./PreferencesPanel";

export const metadata: Metadata = { title: "Preferências" };

/** Preferências deste navegador: tamanho do texto e telas personalizadas. */
export default function PreferencesPage() {
  return (
    <>
      <PageHeader title="Preferências" description="Valem só neste navegador. Em outro computador ou celular, cada pessoa ajusta do seu jeito." />
      <PreferencesPanel />
    </>
  );
}
