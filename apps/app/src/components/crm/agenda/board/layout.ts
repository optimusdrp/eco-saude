/**
 * Posição dos blocos na grade quando há consultas sobrepostas na mesma coluna
 * (ex.: visão de semana com vários profissionais): cada grupo de consultas que
 * se cruzam é dividido em "faixas" lado a lado, como num calendário de verdade.
 */
export interface Laid<T> {
  item: T;
  lane: number;
  lanes: number;
}

export function layoutLanes<T extends { startMin: number; endMin: number }>(items: T[]): Laid<T>[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const out: Laid<T>[] = [];
  let cluster: Laid<T>[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];

  const flush = () => {
    const lanes = laneEnds.length || 1;
    for (const c of cluster) c.lanes = lanes;
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
  };

  for (const item of sorted) {
    if (item.startMin >= clusterEnd && cluster.length) flush();
    // Primeira faixa livre (que já terminou antes deste começar)
    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMin);
    } else laneEnds[lane] = item.endMin;
    cluster.push({ item, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  if (cluster.length) flush();
  return out;
}
