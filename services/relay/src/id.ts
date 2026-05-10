import type { Id } from "@codex-link/protocol";

let nextId = 1;

export function createId<T extends string>(prefix: string): Id<T> {
  return `${prefix}_${nextId++}` as Id<T>;
}

export function resetIdsForTest(): void {
  nextId = 1;
}
