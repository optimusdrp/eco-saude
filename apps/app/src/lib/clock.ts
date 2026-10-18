/**
 * Relógio do servidor num lugar só.
 * As páginas chamam now() em vez de new Date(): fica explícito que o valor
 * muda a cada requisição (páginas dinâmicas) e facilita simular datas em testes.
 */
export function now(): Date {
  return new Date();
}
