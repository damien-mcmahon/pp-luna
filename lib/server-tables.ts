import { SupabaseClient } from "@supabase/supabase-js";
import { Round, RoundSummary, TableRecord } from "@/lib/types";

function tablePayload(table: TableRecord) {
  return {
    id: table.id,
    slug: table.slug,
    name: table.name,
    creator_id: table.creatorId,
    created_at: table.createdAt,
    updated_at: table.updatedAt,
  };
}

function roundPayload(tableId: string, round: Round, revealed = round.revealed) {
  return {
    id: round.id,
    table_id: tableId,
    round_number: round.number,
    task: round.task,
    revealed,
    created_at: round.createdAt,
    reveal_started_at: round.revealStartedAt ?? null,
    revealed_at: revealed ? round.revealedAt ?? new Date().toISOString() : null,
  };
}

function summaryToRound(summary: RoundSummary): Round {
  return {
    id: summary.id,
    number: summary.number,
    task: summary.task,
    votes: summary.votes,
    revealed: true,
    createdAt: summary.createdAt,
    revealedAt: summary.revealedAt,
  };
}

export async function saveTableToSupabase(client: SupabaseClient, table: TableRecord) {
  const tableResult = await client.from("tables").upsert(tablePayload(table));
  if (tableResult.error) throw tableResult.error;

  const participants = table.members.map((member) => ({
    id: member.id,
    table_id: table.id,
    name: member.name,
    team: member.team || null,
    is_creator: member.isCreator,
    is_dealer: member.isDealer,
    joined_at: member.joinedAt,
    last_seen_at: member.lastSeenAt,
  }));
  const participantResult = await client.from("participants").upsert(participants);
  if (participantResult.error) throw participantResult.error;

  const rounds = [table.currentRound, ...table.history.map(summaryToRound)];
  const uniqueRounds = rounds.filter(
    (round, index, list) => list.findIndex((candidate) => candidate.id === round.id) === index,
  );
  const roundResult = await client
    .from("rounds")
    .upsert(uniqueRounds.map((round) => roundPayload(table.id, round)));
  if (roundResult.error) throw roundResult.error;

  const voteRows = uniqueRounds.flatMap((round) =>
    Object.entries(round.votes).map(([participantId, value]) => ({
      round_id: round.id,
      table_id: table.id,
      participant_id: participantId,
      value,
    })),
  );
  const deleteVotesResult = await client.from("votes").delete().eq("table_id", table.id);
  if (deleteVotesResult.error) throw deleteVotesResult.error;
  if (voteRows.length > 0) {
    const voteResult = await client.from("votes").insert(voteRows);
    if (voteResult.error) throw voteResult.error;
  }

  return table;
}

function alignmentForVotes(votes: Record<string, number>) {
  const values = Object.values(votes);
  if (!values.length) return 0;
  const counts = values.reduce<Record<string, number>>((result, value) => {
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
  return Math.round((Math.max(...Object.values(counts)) / values.length) * 100);
}

function averageForVotes(votes: Record<string, number>) {
  const values = Object.values(votes);
  if (!values.length) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export async function loadTableFromSupabase(client: SupabaseClient, slug: string) {
  const tableResult = await client.from("tables").select("*").eq("slug", slug).maybeSingle();
  if (tableResult.error || !tableResult.data) return null;

  const table = tableResult.data;
  const [participantResult, roundResult, voteResult] = await Promise.all([
    client.from("participants").select("*").eq("table_id", table.id).order("joined_at"),
    client.from("rounds").select("*").eq("table_id", table.id).order("round_number"),
    client.from("votes").select("*").eq("table_id", table.id),
  ]);

  if (participantResult.error || roundResult.error || voteResult.error) return null;

  const rounds = roundResult.data ?? [];
  const votesByRound = new Map<string, Record<string, number>>();
  for (const vote of voteResult.data ?? []) {
    const votes = votesByRound.get(vote.round_id) ?? {};
    votes[vote.participant_id] = vote.value;
    votesByRound.set(vote.round_id, votes);
  }

  const mappedRounds = rounds.map((round) => ({
    id: round.id,
    number: round.round_number,
    task: round.task ?? "",
    votes: votesByRound.get(round.id) ?? {},
    revealed: round.revealed,
    createdAt: round.created_at,
    revealStartedAt: round.reveal_started_at ?? undefined,
    revealedAt: round.revealed_at ?? undefined,
  })) as Round[];
  const currentRound = mappedRounds[mappedRounds.length - 1] ?? {
    id: `round_${Date.now()}`,
    number: 1,
    task: "",
    votes: {},
    revealed: false,
    createdAt: new Date().toISOString(),
  };
  const history = mappedRounds
    .filter((round) => round.id !== currentRound.id && round.revealed)
    .map<RoundSummary>((round) => ({
      id: round.id,
      number: round.number,
      task: round.task,
      votes: round.votes,
      alignment: alignmentForVotes(round.votes),
      average: averageForVotes(round.votes),
      createdAt: round.createdAt,
      revealedAt: round.revealedAt ?? round.createdAt,
    }));

  return {
    id: table.id,
    slug: table.slug,
    name: table.name,
    creatorId: table.creator_id,
    createdAt: table.created_at,
    updatedAt: table.updated_at,
    currentRound,
    history,
    members: (participantResult.data ?? []).map((member) => ({
      id: member.id,
      name: member.name,
      team: member.team ?? "",
      isCreator: member.is_creator,
      isDealer: member.is_dealer,
      joinedAt: member.joined_at,
      lastSeenAt: member.last_seen_at,
    })),
  } satisfies TableRecord;
}
