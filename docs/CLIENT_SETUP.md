# Client Environment Setup

> **Audience:** ElasticIT support staff who set up a client's machine before the client uses this template with Claude Code.
>
> Clients are non-technical (owners, office managers, operations leads, technicians). They will not install any of these tools themselves. ElasticIT does the install up front, then hands off a working environment.

> ⚠️ **Critical: clients use Claude Code with the "Local" environment selected.** Claude Code (download: [claude.com/claude-code](https://claude.com/claude-code)) has an environment selector at the bottom-left of its window — the default is a Cloud sandbox that has no access to the client's PC. Before you hand the environment off, click the selector, choose **Local**, and pick the project folder. The session-start prerequisite hook detects the Cloud case and walks the client through flipping the selector themselves, but it's better to leave it set to Local during onboarding so they never see the warning.

The session-start prerequisite hook (`.claude/hooks/check-prereqs.sh`) blocks Claude from proceeding if any item in section 1 is missing — or if it detects the Cloud environment instead of Local. Follow the checklist below to avoid both failures.

---

## 1. Mandatory installs

These five must all be present before the client opens Claude Code on the template.

| # | Tool | Why | Install |
|---|---|---|---|
| 1 | **Node.js v22 LTS** (with npm) | Runs every script in the template | [nodejs.org](https://nodejs.org) — pick "LTS" |
| 2 | **Git** | Local version control + the scaffold script + Git Bash on Windows | Windows: [Git for Windows](https://gitforwindows.org). macOS: `brew install git` (or system git). Linux: `apt install git` / `dnf install git` |
| 3 | **Container runtime** — Docker Desktop **or** Podman | Runs the local test stack | Docker Desktop: [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/). Podman: [podman.io](https://podman.io). Use Podman if the client's company restricts Docker Desktop's licensing |
| 4 | **Supabase CLI v2.84+** | Orchestrates the local test stack | Windows: `scoop install supabase`. macOS: `brew install supabase/tap/supabase`. Linux: download from [github.com/supabase/cli/releases](https://github.com/supabase/cli/releases) |
| 5 | **Claude Code CLI** + Claude subscription | The whole point — clients drive the template through Claude Code | [claude.com/claude-code](https://claude.com/claude-code). Sign the client into their Claude subscription (Pro or Max) |

## 2. Code editor (recommended)

The client will see what Claude is editing through this — pick one:

- **VS Code** ([code.visualstudio.com](https://code.visualstudio.com)) with the Claude Code extension
- **Cursor** ([cursor.com](https://cursor.com)) — Claude Code is built in

**On Windows**, set the editor's integrated terminal to **Git Bash** (not PowerShell or Command Prompt). The hooks are bash scripts and won't run otherwise.

## 3. Per-platform setup notes

### Windows

- Git Bash comes with Git for Windows (#2 above). No separate install.
- Set Git Bash as the integrated terminal default in VS Code/Cursor.
- **If using Podman:** also set the environment variable `DOCKER_HOST=npipe:////./pipe/podman-machine-default` so the Supabase CLI can find Podman.

### macOS / Linux

- bash is the default shell — no extra setup.

## 4. The template itself

Clone the template into a folder the client can find easily — for example, `Documents/elasticit-app-template/`. The folder will stay clean; on the client's first message Claude will scaffold a fresh sibling folder named after their app, leaving the template clone untouched.

## 5. Network requirements

The client's network must be able to reach:

| Host | Used for |
|---|---|
| `registry.npmjs.org` | `npm install` fetches React, Tailwind, Vite, etc. |
| `api.anthropic.com`, `claude.ai` | Claude Code authentication and inference |
| `registry-1.docker.io`, `hub.docker.com` | Docker pulls Supabase container images on first `npm run local-dev` |
| `github.com/supabase/cli/releases` | **Linux only**, during initial Supabase CLI install |

**Worth confirming with the client's IT in advance** for enterprise networks that block these by default.

The template is otherwise self-contained — `@elasticit-llc/shell`, `@elasticit-llc/app-bridge`, and `@elasticit-llc/ui-kit` are bundled inside the template under `vendor/`, so the client does not need access to GitHub Packages or any other ElasticIT repository.

## 6. Disk space

| What | Approximate |
|---|---|
| Project dependencies after `npm install` | ~500 MB |
| Supabase container images on first `npm run local-dev` | ~3 GB |
| **Total to plan for** | ~4 GB free |

## 7. Smoke test before handoff

Open the cloned folder in the client's editor, start a Claude Code session, and confirm:

1. The session starts silently — the prerequisite hook **does not** print a "STOP, contact ElasticIT" message. (If it does, install whatever it lists and re-test.)
2. Claude greets the client and asks what to call the app — or, if you give it a description like "build me an app called Test", it proceeds to scaffold without asking.
3. After a name is given, a sibling folder appears next to the template clone with the project files copied in.
4. Optional but recommended: ask Claude to run `npm run local-dev`. The local test shell should boot at `http://localhost:3000` within a couple of minutes (longer on first run while Docker pulls images).

If all four pass, the environment is ready for the client.

## 8. What ElasticIT keeps off the client's machine

| Item | Why |
|---|---|
| Anthropic API keys with billing access | The client uses their own Claude subscription instead |
| Service role keys, vault credentials, portal secrets | Those live in the shell's Credential Vault, not on the client's disk |
| The internal scaffolding tool (`create-elasticit-app`) | Internal-only; clients use this template, not the internal tool |
| The shell repo (`elasticit-shell`) | Managed by ElasticIT; clients do not have write access |

---

## Troubleshooting common install issues

**"node: command not found" after install on Windows**
The Node.js installer didn't add itself to PATH. Restart the terminal, or reboot if a fresh terminal still doesn't see it.

**Supabase CLI v2.83 or older**
Older versions use a `[project]` block in `config.toml` that the template's setup expects to be the new top-level `project_id` format. Upgrade to v2.84+.

**`docker info` errors with "cannot connect to daemon" (Docker Desktop)**
Docker Desktop is installed but not running. Open it from the Start menu / Applications and wait for the whale icon to stop animating.

**`podman info` errors on Windows**
The Podman machine isn't started. Run `podman machine init` once (one-time setup), then `podman machine start` (every reboot).

**Git Bash not available in VS Code's terminal dropdown**
VS Code didn't auto-detect it. Settings → Terminal → Integrated → Default Profile (Windows) → set to "Git Bash". Restart VS Code.
