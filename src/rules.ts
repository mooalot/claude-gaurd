import { minimatch } from 'minimatch';

export interface ClaudeSettings {
  permissions?: {
    deny?: string[];
  };
}

export interface DenyRule {
  action: string;
  pattern: string;
}

const ACTION_BADGES: Record<string, string> = {
  Edit: 'E',
  Read: 'R',
  Write: 'W',
  Bash: 'B',
};

export function stripJsonTrailingCommas(text: string): string {
  return text.replace(/,\s*([\]}])/g, '$1');
}

export function parseDenyRules(settings: ClaudeSettings): DenyRule[] {
  const deny = settings?.permissions?.deny;
  if (!Array.isArray(deny)) return [];

  const rules: DenyRule[] = [];
  for (const entry of deny) {
    if (typeof entry !== 'string') continue;
    const match = entry.match(/^(\w+)\((.+)\)$/);
    if (match) {
      rules.push({ action: match[1], pattern: match[2] });
    }
  }
  return rules;
}

export function matchPattern(filePath: string, pattern: string): boolean {
  if (minimatch(filePath, pattern, { dot: true })) {
    return true;
  }
  if (pattern.startsWith('/') && minimatch(filePath, pattern.slice(1), { dot: true })) {
    return true;
  }
  return false;
}

export function fileMatchesRules(relativePath: string, rules: DenyRule[]): DenyRule[] {
  const matched: DenyRule[] = [];
  for (const rule of rules) {
    if (matchPattern(relativePath, rule.pattern) || matchPattern(relativePath + '/dummy', rule.pattern)) {
      if (!matched.some(m => m.action === rule.action)) {
        matched.push(rule);
      }
    }
  }
  return matched;
}

export function makeBadge(actions: string[]): string {
  if (actions.length === 0) return '';
  // Join first letters, max 2 chars for VSCode badge limit
  return actions.map(a => ACTION_BADGES[a] || a[0]).join('').slice(0, 2);
}

export function makeTooltip(actions: string[]): string {
  return `Claude: denied (${actions.join(', ')})`;
}
