# AGENTS.md — ShadowClaw DAW

> Guidance for AI agents working on ShadowClaw DAW, its WebMCP tools, and autonomous skills.

## Project Snapshot

In-browser Digital Audio Workstation built with [ShadowClaw](https://xt-ml.github.io/shadow-claw/), native Web Audio API synthesis, TC39 Signals, 11 mobile-first Web Components (`scdaw-*`), 25 declarative WebMCP tools (`scdaw_*`), and 6 autonomous skills.

## Layout

- `pages/main/index.html` — direct-rendered pinned Studio Workbench (`<scdaw-workbench>`)
- `pages/main/~/content/NN-*.md` — numbered documentation pages mapped in `pages/resources/routes.json`
- `pages/main/MEMORY.md`, `pages/main/RESET.md` — agent memory and reset prompt
- `pages/main/theme.css` — Material 3 dark/light studio theme tokens and responsive page layout rules
- `pages/resources/` — files copied to the site root (`robots.txt`, `llms.txt`, `AGENTS.md`, `README.md`, `manifest.json`, `404.html`, `assets/`)
- `pages/resources/routes.json` — maps source files to pretty URLs and drives `sitemap.xml` generation
- `shadow-claw.config.json` — site, branding, custom element scripts, enabled tools, and security settings
- `.agents/skills/`, `.agents/tools/`, `.agents/scripts/` — autonomous skills, 25 generated declarative tools, and Web Audio / Web Component scripts

## Conventions

- Add a page by creating the markdown file and adding a matching entry to `pages/resources/routes.json`; `sitemap.xml` is generated from it at build time. Do not hand-edit a sitemap.
- Update `llms.txt` when pages are added, renamed, or removed.
- Files in `pages/resources/` override ShadowClaw's defaults for the same root file.

## Commands

```bash
npx shadow-claw dev --open   # local dev server on http://127.0.0.1:8888
npx shadow-claw build        # build to dist/public
```

## Reference

- [ShadowClaw AGENTS.md](https://xt-ml.github.io/shadow-claw/AGENTS.md)
- [llms.txt](llms.txt)
