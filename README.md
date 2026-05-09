<!-- TODO: replace the Twemoji src below with assets/cooked.png once you have a custom hero image -->

<div align="center">

<img src="https://cdn.jsdelivr.net/gh/twitter/twemoji@v14.0.2/assets/svg/1f958.svg" width="160" height="160" alt="cooked" />

<h1>cooked</h1>

<p><em>Stop babysitting Claude.</em></p>

<p>
<img alt="GitHub stars" src="https://img.shields.io/github/stars/Marcelfedz/cooked?style=flat-square" />
<img alt="Last commit" src="https://img.shields.io/github/last-commit/Marcelfedz/cooked?style=flat-square" />
<img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green?style=flat-square" />
<img alt="Platform: macOS · Linux" src="https://img.shields.io/badge/platform-macOS%20%C2%B7%20Linux-blue?style=flat-square" />
</p>

<p>
<a href="#demo">Demo</a> ·
<a href="#install">Install</a> ·
<a href="#what-it-does">What it does</a> ·
<a href="#how-it-works">How it works</a> ·
<a href="#faq">FAQ</a>
</p>

</div>

---

> **Are you cooked staring at the screen, waiting for Claude to finish?**

You shouldn't have to babysit Claude Code.

`cooked` is a tiny extension for [Claude Code](https://docs.claude.com/en/docs/claude-code) that adds two things to your terminal:

1. **A live progress meter** at the bottom of the window — so you can see at a glance whether Claude is still cooking or stuck.
2. **A smart finish notification** that tells you exactly what got done, and grabs your attention loudly when you've walked away.

---

## The pain we're solving

You ask Claude to build something. It starts working. Two minutes pass. You glance over — still going. You grab coffee. You come back. Five more minutes. Was it stuck? Did it finish 30 seconds ago and you've been staring at nothing?

If you've ever said *"I'm so cooked from waiting on Claude"*, this is for you.

---

## Demo

**While Claude is cooking** — your status line shows a live activity meter so you know it's still moving:

```
🔥 🥘 12 ops · 2 cooks · 2m14s  ·  opus 4.7
```

> *12 tools used · 2 sub-agents working in parallel · 2 minutes 14 seconds elapsed*

**When Claude finishes a quick task** — you get a soft banner that auto-dismisses:

```
┌────────────────────────────────────────┐
│ Claude Code                            │
│ Cooked!                                │
│ 9 ops · 35s · ✅                       │
└────────────────────────────────────────┘
```

**When Claude finishes a long task (≥ 2 min — you probably walked away)** — you get a **sticky alert** that won't go away until you click it. So you can leave the room and never miss the finish:

```
╭───────────────────────────────────────╮
│           Claude Code 🥘              │
│                                       │
│  Cooked! — 47 ops · 3 cooks · 6m12s   │
│                  · ✅                 │
│                                       │
│                  [ OK ]               │
╰───────────────────────────────────────╯
```

The ✅ / ❌ icon at the end tells you whether everything went smoothly or there were errors — so you can decide whether to come back urgently or finish your coffee.

---

## Install

**One line — copy, paste, restart Claude Code:**

```bash
curl -fsSL https://raw.githubusercontent.com/Marcelfedz/cooked/main/install.sh | bash
```

**Or via the Claude Code marketplace:**

```bash
claude plugin marketplace add Marcelfedz/cooked
claude plugin install cooked@cooked
```

That's it. You're done.

---

## What it does

Three things, all aimed at the same pain:

| | What it does | Why you'll like it |
|---|---|---|
| 🔥 **Live progress meter** | Counts every tool call and active sub-agent in real time, ticking up at the bottom of your terminal | One glance tells you if Claude is still working or wedged |
| 🥘 **Rich finish notification** | Replaces the boring "Response ready" with a real summary: ops · cooks · duration · ✅/❌ | Decide from the banner whether you need to come back |
| 📣 **Adaptive alert level** | Quiet banner under 2 min · sticky modal alert over 2 min | Walk away from long jobs without missing the finish |

---

## How it works

`cooked` is a Claude Code plugin that wires six hook events:

| Event | What we do |
|---|---|
| `UserPromptSubmit` | Note the start time, reset stat counters |
| `PostToolUse` | Append a tally line to `ops.log` |
| `PostToolUseFailure` | Append a tally line to `errors.log` |
| `SubagentStart` / `SubagentStop` | Track active sub-agents (the "cooks") |
| `Stop` | Read all stats, format the summary, fire the right notification, clean up |

The status line script reads those same files every second and renders the live meter. State is stored in `/tmp/paella-<session-id>-*` — scoped per session, automatically cleaned up.

The whole plugin is ~150 lines of Bash. No external dependencies, no Python, no Node. Just the tools every Mac and Linux box already ships with.

---

## FAQ

**Q: I'm not very technical. Is this safe?**
Yes. `cooked` is open-source — every line of code is here in this repo. It only does three things: count tool calls Claude makes, time how long each turn takes, and show macOS notifications. It never sends your data anywhere. The installer makes a backup of your settings before changing anything.

**Q: Will this slow Claude down?**
No. The progress tracking adds about 10 milliseconds per tool call — completely invisible. The status line refreshes once a second, lighter than your average system clock.

**Q: How do I remove it?**

```bash
bash ~/.claude/plugins/marketplaces/cooked/uninstall.sh
```

That's it — your original settings are restored from the backup.

**Q: Does it work on Windows?**
The progress meter works everywhere. Notifications are macOS-first (using the built-in notification system), with basic Linux support via `notify-send`. Windows notifications are coming in a later release.

**Q: Will it interfere with other Claude Code plugins or hooks?**
No. `cooked` adds its hooks alongside whatever you already have — nothing gets replaced. The only setting it touches is your status line, and only with your existing setup backed up.

**Q: Why "cooked"?**
Two reasons. One: when Claude finishes a task, it's *cooked* — like food that's done. Two: when you're staring at a long-running terminal, *you're* cooked — exhausted from the wait. The name covers both ends of the experience.

---

## Configuration

| Env var | Default | What it does |
|---|---|---|
| `COOKED_ALERT_THRESHOLD` (or `PAELLA_ALERT_THRESHOLD`) | `120` | Seconds. Turns longer than this get a sticky modal alert instead of a banner. Lower = louder. |
| `COOKED_REPO` | `Marcelfedz/cooked` | Override the GitHub repo the installer pulls from (for forks). |

Set them in your shell profile (`~/.zshrc`, `~/.bashrc`).

---

## Platform support

| | Status line | Quick banner | Sticky alert |
|---|---|---|---|
| macOS | ✅ | ✅ | ✅ |
| Linux | ✅ | ✅ via `notify-send` | ⚠️ urgent persistent (closest available) |
| Windows | ✅ | ❌ planned | ❌ planned |

---

## Uninstall

```bash
bash ~/.claude/plugins/marketplaces/cooked/uninstall.sh
```

Or manually:

```bash
claude plugin uninstall cooked
claude plugin marketplace remove cooked
cp ~/.claude/settings.json.before-cooked ~/.claude/settings.json
rm -rf ~/.claude/plugins/marketplaces/cooked
```

---

## License

MIT. Use it, fork it, ship it. See [`LICENSE`](./LICENSE).

---

<div align="center">
<sub><em>"Caveman saves your tokens. cooked saves your attention."</em></sub>
</div>
