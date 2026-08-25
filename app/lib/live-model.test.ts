import { describe, expect, it } from 'vitest';

import modelFixture from '../data/live-cdm-model.json';
import streamFixture from '../data/live-cdm-stream.json';
import { scoreLiveCdmSequence, type LiveCdmMessage, type LiveCdmModel } from './live-model';

const model = modelFixture as LiveCdmModel;
const stream = streamFixture as {
  messages: LiveCdmMessage[];
  expectedScores: number[];
};

describe('live CDM model inference', () => {
  it('matches the Python HistGradientBoosting score after every streamed message', () => {
    stream.expectedScores.forEach((expected, index) => {
      const result = scoreLiveCdmSequence(stream.messages.slice(0, index + 1), model);
      expect(result.score).toBeCloseTo(expected, 12);
      expect(result.messagesSeen).toBe(index + 1);
    });
  });

  it('uses the held-out CDM stream and produces the selected model decision', () => {
    const result = scoreLiveCdmSequence(stream.messages, model);
    expect(result.modelId).toBe('orbitshield-hgb-t2-v1');
    expect(result.score).toBeCloseTo(0.9134872137933265, 12);
    expect(result.triage).toBe('elevated');
    expect(result.inputCoverage).toBeCloseTo(75 / 76, 12);
    expect(result.imputedFeatures).toBe(1);
  });
});
