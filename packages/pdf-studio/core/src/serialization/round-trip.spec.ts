import { sampleTemplate } from '../model/__fixtures__/sample-template';
import { deserializeTemplate, importTemplate, serializeTemplate } from './serialize';

describe('template serialization round-trip (§4)', () => {
  it('deserialize(serialize(t)) deep-equals the original template', () => {
    const restored = deserializeTemplate(serializeTemplate(sampleTemplate));
    expect(restored).toEqual(sampleTemplate);
  });

  it('serialize(deserialize(x)) === x (string-level lossless round-trip)', () => {
    const x = serializeTemplate(sampleTemplate);
    expect(serializeTemplate(deserializeTemplate(x))).toBe(x);
  });

  it('pretty-printed output also round-trips losslessly', () => {
    const x = serializeTemplate(sampleTemplate, { indent: 2 });
    expect(serializeTemplate(deserializeTemplate(x), { indent: 2 })).toBe(x);
  });

  it('preserves unknown forward-compatible fields through deserialize', () => {
    const withUnknown = {
      ...(JSON.parse(serializeTemplate(sampleTemplate)) as Record<string, unknown>),
      futureField: { hello: 'world' },
    };
    const json = JSON.stringify(withUnknown);
    const restored = deserializeTemplate(json) as unknown as Record<string, unknown>;
    expect(restored['futureField']).toEqual({ hello: 'world' });
  });

  it('the untrusted import path validates a serialized template successfully', () => {
    const result = importTemplate(serializeTemplate(sampleTemplate));
    expect(result.success).toBe(true);
  });
});
