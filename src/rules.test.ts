import { describe, test, expect } from 'vitest';
import {
  stripJsonTrailingCommas,
  parseDenyRules,
  matchPattern,
  fileMatchesRules,
  makeBadge,
  makeTooltip,
} from './rules';

describe('stripJsonTrailingCommas', () => {
  test('removes trailing comma before closing bracket', () => {
    expect(stripJsonTrailingCommas('["a","b",]')).toBe('["a","b"]');
  });

  test('removes trailing comma before closing brace', () => {
    expect(stripJsonTrailingCommas('{"a":1,}')).toBe('{"a":1}');
  });

  test('handles trailing comma with whitespace and newlines', () => {
    const input = '["a",\n  "b",\n  ]';
    const result = stripJsonTrailingCommas(input);
    expect(JSON.parse(result)).toEqual(['a', 'b']);
  });

  test('leaves valid JSON unchanged', () => {
    const input = '{"a": [1, 2, 3]}';
    expect(stripJsonTrailingCommas(input)).toBe(input);
  });
});

describe('parseDenyRules', () => {
  test('parses Edit and Read rules', () => {
    const settings = {
      permissions: {
        deny: ['Edit(.claude/settings.json)', 'Read(**/node_modules/**)'],
      },
    };
    expect(parseDenyRules(settings)).toEqual([
      { action: 'Edit', pattern: '.claude/settings.json' },
      { action: 'Read', pattern: '**/node_modules/**' },
    ]);
  });

  test('returns empty array when no permissions', () => {
    expect(parseDenyRules({})).toEqual([]);
  });

  test('returns empty array when deny is not an array', () => {
    expect(parseDenyRules({ permissions: {} })).toEqual([]);
  });

  test('skips non-string entries', () => {
    const settings = {
      permissions: {
        deny: ['Edit(file.ts)', null, 42, 'Read(other.ts)'] as string[],
      },
    };
    expect(parseDenyRules(settings)).toEqual([
      { action: 'Edit', pattern: 'file.ts' },
      { action: 'Read', pattern: 'other.ts' },
    ]);
  });

  test('skips malformed entries', () => {
    const settings = {
      permissions: {
        deny: ['Edit(file.ts)', 'not a rule', 'NoParens'],
      },
    };
    expect(parseDenyRules(settings)).toEqual([
      { action: 'Edit', pattern: 'file.ts' },
    ]);
  });
});

describe('matchPattern', () => {
  test('matches exact relative path', () => {
    expect(matchPattern('.claude/settings.json', '.claude/settings.json')).toBe(true);
  });

  test('matches glob with **', () => {
    expect(matchPattern('frontend/package-lock.json', '**/package-lock.json')).toBe(true);
  });

  test('matches dotfiles with dot option', () => {
    expect(matchPattern('.env.local', '**/.env*')).toBe(true);
  });

  test('strips leading slash from absolute-style patterns', () => {
    expect(matchPattern('frontend/app/api/prompt/route.ts', '/frontend/app/api/prompt/*')).toBe(true);
  });

  test('does not match unrelated paths', () => {
    expect(matchPattern('src/index.ts', 'frontend/**')).toBe(false);
  });

  test('matches nested paths with **', () => {
    expect(matchPattern('frontend/app/api/prompt/staged/route.ts', 'frontend/app/api/prompt/**')).toBe(true);
  });
});

describe('fileMatchesRules', () => {
  const rules = [
    { action: 'Edit', pattern: 'frontend/app/api/prompt/**' },
    { action: 'Write', pattern: 'frontend/app/api/prompt/**' },
    { action: 'Bash', pattern: 'frontend/app/api/prompt/**' },
    { action: 'Edit', pattern: '.claude/settings.json' },
    { action: 'Read', pattern: '**/node_modules/**' },
  ];

  test('matches a file inside a denied folder', () => {
    const matched = fileMatchesRules('frontend/app/api/prompt/route.ts', rules);
    expect(matched.map(r => r.action)).toEqual(['Edit', 'Write', 'Bash']);
  });

  test('matches the denied folder itself via dummy path', () => {
    const matched = fileMatchesRules('frontend/app/api/prompt', rules);
    expect(matched.map(r => r.action)).toEqual(['Edit', 'Write', 'Bash']);
  });

  test('matches exact file path', () => {
    const matched = fileMatchesRules('.claude/settings.json', rules);
    expect(matched.map(r => r.action)).toEqual(['Edit']);
  });

  test('returns empty for non-matching path', () => {
    expect(fileMatchesRules('src/index.ts', rules)).toEqual([]);
  });

  test('deduplicates actions from multiple matching rules', () => {
    const dupeRules = [
      { action: 'Edit', pattern: 'src/**' },
      { action: 'Edit', pattern: 'src/lib/**' },
    ];
    const matched = fileMatchesRules('src/lib/utils.ts', dupeRules);
    expect(matched).toHaveLength(1);
    expect(matched[0].action).toBe('Edit');
  });

  test('parent folder does not match if pattern is deeper', () => {
    expect(fileMatchesRules('frontend/app/api', rules)).toEqual([]);
  });
});

describe('makeBadge', () => {
  test('returns E for Edit', () => {
    expect(makeBadge(['Edit'])).toBe('E');
  });

  test('returns R for Read', () => {
    expect(makeBadge(['Read'])).toBe('R');
  });

  test('returns W for Write', () => {
    expect(makeBadge(['Write'])).toBe('W');
  });

  test('returns B for Bash', () => {
    expect(makeBadge(['Bash'])).toBe('B');
  });

  test('truncates to 2 chars for multiple actions', () => {
    expect(makeBadge(['Edit', 'Write', 'Bash'])).toBe('EW');
  });

  test('shows both letters for two actions', () => {
    expect(makeBadge(['Edit', 'Read'])).toBe('ER');
  });

  test('returns empty string for no actions', () => {
    expect(makeBadge([])).toBe('');
  });

  test('falls back to first letter for unknown action', () => {
    expect(makeBadge(['Custom'])).toBe('C');
  });
});

describe('makeTooltip', () => {
  test('formats single action', () => {
    expect(makeTooltip(['Edit'])).toBe('Claude: denied (Edit)');
  });

  test('formats multiple actions', () => {
    expect(makeTooltip(['Edit', 'Write', 'Bash'])).toBe('Claude: denied (Edit, Write, Bash)');
  });
});
