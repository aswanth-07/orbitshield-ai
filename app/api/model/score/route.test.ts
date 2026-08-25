import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import streamFixture from '../../../data/live-cdm-stream.json';
import { POST } from './route';

type ScoreResponseBody = {
  status: string;
  model: { id: string };
  inference: { score: number; triage: string };
};

function request(messages: unknown[]) {
  return new NextRequest('http://localhost/api/model/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId: streamFixture.eventId, source: streamFixture.source, messages }),
  });
}

describe('POST /api/model/score', () => {
  it('scores the complete held-out T-2 stream with the exported champion', async () => {
    const response = await POST(request(streamFixture.messages));
    const body = await response.json() as ScoreResponseBody;
    expect(response.status).toBe(200);
    expect(body.status).toBe('scored');
    expect(body.model.id).toBe('orbitshield-hgb-t2-v1');
    expect(body.inference.score).toBeCloseTo(0.9134872137933265, 12);
    expect(body.inference.triage).toBe('elevated');
  });

  it('rejects evidence from inside the model decision cutoff', async () => {
    const message = { ...streamFixture.messages[0], time_to_tca: 1.5 };
    const response = await POST(request([message]));
    expect(response.status).toBe(422);
  });
});
