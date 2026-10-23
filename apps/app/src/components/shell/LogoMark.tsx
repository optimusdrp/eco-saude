/**
 * MARCA TROPI: monograma "t"
 * A barra do "t" se curva para cima, como uma seta, em direção ao sol (laranja).
 * Tropi vem de "tropismo", o movimento em direção à luz.
 *  - Traço em índigo (no fundo escuro, índigo claro); o sol é sempre laranja "Sol".
 *  - Abaixo de 80 px de largura, use só o símbolo (sem o nome).
 * O mesmo desenho está no site, no backoffice e nos ícones (icon.svg).
 */
export function LogoMark({ className = "size-8", onDark = false }: { className?: string; onDark?: boolean }) {
  const c = onDark ? "#8f8beb" : "var(--color-crm)";
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path d="M11 5V20.5A5 5 0 0 0 16 25.5H19" stroke={c} strokeWidth="4.2" strokeLinecap="round" fill="none" />
      <path d="M5.5 12.5H14Q19.5 12.5 21.5 8" stroke={c} strokeWidth="4.2" strokeLinecap="round" fill="none" />
      <circle cx="25.5" cy="6" r="3.6" fill="var(--color-sun)" />
    </svg>
  );
}

/** Logotipo horizontal: símbolo + "tropi" em minúsculas (nunca "TROPI"). */
export function Logo({ onDark = false, suffix, className = "" }: { onDark?: boolean; suffix?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark className="size-8 shrink-0" onDark={onDark} />
      <span className={`font-display text-2xl leading-none font-extrabold tracking-[-0.035em] ${onDark ? "text-white" : "text-night"}`}>tropi</span>
      {suffix ? <span className={`font-display text-base font-semibold ${onDark ? "text-white/70" : "text-ink-soft"}`}>{suffix}</span> : null}
    </span>
  );
}
