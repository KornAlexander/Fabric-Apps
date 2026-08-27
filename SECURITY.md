# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through
[GitHub's private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
on this repository.

## Scope

These are demonstration applications. They are built to be deployed into **your own**
Microsoft Fabric workspace, under your own identity, with your own data.

Specifically:

- No app in this repository contains credentials, connection strings or tenant
  coordinates. Where an app needs a workspace or item id it reads it from the
  environment **with no default**.
- `rayfin/rayfin.yml` ships with loopback redirect URIs only. `rayfin up` adds your own
  host when you deploy.
- Sample data is either open data under the licence named in the app's README, or
  generated and badged as synthetic in the app itself.

If you find any of the above to be untrue in a file here, that is a security report and
is very welcome.
