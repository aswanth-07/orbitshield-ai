import { NextRequest, NextResponse } from 'next/server';

import modelFixture from '../../../data/live-cdm-model.json';
import { scoreLiveCdmSequence, type LiveCdmMessage, type LiveCdmModel } from '../../../lib/live-model';

export const runtime = 'edge';

const model = modelFixture as LiveCdmModel;

type FeedMode = 'external-operator' | 'held-out-test-feed';
type LiveFeedState = {
  eventId: number;
  source: string;
  mode: FeedMode;
  tca: string | null;
  messages: LiveCdmMessage[];
  updatedAt: string;
};

const stateKey = '__orbitshield_live_cdm_feed__';
const runtimeState = globalThis as typeof globalThis & { [stateKey]?: LiveFeedState };

function isMessage(value: unknown): value is LiveCdmMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<LiveCdmMessage>;
  return typeof message.time_to_tca === 'number' && Number.isFinite(message.time_to_tca);
}

function authorized(request: NextRequest) {
  const expected = process.env.CDM_INGEST_TOKEN;
  return !expected || request.headers.get('Authorization') === `Bearer ${expected}`;
}

function responseFor(state: LiveFeedState | undefined) {
  if (!state?.messages.length) {
    return {
      status: 'listening',
      feed: null,
      model: { id: model.id, name: model.name, treeCount: model.trees.length, cutoffDays: model.cutoffDays },
      warning: 'No compatible CDM has arrived. Public SOCRATES screening continues separately.',
    };
  }
  const inference = scoreLiveCdmSequence(state.messages, model);
  return {
    status: inference.inputCoverage >= 0.8 ? 'scored' : 'provisional',
    feed: {
      eventId: state.eventId,
      source: state.source,
      mode: state.mode,
      messagesReceived: state.messages.length,
      updatedAt: state.updatedAt,
      tca: state.tca,
    },
    model: {
      id: model.id,
      name: model.name,
      treeCount: model.trees.length,
      cutoffDays: model.cutoffDays,
      scoreThreshold: model.scoreThreshold,
      artifactSha256: model.artifactSha256,
    },
    inference,
    warning: 'Triage score only. This is not a calibrated collision probability or manoeuvre instruction.',
  };
}

export async function GET() {
  return NextResponse.json(responseFor(runtimeState[stateKey]), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function DELETE(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Invalid CDM ingestion token.' }, { status: 401 });
  delete runtimeState[stateKey];
  return NextResponse.json(responseFor(undefined), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Invalid CDM ingestion token.' }, { status: 401 });
  try {
    const body = await request.json() as {
      eventId?: unknown;
      source?: unknown;
      mode?: unknown;
      tca?: unknown;
      message?: unknown;
      reset?: unknown;
    };
    if (typeof body.eventId !== 'number' || !Number.isFinite(body.eventId) || !isMessage(body.message)) {
      return NextResponse.json({ error: 'A numeric eventId and one valid CDM message are required.' }, { status: 400 });
    }
    if (body.message.time_to_tca < model.cutoffDays) {
      return NextResponse.json({ error: `This model accepts evidence at or before the T-${model.cutoffDays} day decision cutoff.` }, { status: 422 });
    }

    const existing = runtimeState[stateKey];
    const reset = body.reset === true || !existing || existing.eventId !== body.eventId;
    const mode: FeedMode = body.mode === 'held-out-test-feed' ? 'held-out-test-feed' : 'external-operator';
    const messages = reset ? [] : existing.messages;
    const updatedMessages = mode === 'held-out-test-feed'
      ? [...messages.filter((message) => message.time_to_tca !== body.message.time_to_tca), body.message]
      : [...messages, body.message];
    if (updatedMessages.length > 64) return NextResponse.json({ error: 'The live event already contains 64 messages.' }, { status: 409 });
    const parsedTca = typeof body.tca === 'string' && Number.isFinite(new Date(body.tca).getTime())
      ? new Date(body.tca).toISOString()
      : null;
    const next: LiveFeedState = {
      eventId: body.eventId,
      source: typeof body.source === 'string' ? body.source : 'Connected CDM provider',
      mode,
      tca: parsedTca ?? (reset ? null : existing?.tca ?? null),
      messages: updatedMessages,
      updatedAt: new Date().toISOString(),
    };
    runtimeState[stateKey] = next;
    return NextResponse.json(responseFor(next), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'The live CDM message could not be ingested.' }, { status: 400 });
  }
}
