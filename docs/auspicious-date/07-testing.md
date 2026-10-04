# Verification

Phases: discovery -> schema/permissions/migration -> calendar -> almanac -> engine -> API -> simulator/admin -> web -> hardening.

node:test: published astronomy fixtures, Tet/year/leap/timezone edges, full-range roundtrip, relations/nap-am/hours, handler match/non-match, critical override, disabled rules/stable rank; PGlite transactional immutable snapshots/source gating/reference failure/audit. Fastify inject API DTO/range/disabled/JWT/RBAC/public-contract, including malformed nested rule parameters. Publishing uses a database lock and a unique partial index; the integration test exercises publication and immutability, not parallel production requests.

CLI regression read-only, requires --version UUID; prints Total/Pass/Fail/Changed, nonzero failures. No expected-data writes.

Admin/web Playwright checks with temporary API fixtures (no production mutation): save payload/detail/simulator/publish error/permission/mobile, form/query/calendar/detail/errors/maintenance/CTA, no hydration errors. These test browser behavior; persistence and engine correctness are checked separately by the API integration tests. Run available lint/typecheck/test/build/validate; distinguish existing warnings from additions. Check migrations on isolated DB. The development/test database migration was explicitly authorized and applied. Production migration remains an operator step.

Public browser checks cover the reference confirmation gate: no search before agreement, cancel/Escape send no search and preserve inputs, focus returns to the form, each new search asks again and cancel preserves existing results. They also verify the larger desktop calendar, retained mobile cell size, single mobile check mark and absence of the suggested-date sidebar. The live public check accepts the notice before testing each purpose against the actual API.
