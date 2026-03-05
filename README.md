# Claude Guard

Visualize and manage [Claude Code](https://docs.anthropic.com/en/docs/claude-code) deny rules directly in the VS Code explorer.

## Features

- **Orange highlights** on files and folders that match deny rules in `.claude/settings.json`
- **Letter badges** showing which permissions are denied (E = Edit, R = Read, W = Write, B = Bash)
- **Tooltips** with the full list of denied actions
- **Right-click context menu** to quickly add or remove deny rules

### Commands (via right-click > Claude Guard)

| Command | What it does |
|---|---|
| Don't Touch | Denies Edit + Write + Bash |
| Deny Edit | Denies Edit |
| Deny Read | Denies Read |
| Deny Write | Denies Write |
| Deny Bash | Denies Bash |
| Remove from deny list | Removes a matching deny rule |

## How it works

Claude Guard reads the `permissions.deny` array from `.claude/settings.json` in your workspace root. Each entry follows the format `Action(glob-pattern)`, e.g.:

```json
{
  "permissions": {
    "deny": [
      "Edit(src/secrets/**)",
      "Bash(deploy.sh)"
    ]
  }
}
```

The extension watches for changes to this file and updates decorations automatically.

## Requirements

- VS Code 1.74.0+
- A `.claude/settings.json` file in your workspace (created automatically when you add rules via the context menu)

## License

MIT
