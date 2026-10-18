/** Marca de quatro pétalas (uma por módulo), a mesma do site. */
export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path d="M16 15C16 8 12 3 7 3C5 8 9 14 16 15Z" fill="var(--color-crm)" />
      <path d="M17 16C24 16 29 12 29 7C24 5 18 9 17 16Z" fill="var(--color-erp)" />
      <path d="M16 17C16 24 20 29 25 29C27 24 23 18 16 17Z" fill="var(--color-pep)" />
      <path d="M15 16C8 16 3 20 3 25C8 27 14 23 15 16Z" fill="var(--color-bi)" />
    </svg>
  );
}
