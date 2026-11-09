/* Where figures stand. Free of three.js so the lineup can be laid out without loading it. */

/** The bench sits on a strip behind the far goal line, facing the camera, so the view stays symmetric. */
export const BENCH_Z = -20.4;
export const SEAT_Y = 0.37;
const BENCH_X0 = -4.8;
const BENCH_DX = 3.2;

/** Seat positions for the bench, in order (room for four, centred). */
export function benchSeat(i: number): { x: number; z: number } {
  return { x: BENCH_X0 + Math.min(i, 3) * BENCH_DX, z: BENCH_Z };
}

/** x/z for each row of the starting XI: keeper at the back, forwards up front. */
export function formationSpots(rows: number[]): { x: number; z: number }[][] {
  const zs = rows.length === 4 ? [-13.5, -7.5, -1.5, 6] : rows.map((_, i) => -13.5 + (i * 19.5) / Math.max(rows.length - 1, 1));
  return rows.map((n, r) => {
    const spacing = n <= 1 ? 0 : Math.min(6.5, 17 / (n - 1));
    return Array.from({ length: n }, (_, i) => ({ x: (i - (n - 1) / 2) * spacing, z: zs[r] }));
  });
}
