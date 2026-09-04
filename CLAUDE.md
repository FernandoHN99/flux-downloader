# Flux Downloader

Read **[AGENTS.md](AGENTS.md)** before changing anything. It is the single
authoritative guide for this repository: layout, commands, architecture,
invariants, and the refactor record that explains why the code is shaped the
way it is.

Each source domain carries its own `AGENTS.md` with the rules local to it:

| Domain | Guide |
|---|---|
| Entry points (service worker, content scripts) | [extension/src/entrypoints/AGENTS.md](extension/src/entrypoints/AGENTS.md) |
| Detection (page hooks, parsers, media identity) | [extension/src/detection/AGENTS.md](extension/src/detection/AGENTS.md) |
| Catalog (tab state, history, persistence) | [extension/src/catalog/AGENTS.md](extension/src/catalog/AGENTS.md) |
| Download (plan, concurrency, native client) | [extension/src/download/AGENTS.md](extension/src/download/AGENTS.md) |
| Shared (types, protocols, settings) | [extension/src/shared/AGENTS.md](extension/src/shared/AGENTS.md) |
| Popup UI | [extension/src/popup/AGENTS.md](extension/src/popup/AGENTS.md) |
| CoApp (native host) | [coapp/src/AGENTS.md](coapp/src/AGENTS.md) |

Read the domain guide for the folder you are editing, plus the root file. Do
not duplicate content between them: cross-cutting rules live in the root, and
local rules live in the domain guide.
