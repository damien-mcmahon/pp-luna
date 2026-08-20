export const FIBONACCI_VALUES = [1, 2, 3, 5, 8, 13, 21] as const;

export type FibonacciValue = (typeof FIBONACCI_VALUES)[number];
export type TableMode = "participant" | "dealer";

export interface Participant {
  id: string;
  name: string;
  team: string;
  isCreator: boolean;
  isDealer: boolean;
  joinedAt: string;
  lastSeenAt: string;
}

export interface Round {
  id: string;
  number: number;
  task: string;
  votes: Record<string, number>;
  revealed: boolean;
  createdAt: string;
  revealStartedAt?: string;
  revealedAt?: string;
}

export interface RoundSummary {
  id: string;
  number: number;
  task: string;
  votes: Record<string, number>;
  alignment: number;
  average: number;
  createdAt: string;
  revealedAt: string;
}

export interface TableRecord {
  id: string;
  slug: string;
  name: string;
  creatorId: string;
  createdAt: string;
  updatedAt: string;
  currentRound: Round;
  members: Participant[];
  history: RoundSummary[];
}

export interface TableIdentity {
  tableSlug: string;
  participantId: string;
  name: string;
  team: string;
  isCreator: boolean;
  isDealer: boolean;
  role?: "participant" | "spectator";
}

export type TableMutation = {
  type: "join";
  participant: Participant;
};

export interface TeamMetric {
  team: string;
  alignment: number;
  votes: number;
  members: number;
}
