# Phase 8 admin integration

The Next.js admin uses Supabase Auth in the browser. Each admin API request sends the Supabase access token as `Authorization: Bearer ...`; the backend validates the token, active profile, and RBAC permissions. `GET /admin/me` returns the current profile and permissions. `PATCH /admin/me` updates only the current profile's display name and phone; email remains managed by Supabase Auth.

`GET /admin/cars` now accepts `version=<version-slug>` and `featured=true|false` alongside the existing filters so the admin's version filter and featured dashboard list work with server pagination.

`POST /admin/media/assets/presign` signs a five minute R2 PUT for an admin content image. Body: `mimeType` (JPEG, PNG, WebP, AVIF, or ICO) and `sizeBytes` (1–10,000,000). The caller must have `media.create`, `content.update`, or `seo.update`. The response contains `uploadUrl`, `headers`, `storageKey`, and `publicUrl`. The browser PUTs directly to R2, then saves `publicUrl` in the relevant content, setting, or SEO record. Car media continues to use `/admin/media/presign` plus `/admin/cars/:id/media`, which verifies the uploaded object and records its metadata.

The admin does not migrate old browser `localStorage` records into PostgreSQL. Existing browser only records must be imported separately if they are needed. No analytics provider is configured; admin traffic views show an empty state rather than sample numbers.
