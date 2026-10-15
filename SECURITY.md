# Security policy

## Reporting a vulnerability

Please report it **privately**, using GitHub's [Report a vulnerability](https://github.com/FernandoHN99/flux-downloader/security/advisories/new) form on the Security tab. Do not open a public issue.

Include what you found, how to reproduce it, and what it lets someone do. You will get an answer as soon as a maintainer can; this is a volunteer project, so please allow a few days.

## What matters most here

Flux has three parts that trust each other, so these are the places to look:

- **The native messaging host** (the companion app). Only the extension's fixed ID may start it (`allowed_origins`), it speaks over local stdio and listens on no network port, and the file API it exposes is deliberately narrow. Anything that lets a web page or another extension reach it, or write outside the download folder, is a vulnerability.
- **The installers.** The Windows installer downloads FFmpeg and yt-dlp over HTTPS and checks a pinned SHA-256; `scripts/install.sh` checks yt-dlp against the checksums it publishes. A way around those checks is a vulnerability.
- **The page-world hooks.** They run inside every page. Anything that leaks data from a page to another origin, or lets a page read the extension's state, is a vulnerability.

## Supported versions

Only the latest release gets fixes.

## Not vulnerabilities

Flux does not bypass DRM and does not claim to. It also cannot stop you saving something you should not: that is your responsibility, not a flaw.
