import type { CopilotProvider } from '../copilot/provider';
import { classifyPageWithAi } from './classify-ai';
import type { ExtractedPage, ExtractedText } from './types';

function txt(text: string, x: number, y: number, over: Partial<ExtractedText> = {}): ExtractedText {
  return { text, x, y, dir: 'ltr', fontSize: 10, width: text.length * 5, ...over };
}
function page(texts: ExtractedText[]): ExtractedPage {
  return { width: 595, height: 842, texts, segments: [], rects: [], warnings: [] };
}
/** A provider that always answers with a fixed string. */
const scripted = (reply: string): CopilotProvider => ({ complete: async () => reply });

describe('classifyPageWithAi', () => {
  // "Acme Corp" has no numeric/colon tell, so the heuristic leaves it static;
  // "1,000" (index 1) is a grouped number → a confident currency field.
  const sample = () => page([txt('Acme Corp', 40, 800), txt('1,000', 40, 780)]);

  it('promotes a heuristic-missed static run to a field', async () => {
    const res = await classifyPageWithAi(
      sample(),
      scripted('```json\n{"segments":[{"i":0,"role":"field","fieldPath":"company_name"}]}\n```'),
    );
    expect(res.texts[0]).toMatchObject({ role: 'field', fieldPath: 'company_name' });
  });

  it('does not override a confident heuristic field when onlyAmbiguous (default)', async () => {
    // index 1 value "1,000" is already a currency field; the model tries to
    // demote it — with onlyAmbiguous the override is ignored.
    const res = await classifyPageWithAi(
      sample(),
      scripted('{"segments":[{"i":1,"role":"static"}]}'),
    );
    // find the value cell (role field from heuristic)
    const value = res.texts.find((t) => t.kind === 'currency');
    expect(value).toBeTruthy();
  });

  it('can re-label everything when onlyAmbiguous is false', async () => {
    const res = await classifyPageWithAi(
      sample(),
      scripted('{"segments":[{"i":0,"role":"static"},{"i":1,"role":"static"}]}'),
      { onlyAmbiguous: false },
    );
    expect(res.texts.every((t) => t.role === 'static')).toBe(true);
    // demotion clears stale field metadata
    expect(res.texts[1]!.kind).toBeUndefined();
  });

  it('falls back to the heuristic when the provider throws', async () => {
    const boom: CopilotProvider = {
      complete: async () => {
        throw new Error('network down');
      },
    };
    const res = await classifyPageWithAi(sample(), boom);
    expect(res.texts[0]!.role).toBe('static'); // unchanged heuristic
    expect(res.texts.find((t) => t.kind === 'currency')).toBeTruthy();
  });

  it('falls back on malformed JSON and ignores out-of-range indices', async () => {
    const res = await classifyPageWithAi(sample(), scripted('not json at all'));
    expect(res.texts[0]!.role).toBe('static');

    const res2 = await classifyPageWithAi(
      sample(),
      scripted('{"segments":[{"i":99,"role":"field"},{"i":0,"role":"field","fieldPath":"c"}]}'),
    );
    expect(res2.texts[0]).toMatchObject({ role: 'field', fieldPath: 'c' });
  });

  it('sends the heuristic guess to the provider', async () => {
    let seenSystem = '';
    let seenUser = '';
    const spy: CopilotProvider = {
      complete: async (system, messages) => {
        seenSystem = system;
        seenUser = messages[0]!.content;
        return '{"segments":[]}';
      },
    };
    await classifyPageWithAi(sample(), spy);
    expect(seenSystem).toContain('snake_case');
    expect(seenUser).toContain('"guess"');
    expect(seenUser).toContain('Acme Corp');
  });
});
