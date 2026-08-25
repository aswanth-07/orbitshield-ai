import { NextRequest, NextResponse } from 'next/server';

import modelFixture from '../../../data/live-cdm-model.json';
import { scoreLiveCdmSequence, type LiveCdmMessage, type LiveCdmModel } from '../../../lib/live-model';

export const runtime = 'edge';

const model = modelFixture as LiveCdmModel;

function isMessage(value: unknown): value is LiveCdmMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<LiveCdmMessage>;
  return typeof message.time_to_tca === 'number' && Number.isFinite(message.time_to_tca);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { eventId?: unknown; source?: unknown; messages?: unknown };
    if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 64 || !body.messages.every(isMessage)) {
      return NextResponse.json({ error: 'Provide between 1 and 64 valid CDM messages.' }, { status: 400 });
    }
    if (body.messages.some((message) => message.time_to_tca < model.cutoffDays)) {
      return NextResponse.json({ error: `This model accepts evidence at or before the T-${model.cutoffDays} day decision cutoff.` }, { status: 422 });
    }

    const inference = scoreLiveCdmSequence(body.messages, model);
    return NextResponse.json({
      status: inference.inputCoverage >= 0.8 ? 'scored' : 'provisional',
      eventId: typeof body.eventId === 'number' ? body.eventId : null,
      inputSource: typeof body.source === 'string' ? body.source : 'compatible CDM stream',
      computedAt: new Date().toISOString(),
      model: {
        id: model.id,
        name: model.name,
        treeCount: model.trees.length,
        scoreThreshold: model.scoreThreshold,
        cutoffDays: model.cutoffDays,
        artifactSha256: model.artifactSha256,
      },
      inference,
      warning: 'Triage score only. This is not a calibrated collision probability or manoeuvre instruction.',
    });
  } catch {
    return NextResponse.json({ error: 'The CDM payload could not be scored.' }, { status: 400 });
  }
}
