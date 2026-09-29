// What a reviewer tells the Effect lens about one repository: whether it is on.
//
// The lens has nothing else to set. It reads every script that names `Effect`
// and decides the rest from the code, so the one question is whether this
// repository's reviewer wants its `yield*`s quieted and its exits drawn as
// labels — and the answer can differ between two repositories that both use
// Effect, because one reviewer reads a diff to learn a codebase and the next
// to check every character of it.

export interface EffectSettings {
  enabled: boolean;
}

export const DEFAULT_EFFECT_SETTINGS: EffectSettings = { enabled: true };

/** Reads a stored value back, or nothing when it is not this shape. */
export function acceptEffectSettings(
  value: unknown
): EffectSettings | undefined {
  if (typeof value !== 'object' || value == null) return undefined;
  const { enabled } = value as { enabled?: unknown };
  return typeof enabled === 'boolean' ? { enabled } : undefined;
}
