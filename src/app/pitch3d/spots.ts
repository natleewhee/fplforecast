/* Where figures stand. Free of three.js so the lineup can be laid out without loading it. */

export const BENCH_X = 13.3;
export const BENCH_Z0 = -2.85;
export const SEAT_Y = 0.37;
const BENCH_ZS = [-5.4, -3.7, -2.0, -0.3];

/** Seat positions for the bench, in order. */
export function benchSeat(i: number): { x: number; z: number } {
  return { x: BENCH_X, z: BENCH_ZS[i] ?? BENCH_ZS[BENCH_ZS.length - 1] };
}

/** x/z for each row of the starting XI: keeper at the back, forwards up front. */
export function formationSpots(rows: number[]): { x: number; z: number }[][] {
  const zs = rows.length === 4 ? [-13.5, -7.5, -1.5, 6] : rows.map((_, i) => -12 + (i * 19) / Math.max(rows.length - 1, 1));
  return rows.map((n, r) => {
    const spacing = n <= 1 ? 0 : Math.min(6.5, 17 / (n - 1));
    return Array.from({ length: n }, (_, i) => ({ x: (i - (n - 1) / 2) * spacing, z: zs[r] }));
  });
}
