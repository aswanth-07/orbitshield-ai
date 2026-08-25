import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';

import streamFixture from '../../../data/live-cdm-stream.json';
import { DELETE, GET, POST } from './route';

function request(message: unknown, reset = false, tca?: string) {
  return new NextRequest('http://localhost/api/model/live', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventId: streamFixture.eventId,
      source: streamFixture.source,
      mode: 'held-out-test-feed',
      tca,
      message,
      reset,
    }),
  });
}

describe('/api/model/live', () => {
  beforeEach(async () => {
    await DELETE(new NextRequest('http://localhost/api/model/live', { method: 'DELETE' }));
  });

  it('listens, ingests messages one at a time and exposes the latest score', async () => {
    const waiting = await (await GET()).json();
    expect(waiting.status).toBe('listening');

    await POST(request(streamFixture.messages[0], true));
    const second = await POST(request(streamFixture.messages[1]));
    const body = await second.json();
    expect(body.feed.messagesReceived).toBe(2);
    expect(body.feed.mode).toBe('held-out-test-feed');
    expect(body.inference.score).toBeCloseTo(0.988603072796187, 12);

    const current = await (await GET()).json();
    expect(current.inference.messagesSeen).toBe(2);
  });

  it('rejects a message from inside the T-2 cutoff', async () => {
    const response = await POST(request({ ...streamFixture.messages[0], time_to_tca: 1.5 }, true));
    expect(response.status).toBe(422);
  });

  it('normalizes an absolute TCA for a connected feed', async () => {
    const response = await POST(request(streamFixture.messages[0], true, '2026-08-27T09:05:00Z'));
    const body = await response.json();
    expect(body.feed.tca).toBe('2026-08-27T09:05:00.000Z');
  });
});
