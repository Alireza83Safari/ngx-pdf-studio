import { CURRENT_SCHEMA_VERSION } from '../model/template';
import { migrateToCurrent, type MigrationStep, type RawTemplate } from './migrate';

describe('schema migration pipeline (§4)', () => {
  it('is a no-op for a template already at the current version', () => {
    const raw: RawTemplate = { schemaVersion: CURRENT_SCHEMA_VERSION, bands: [] };
    expect(migrateToCurrent(raw)).toEqual(raw);
  });

  it('applies a chain of steps up to the current version', () => {
    const steps: MigrationStep[] = [
      { from: '0.8.0', to: '0.9.0', migrate: (t) => ({ ...t, addedInA: true }) },
      { from: '0.9.0', to: CURRENT_SCHEMA_VERSION, migrate: (t) => ({ ...t, addedInB: true }) },
    ];
    const out = migrateToCurrent({ schemaVersion: '0.8.0' }, steps);
    expect(out['schemaVersion']).toBe(CURRENT_SCHEMA_VERSION);
    expect(out['addedInA']).toBe(true);
    expect(out['addedInB']).toBe(true);
  });

  it('handles a template with no schemaVersion (undefined) without throwing', () => {
    const out = migrateToCurrent({ bands: [] }, []);
    expect(out['schemaVersion']).toBeUndefined();
  });

  it('stops cleanly when no step matches the current version', () => {
    const out = migrateToCurrent({ schemaVersion: '0.1.0' }, []);
    expect(out['schemaVersion']).toBe('0.1.0');
  });

  it('terminates on a cyclic chain rather than looping forever', () => {
    const steps: MigrationStep[] = [
      { from: 'a', to: 'b', migrate: (t) => t },
      { from: 'b', to: 'a', migrate: (t) => t },
    ];
    const out = migrateToCurrent({ schemaVersion: 'a' }, steps);
    // Bounded walk: it does not hang, and never reaches the current version.
    expect(out['schemaVersion']).not.toBe(CURRENT_SCHEMA_VERSION);
  });
});
