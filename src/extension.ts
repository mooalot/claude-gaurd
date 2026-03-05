import * as vscode from 'vscode';
import * as path from 'path';
import {
  ClaudeSettings,
  DenyRule,
  stripJsonTrailingCommas,
  parseDenyRules,
  matchPattern,
  fileMatchesRules,
  makeBadge,
  makeTooltip,
} from './rules';

class ClaudeGuardDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  private rules: DenyRule[] = [];
  private log: vscode.OutputChannel;

  constructor(log: vscode.OutputChannel) {
    this.log = log;
  }

  updateRules(rules: DenyRule[]) {
    this.rules = rules;
    this.log.appendLine(`Updated provider with ${rules.length} rules, firing change event`);
    this._onDidChangeFileDecorations.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    if (this.rules.length === 0) return undefined;

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) return undefined;

    const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
    const matchedRules = fileMatchesRules(relativePath, this.rules);

    if (matchedRules.length > 0) {
      const actions = matchedRules.map(r => r.action);
      return {
        badge: makeBadge(actions),
        tooltip: makeTooltip(actions),
        color: new vscode.ThemeColor('claudeGuard.deniedFileColor'),
        propagate: false,
      };
    }

    return undefined;
  }

  dispose() {
    this._onDidChangeFileDecorations.dispose();
  }
}

async function addDenyRule(uri: vscode.Uri, action: string, log: vscode.OutputChannel, silent = false) {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) return;

  const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
  const settingsPath = path.join(workspaceFolder.uri.fsPath, '.claude', 'settings.json');
  const settingsUri = vscode.Uri.file(settingsPath);

  let settings: Record<string, unknown> = {};
  try {
    const raw = Buffer.from(await vscode.workspace.fs.readFile(settingsUri)).toString('utf-8');
    settings = JSON.parse(stripJsonTrailingCommas(raw));
  } catch {
    // File doesn't exist or is invalid — start fresh
  }

  if (!settings.permissions || typeof settings.permissions !== 'object') {
    settings.permissions = {};
  }
  const perms = settings.permissions as Record<string, unknown>;
  if (!Array.isArray(perms.deny)) {
    perms.deny = [];
  }

  let targetPath = relativePath;
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type === vscode.FileType.Directory) {
      targetPath = relativePath + '/**';
    }
  } catch {
    // If stat fails, treat as file
  }

  const entry = `${action}(${targetPath})`;
  if ((perms.deny as string[]).includes(entry)) {
    if (!silent) vscode.window.showInformationMessage(`Already denied: ${entry}`);
    return;
  }

  (perms.deny as string[]).push(entry);
  const content = JSON.stringify(settings, null, 2) + '\n';
  await vscode.workspace.fs.writeFile(settingsUri, Buffer.from(content, 'utf-8'));
  log.appendLine(`Added deny rule: ${entry}`);
  if (!silent) vscode.window.showInformationMessage(`Added deny rule: ${entry}`);
}

async function removeDenyRule(uri: vscode.Uri, log: vscode.OutputChannel) {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) return;

  const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
  const settingsPath = path.join(workspaceFolder.uri.fsPath, '.claude', 'settings.json');
  const settingsUri = vscode.Uri.file(settingsPath);

  let settings: Record<string, unknown>;
  try {
    const raw = Buffer.from(await vscode.workspace.fs.readFile(settingsUri)).toString('utf-8');
    settings = JSON.parse(stripJsonTrailingCommas(raw));
  } catch {
    vscode.window.showWarningMessage('No .claude/settings.json found');
    return;
  }

  const perms = settings.permissions as Record<string, unknown> | undefined;
  if (!perms || !Array.isArray(perms.deny)) {
    vscode.window.showWarningMessage('No deny rules found');
    return;
  }

  const matching = (perms.deny as string[]).filter(entry => {
    const match = entry.match(/^(\w+)\((.+)\)$/);
    if (!match) return false;
    const pattern = match[2];
    return matchPattern(relativePath, pattern) || matchPattern(relativePath + '/dummy', pattern);
  });

  if (matching.length === 0) {
    vscode.window.showInformationMessage('No deny rules match this file');
    return;
  }

  const toRemove = matching.length === 1
    ? matching[0]
    : await vscode.window.showQuickPick(matching, { placeHolder: 'Select rule to remove' });

  if (!toRemove) return;

  perms.deny = (perms.deny as string[]).filter(e => e !== toRemove);
  const content = JSON.stringify(settings, null, 2) + '\n';
  await vscode.workspace.fs.writeFile(settingsUri, Buffer.from(content, 'utf-8'));
  log.appendLine(`Removed deny rule: ${toRemove}`);
  vscode.window.showInformationMessage(`Removed deny rule: ${toRemove}`);
}

async function loadRules(workspaceFolder: vscode.WorkspaceFolder, log: vscode.OutputChannel): Promise<DenyRule[]> {
  const settingsUri = vscode.Uri.joinPath(workspaceFolder.uri, '.claude', 'settings.json');
  log.appendLine(`Loading rules from: ${settingsUri.fsPath}`);
  try {
    const raw = Buffer.from(await vscode.workspace.fs.readFile(settingsUri)).toString('utf-8');
    log.appendLine(`Read ${raw.length} bytes from settings file`);
    const cleaned = stripJsonTrailingCommas(raw);
    const settings: ClaudeSettings = JSON.parse(cleaned);
    const rules = parseDenyRules(settings);
    log.appendLine(`Parsed ${rules.length} deny rules:`);
    for (const rule of rules) {
      log.appendLine(`  ${rule.action}(${rule.pattern})`);
    }
    return rules;
  } catch (e) {
    log.appendLine(`Error loading rules: ${e}`);
    return [];
  }
}

export async function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel('Claude Guard');
  context.subscriptions.push(log);

  log.appendLine('Claude Guard activating...');

  const provider = new ClaudeGuardDecorationProvider(log);
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(provider));
  context.subscriptions.push(provider);

  async function refreshRules() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
      log.appendLine('No workspace folders found');
      return;
    }

    log.appendLine(`Found ${folders.length} workspace folder(s)`);
    const allRules: DenyRule[] = [];
    for (const folder of folders) {
      const rules = await loadRules(folder, log);
      allRules.push(...rules);
    }
    provider.updateRules(allRules);
  }

  await refreshRules();

  const watcher = vscode.workspace.createFileSystemWatcher('**/.claude/settings.json');
  context.subscriptions.push(watcher);

  watcher.onDidChange(() => refreshRules());
  watcher.onDidCreate(() => refreshRules());
  watcher.onDidDelete(() => refreshRules());

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeGuard.dontTouch', async (uri: vscode.Uri) => {
      for (const action of ['Edit', 'Write', 'Bash']) {
        await addDenyRule(uri, action, log, true);
      }
      await refreshRules();
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
      const name = workspaceFolder ? path.relative(workspaceFolder.uri.fsPath, uri.fsPath) : uri.fsPath;
      vscode.window.showInformationMessage(`Claude Guard: Don't Touch applied to ${name}`);
    })
  );

  const actions = ['Edit', 'Read', 'Bash', 'Write'];
  for (const action of actions) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`claudeGuard.deny${action}`, async (uri: vscode.Uri) => {
        await addDenyRule(uri, action, log);
        await refreshRules();
      })
    );
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeGuard.removeDeny', async (uri: vscode.Uri) => {
      await removeDenyRule(uri, log);
      await refreshRules();
    })
  );

  log.appendLine('Claude Guard activated');
}

export function deactivate() {}
