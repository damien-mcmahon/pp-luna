import { CardValue, FibonacciValue, TSHIRT_VALUES, Votes } from "@/lib/types";

export function alignmentForVotes(votes: Votes) {
  const values = Object.values(votes).filter((value) => value !== null);
  if (!values.length) return 0;
  const counts = values.reduce<Record<string, number>>((result, value) => {
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
  return Math.round((Math.max(...Object.values(counts)) / values.length) * 100);
}

export function averageForVotes(votes: Votes) {
  const values = Object.values(votes).filter((value): value is FibonacciValue => typeof value === "number");
  if (!values.length) return 0;
  return values.reduce<number>((total, value) => total + value, 0) / values.length;
}

export function mostCommonSizes(votes: Votes) {
  const counts = new Map<CardValue, number>();
  for (const value of Object.values(votes)) {
    if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const maximum = Math.max(0, ...Array.from(counts.values()));
  return TSHIRT_VALUES
    .filter((size) => counts.get(size) === maximum && maximum > 0)
    .join(" / ") || "—";
}
