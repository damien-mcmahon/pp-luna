import { SupabaseClient } from "@supabase/supabase-js";
import { Participant, Round, RoundSummary, TableMutation, TableRecord } from "@/lib/types";

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
  if (voteRows.length > 0) {
    // Votes are additive while a hand is open. Deleting the whole vote set
    // here lets concurrent player snapshots erase one another.
    const voteResult = await client
      .from("votes")
      .upsert(voteRows, { onConflict: "round_id,participant_id" });
    if (voteResult.error) throw voteResult.error;
  }

  return table;
}

export async function saveVoteToSupabase(
  client: SupabaseClient,
  table: TableRecord,
  mutation: Extract<TableMutation, { type: "vote" }>,
) {
  const tableResult = await client
    .from("tables")
    .select("id")
    .eq("slug", table.slug)
    .maybeSingle();
  if (tableResult.error) throw tableResult.error;

  if (!tableResult.data) return saveTableToSupabase(client, table);

  const [roundResult, participantResult] = await Promise.all([
    client
      .from("rounds")
      .select("id, revealed")
      .eq("id", mutation.roundId)
      .eq("table_id", tableResult.data.id)
      .maybeSingle(),
    client
      .from("participants")
      .select("id, is_dealer")
      .eq("id", mutation.participantId)
      .eq("table_id", tableResult.data.id)
      .maybeSingle(),
  ]);
  if (roundResult.error) throw roundResult.error;
  if (participantResult.error) throw participantResult.error;

  // Ignore a delayed vote once the dealer has turned this round over.
  if (!roundResult.data || roundResult.data.revealed || !participantResult.data || participantResult.data.is_dealer) {
    return (await loadTableFromSupabase(client, table.slug)) ?? table;
  }

  const voteResult = await client.from("votes").upsert({
    round_id: mutation.roundId,
    table_id: tableResult.data.id,
    participant_id: mutation.participantId,
    value: mutation.value,
  }, { onConflict: "round_id,participant_id" });
  if (voteResult.error) throw voteResult.error;

  const touchResult = await client
    .from("tables")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", tableResult.data.id);
  if (touchResult.error) throw touchResult.error;

  return (await loadTableFromSupabase(client, table.slug)) ?? table;
}

export async function saveParticipantToSupabase(
  client: SupabaseClient,
  table: TableRecord,
  participant: Participant,
) {
  const tableResult = await client
    .from("tables")
    .select("id")
    .eq("slug", table.slug)
    .maybeSingle();
  if (tableResult.error) throw tableResult.error;

  // A join only changes the roster. Avoid rewriting rounds and votes from the
  // joiner's potentially older snapshot.
  if (!tableResult.data) return saveTableToSupabase(client, table);

  const participantResult = await client.from("participants").upsert({
    id: participant.id,
    table_id: tableResult.data.id,
    name: participant.name,
    team: participant.team || null,
    is_creator: participant.isCreator,
    is_dealer: participant.isDealer,
    joined_at: participant.joinedAt,
    last_seen_at: participant.lastSeenAt,
  });
  if (participantResult.error) throw participantResult.error;

  const touchResult = await client
    .from("tables")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", tableResult.data.id);
  if (touchResult.error) throw touchResult.error;

  return (await loadTableFromSupabase(client, table.slug)) ?? table;
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
