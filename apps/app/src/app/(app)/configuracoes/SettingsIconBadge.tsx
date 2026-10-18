"use client";

import { SETTINGS_ICONS } from "./SettingsTabs";
import type { SettingsIcon } from "./catalog";

/** Ícone de uma área dos Ajustes num quadrado colorido (cartões da visão geral). */
export function SettingsIconBadge({ icon }: { icon: SettingsIcon }) {
  const Icon = SETTINGS_ICONS[icon];
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-crm-tint text-crm" aria-hidden>
      <Icon className="size-5" />
    </span>
  );
}
