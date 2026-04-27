import type { TurnRecord } from "./types.js";

const LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"];

export interface AnonymizationView {
  reveal: Record<string, string>;
  views: Record<string, Record<string, string>>;
}

export function buildAnonymizationView({
  participants,
  reviewers
}: {
  participants: string[];
  reviewers: string[];
}): AnonymizationView {
  const sortedParticipants = [...participants].sort();
  const reveal: Record<string, string> = {};
  for (let i = 0; i < sortedParticipants.length && i < LABELS.length; i += 1) {
    reveal[sortedParticipants[i]] = LABELS[i];
  }

  const views: Record<string, Record<string, string>> = {};
  reviewers.forEach((reviewer) => {
    const visibleParticipants = sortedParticipants.filter((id) => id !== reviewer);
    const view: Record<string, string> = {};
    visibleParticipants.forEach((actorId) => {
      view[actorId] = reveal[actorId];
    });
    views[reviewer] = view;
  });

  return { reveal, views };
}

export function buildSimpleAnonymization(actors: string[]): Record<string, string> {
  const sorted = [...actors].sort();
  const mapping: Record<string, string> = {};
  for (let i = 0; i < sorted.length && i < LABELS.length; i += 1) {
    mapping[sorted[i]] = LABELS[i];
  }
  return mapping;
}

export function decorateTurnsWithLabels<T extends TurnRecord>(
  turns: T[],
  labelMap: Record<string, string>
): Array<T & { displayLabel?: string; displayActor?: string }> {
  return turns.map((turn) => {
    const label = labelMap[turn.actor];
    if (!label) return turn;
    return {
      ...turn,
      displayLabel: `Response ${label}`,
      displayActor: `Response ${label}`
    };
  });
}
