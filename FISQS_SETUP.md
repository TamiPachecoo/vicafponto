# VICAF FISQS

Adds a mobile-first document catalog to the existing HTML app, accessible through a new FISQS card in Menu. Existing Ponto, Ferramentas and Perfil pages are unchanged. The private import manifest describes the supplied PDFs with SHA-256 checksums. Original files and the private manifest are not committed to this public repository.

## Current activation status

Implementation and local permission tests are included. Production is not configured: the connected Supabase account cannot access VICAF project `xuonzwvqqwbgcedidyie`. Do not merge/deploy the new navigation until the steps below and a live smoke test succeed.

## Access model

The existing app has a browser-only shared supervisor password. FISQS does not reuse it for upload authorization. This new module uses Supabase Auth email/password and an explicit `fisqs_members` allowlist for readers, supervisors and admins. All employees accessing FISQS need a provisioned account; this login applies only to FISQS. Sessions stay in memory and are cleared on reload/sign-out. There is no self-registration or self-promotion UI.

Readers can search and view registered revisions. Supervisors/admins can upload new PDFs, register products, add revisions and optionally write source-checked summaries. Members cannot delete registered files or rewrite revision history. Member provisioning is an administrator operation in the database, not an in-app supervisor feature. Revoking a membership blocks subsequent API calls; previously issued document URLs last up to five minutes.

## Activate on the correct backend

1. Connect a Supabase account with access to VICAF project `xuonzwvqqwbgcedidyie` (not AgencyOS). Verify project ref before applying anything.
2. Inspect for pre-existing `fisqs_*` objects. Run `db/fisqs_setup.sql` once using the project's SQL editor or migration tooling. It is transactional and additive. If tables already exist, stop and inspect rather than dropping/recreating them. If using Supabase CLI migrations, create the migration with `supabase migration new fisqs_catalog`, copy the SQL into that file and apply via the project's normal process; do not apply both paths. Run Supabase security/performance advisors after setup.
3. Provision users through Supabase Auth's admin invite flow and let each user set their password. Use authorized company email addresses. Add each verified Auth user to the FISQS allowlist with the appropriate role, for example:

```sql
-- Replace with the actual provisioned account; do not run with a placeholder.
insert into public.fisqs_members(user_id, role)
select id, 'supervisor' from auth.users where email = 'SUPERVISOR_EMAIL';
-- Repeat with role 'reader' for employees or 'admin' for an administrator.
```

4. Obtain `vicaf-fisqs-import-manifest.json` from the private deliverables in the ChatGPT conversation. Save a local copy as `scripts/fisqs_manifest.json` (gitignored). Keep it out of public repositories. Validate the original ZIP locally (no credentials/network required):

```sh
python scripts/import_fisqs.py /absolute/path/to/FISQS-20261020T211444Z-1-001.zip
```

5. Set `SUPABASE_SERVICE_ROLE_KEY` in the local shell/secret manager for VICAF only. Never put it in the app, GitHub, a command transcript or chat. Run the same import with `--apply`. The importer is fixed to VICAF's URL, checks all 27 checksums before writes, requires a private bucket, never overwrites files, skips verified completed imports, and verifies every registered revision. Interrupted imports can be rerun. It only writes `fisqs_products`, `fisqs_revisions` and the `fisqs` bucket. Original PDFs, emails and secrets are not included in source control.
6. Check product names, variants and revision labels against the originals before release. Month-only dates are stored in the revision label, not converted to an invented calendar day. Generic references are distinguished from product-specific safety sheets. Variants and paint components remain separate. Certificates/lots documents are distinguished from safety sheets. No chemical-use or safety instructions have been generated or inferred. All imported summaries are blank.
7. Serve this branch and perform the live smoke test below. Only then merge/deploy. If the project is GitHub Pages, confirm the new page at the existing `/vicafponto/` base. The service worker supports root and subpath deployments and caches shell files only.

## Live smoke test

- Reader: sign in, search `271`, `oleo`, manufacturer and code; filter a category; open and download original PDFs, including one scanned PDF. Verify all 27 imported records and known old revision labels.
- Reader and unapproved account: attempts to insert rows/upload PDFs must fail server-side, even outside the UI.
- Supervisor: upload a disposable test PDF, add a revision to that same test product, verify current version plus history; inspect uploaded_by/reviewed_by. No live client records should be changed for this test.
- Reject disguised non-PDF, files over 15 MB, duplicate checksums and an older known revision date. Do not publish an optional summary until its source-check box is checked.
- Simulate registration failure: error remains visible; previous versions are still accessible. Confirm no registered file is deleted during cleanup. Check and clean up only explicitly identified disposable test records through admin tooling.
- Sign out and confirm the catalog/PDF frame are cleared. Inspect Cache Storage: no Auth responses, Storage responses, signed PDF URLs or user document data should be present. Files already downloaded to a device are outside the app cache.
- Verify mobile (390 px) and desktop layouts. Reopen Ponto, Perfil and Ferramentas, and confirm their normal behavior. This change does not alter their API calls, data or payroll calculations.

## Local automated checks

No production database is used by these tests. Test-only dependencies can be installed in a temporary directory:

```sh
npm install --prefix /tmp/vicaf-fisqs-test --no-audit --no-fund @electric-sql/pglite@0.3.14 playwright@1.62.1
```

Run `node --check fisqs.js`, `node --check sw.js` and `git diff --check`.

`PGLITE_PATH=/tmp/vicaf-fisqs-test/node_modules/@electric-sql/pglite node tests/fisqs-db.mjs` executes the actual SQL in embedded PostgreSQL, with stub Auth/Storage schemas and real PostgreSQL RLS. It checks approved/unapproved/anonymous roles, upload ownership, protected history, reviewer attribution and atomic rollback. It does not substitute for testing deployed Supabase Storage/Auth.

`CODEX_PRIMARY_RUNTIME_NODE_MODULES=/tmp/vicaf-fisqs-test/node_modules node tests/fisqs-ui.cjs` uses Playwright with mocked API responses against an automatically started test server at `http://127.0.0.1:8765` (install the matching Chromium using Playwright's CLI). It checks reader and supervisor flows, search, XSS-safe document text, history, file validation, signed URL rendering and error recovery. Screenshots go to `/tmp/vicaf-fisqs-review/`.

## Scope and limitations

This version includes searchable product metadata, originals, upload, signed download, categories, optional reviewed summaries and revision history. It does not automatically OCR or translate the nine scanned documents or the English SDS. Product metadata was reviewed from readable text and rendered pages; full technical summaries require a supervisor's review. Revision age flags mean "verify with manufacturer", not an asserted expiry date. Search covers product identity, manufacturer, code, component and category, not arbitrary PDF contents. Offline PDF access, Drive sync and automated manufacturer updates are not included.
