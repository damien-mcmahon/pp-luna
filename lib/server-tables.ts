import { SupabaseClient } from "@supabase/supabase-js";
import { Round, RoundSummary, TableRecord, Votes } from "@/lib/types";
import { alignmentForVotes, averageForVotes } from "@/lib/voting";
import { tableForViewer } from "@/lib/table-security";

export async function loadTableFromSupabase(client: SupabaseClient, slug: string, tokenHash?: string) {
  const result = await client.from("tables").select("id,slug,name,creator_id,deck,created_at,updated_at").eq("slug", slug).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return null;
  const table = result.data;
  const [participants, rounds, votes, actor] = await Promise.all([
    client.from("participants").select("id,name,team,is_creator,is_dealer,joined_at,last_seen_at").eq("table_id", table.id).order("joined_at"),
    client.from("rounds").select("*").eq("table_id", table.id).order("round_number"),
    client.from("votes").select("round_id,participant_id,value").eq("table_id", table.id),
    tokenHash ? client.from("participants").select("id").eq("table_id", table.id).eq("session_token_hash", tokenHash).maybeSingle() : null,
  ]);
  if (participants.error || rounds.error || votes.error || actor?.error) throw new Error("Unable to load table.");
  const votesByRound = new Map<string, Votes>();
  for (const vote of votes.data ?? []) {
    const values = votesByRound.get(vote.round_id) ?? {};
    values[vote.participant_id] = /^\d+$/.test(vote.value) ? Number(vote.value) as Votes[string] : vote.value;
    votesByRound.set(vote.round_id, values);
  }
  const mappedRounds: Round[] = (rounds.data ?? []).map((round) => ({
    id: round.id, number: round.round_number, task: round.task,
    votes: votesByRound.get(round.id) ?? {}, revealed: round.revealed,
    createdAt: round.created_at, revealStartedAt: round.reveal_started_at ?? undefined,
    revealedAt: round.revealed_at ?? undefined,
  }));
  const currentRound = mappedRounds[mappedRounds.length - 1];
  if (!currentRound) throw new Error("Table has no current round.");
  const history = mappedRounds.filter((round) => round.id !== currentRound.id && round.revealed)
    .map<RoundSummary>((round) => ({
      id: round.id, number: round.number, task: round.task, votes: round.votes,
      alignment: alignmentForVotes(round.votes), average: averageForVotes(round.votes),
      createdAt: round.createdAt, revealedAt: round.revealedAt ?? round.createdAt,
    }));
  return tableForViewer({
    id: table.id, slug: table.slug, name: table.name, creatorId: table.creator_id,
    deck: table.deck, createdAt: table.created_at, updatedAt: table.updated_at,
    currentRound, history,
    members: (participants.data ?? []).map((member) => ({
      id: member.id, name: member.name, team: member.team ?? "",
      isCreator: member.is_creator, isDealer: member.is_dealer,
      joinedAt: member.joined_at, lastSeenAt: member.last_seen_at,
    })),
  } satisfies TableRecord, actor?.data?.id ?? null);
}
