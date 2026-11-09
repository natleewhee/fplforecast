/* Where figures stand. Free of three.js so the lineup can be laid out without loading it. */

/** x/z for each row of the starting XI: keeper at the back, forwards up front. */
export function formationSpots(rows: number[]): { x: number; z: number }[][] {
  const zs = rows.length === 4 ? [-14, -8, -2, 4] : rows.map((_, i) => -14 + (i * 18) / Math.max(rows.length - 1, 1));
  return rows.map((n, r) => {
    const spacing = n <= 1 ? 0 : Math.min(5, 18 / (n - 1));
    return Array.from({ length: n }, (_, i) => ({ x: (i - (n - 1) / 2) * spacing, z: zs[r] }));
  });
}
