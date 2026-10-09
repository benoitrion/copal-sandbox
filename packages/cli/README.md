# @copal/cli

Copal — your technical mentor, inside your IDE. The command line behind the IntelliJ and VS Code plugins, the
pre-commit hook, the Claude Code hooks and CI.

```bash
npm i -D @copal/cli
npx copal hook install            # pre-commit check against .copalrules
npx copal hook install --claude   # Claude Code: request check + AI usage summary
npx copal reflect "Add VAT to invoice totals"   # agree examples first → .copal/brief.md
npx copal review                  # review my change: hint cards vs main, local only
npx copal scope-check             # what goes beyond the brief?
```

Docs: https://github.com/benoitrion/copal-sandbox
