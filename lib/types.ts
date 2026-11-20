export const FIBONACCI_VALUES = [1, 2, 3, 5, 8, 13, 21] as const;

export type FibonacciValue = (typeof FIBONACCI_VALUES)[number];
export const TSHIRT_VALUES = ["XS", "S", "M", "L", "XL", "XXL"] as const;
export type CardValue = FibonacciValue | (typeof TSHIRT_VALUES)[number];
export type DeckType = "fibonacci" | "t-shirt-sizes";
export type Votes = Record<string, CardValue>;
export const DECKS = {
  fibonacci: { name: "Fibonacci", values: FIBONACCI_VALUES },
  "t-shirt-sizes": { name: "T-shirt Sizes", values: TSHIRT_VALUES },
} as const;
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
  votes: Votes;
  revealed: boolean;
  createdAt: string;
  revealStartedAt?: string;
  revealedAt?: string;
}

export interface RoundSummary {
  id: string;
  number: number;
  task: string;
  votes: Votes;
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
  deck?: DeckType;
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

export type TableMutation =
  | {
      type: "join";
      participant: Participant;
    }
  | {
      type: "vote";
      roundId: string;
      participantId: string;
      value: CardValue | null;
    };

export interface TeamMetric {
  team: string;
  alignment: number;
  votes: number;
  members: number;
}
