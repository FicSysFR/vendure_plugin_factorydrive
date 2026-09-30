# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **Report a vulnerability** button on
[FicSysFR/vendure_plugin_factorydrive](https://github.com/FicSysFR/vendure_plugin_factorydrive/security/advisories/new).
Do not open a public issue. You will get an acknowledgement within a few working days.

## Scope

This package is a storage adapter. What it guarantees:

- every file name / identifier received from Vendure is validated before reaching Factorydrive:
  parent-directory segments, control characters, UNC paths and drive letters are rejected, and keys are
  normalised to relative, forward-slash locations (this matters on Vendure 3.0.0 – 3.0.7, whose `/assets`
  route does not sanitise paths);
- logs contain the disk name, the operation and an escaped, truncated key, plus the error name/code and the
  first line of its message; provider error objects (`raw`), configuration, credentials and file contents are
  never logged;
- no GraphQL field, public URL or signed URL is added: assets are served by the AssetServerPlugin route only;
- no dependency on a storage provider SDK.

Out of scope, handled by the application, Factorydrive or its drivers: bucket policies and ACLs, credential
management, TLS to the storage endpoint, driver-level path handling, and the AssetServerPlugin's own HTTP
behaviour (headers, content types, rate limiting).
