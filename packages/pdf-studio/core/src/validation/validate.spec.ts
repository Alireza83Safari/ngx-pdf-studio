import { sampleTemplate } from '../model/__fixtures__/sample-template';
import { isValidTemplate, validateTemplate } from './validate';

describe('template validation (§4, ADR-0007)', () => {
  it('accepts the bilingual sample template', () => {
    const result = validateTemplate(sampleTemplate);
    expect(result.success).toBe(true);
  });

  it('reports structured issues with dotted paths for malformed input', () => {
    const broken = {
      ...sampleTemplate,
      page: { ...sampleTemplate.page, margins: { top: 1, right: 1, bottom: 1 } },
    };
    const result = validateTemplate(broken);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.some((i) => i.path.startsWith('page.margins'))).toBe(true);
    }
  });

  it('rejects a non-object', () => {
    expect(validateTemplate(null).success).toBe(false);
    expect(validateTemplate('nope').success).toBe(false);
  });

  it('rejects an unknown element type via the discriminated union', () => {
    const broken = JSON.parse(JSON.stringify(sampleTemplate)) as Record<string, unknown>;
    const bands = broken['bands'] as Array<Record<string, unknown>>;
    const elements = bands[0]!['elements'] as Array<Record<string, unknown>>;
    elements[0]!['type'] = 'notARealType';
    expect(validateTemplate(broken).success).toBe(false);
  });

  it('isValidTemplate narrows the type for valid input', () => {
    const value: unknown = sampleTemplate;
    expect(isValidTemplate(value)).toBe(true);
  });
});
