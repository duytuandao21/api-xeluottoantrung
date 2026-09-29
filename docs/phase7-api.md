# Phase 7 — content, SEO, enquiries

All routes below use the `/api/v1` prefix. Public GET routes return only active or published records where the table has a status. Admin routes require a Supabase bearer token and the RBAC permission shown. Swagger is available at `/api/docs`.

## Content collections

The collections are `articles`, `article-categories`, `pages`, `faqs`, `testimonials`, `services`, `recruitments`, and `slides`. Their columns correspond to the existing Phase 2 tables. Admin payloads use camelCase field names. The API accepts only fields listed for the chosen collection, validates required fields and allowed status values, and records create/update/delete in `audit_logs`. Article and page deletion is soft; other collection deletion is hard.

| Route | Permission | Purpose |
| --- | --- | --- |
| `GET /admin/collections/:collection?page=1&limit=20&search=...&status=...` | `content.read` | Paginated list |
| `GET /admin/collections/:collection/:id` | `content.read` | Record by UUID |
| `POST /admin/collections/:collection` | `content.create` | Create |
| `PATCH /admin/collections/:collection/:id` | `content.update` | Partial update / publish |
| `DELETE /admin/collections/:collection/:id` | `content.delete` | Delete |

Public routes: `GET /articles`, `GET /articles/:slug`, `GET /article-categories`, `GET /faqs`, `GET /testimonials`, `GET /services`, `GET /recruitments`, `GET /slides`, and `GET /pages/by-path?path=/ve-chung-toi`. List routes support `page`, `limit`, and `search`. Articles/pages default to `draft`; setting `status: "published"` publishes them. Active/inactive collections default to `active`.

Testimonials may include `purchaseDate` as a calendar date (`YYYY-MM-DD` in the API, entered as `dd/mm/yyyy` in admin). Existing records without a purchase date return `null`.

Admin managed text blocks use `content_entries`:

| Route | Permission | Purpose |
| --- | --- | --- |
| `GET /content?group=home` | public | Active entries, optionally filtered by group |
| `GET /content/:group/:key` | public | Active entry |
| `GET /admin/content?group=home` | `content.read` | Entries including inactive |
| `GET /admin/content/:group/:key` | `content.read` | Entry by group and key |
| `POST /admin/content` | `content.create` | Create entry |
| `PATCH /admin/content/:group/:key` | `content.update` | Update entry |
| `DELETE /admin/content/:group/:key` | `content.delete` | Delete entry |

Admin settings from the existing settings screens use `site_settings`: `GET /admin/site-settings/:group` (`content.read`), `PUT /admin/site-settings/:group/:key` (`content.update`) with `{ "value": "...", "valueType": "text|number|boolean|json|url", "description": "..." }`. Public `GET /site-settings/:group` exposes values intended for website display; never store credentials in this table. Empty responses mean content has not been entered in admin. Existing frontend defaults remain until Phase 8/9 integration.

## SEO

`GET /seo?route=/tin-tuc` is public. `GET /admin/seo`, `GET /admin/seo/by-route?route=/tin-tuc` (`seo.read`), `PUT /admin/seo` and `DELETE /admin/seo?route=/tin-tuc` (`seo.update`) manage one record per stable route path. PUT is an upsert with `routePath`, `metaTitle`, `metaDescription`, `keywords`, `ogTitle`, `ogDescription`, `ogImageUrl`, `canonicalUrl`, `robotsIndex`, `robotsFollow`, and `structuredData`. The database supports SEO for any page, car, brand, or article route through `routePath`; there is no duplicated entity-specific SEO table. Upserts/deletes are audited.

## Inventory and branch lookups


The existing admin has editable versions, body styles, transmissions, colors, branch regions, branches, and filter chips. Public `GET /lookups/:resource` returns active records only; public `GET /branches` and `GET /branches/:slug` are convenient aliases. Admin CRUD uses `GET/POST /admin/lookups/:resource` and `GET/PATCH/DELETE /admin/lookups/:resource/:id`. Lists support `page`, `limit`, `search`, `status`, and relevant `modelId`, `regionId`, or `group` filters. A slug is generated from `name` on create when omitted and stays stable on name changes. Foreign keys and ranges are validated; referenced rows cannot be deleted.

| Resource | Permission prefix | Admin screen |
| --- | --- | --- |
| `car-versions` | `version.*` | Phiên bản xe |
| `body-styles` | `body_style.*` | Kiểu dáng |
| `transmissions` | `transmission.*` | Hộp số |
| `car-colors` | `color.*` | Màu xe |
| `branch-regions` | `region.*` | Danh mục chi nhánh |
| `branches` | `branch.*` | Chi nhánh |
| `filter-options` | `filter.*` | Năm, ngân sách, km, biển số, tình trạng |

The action suffix is `read`, `create`, `update`, or `delete`. Each request checks the permission for its resource, so `version.read` does not grant access to branches. The new lookup permissions are seeded for `SUPER_ADMIN`, `ADMIN`, and `INVENTORY_MANAGER` as appropriate.

## Enquiries and newsletter

`POST /leads` is public, limited to 5 requests per minute per IP. Types: `sell`, `trade_in`, `callback`, `finance`. All require a Vietnamese phone number. Sell/trade-in require `offeredBrand`, `offeredModel`, `offeredYear`; trade-in also requires `desiredCar`; finance requires `name`, `financeAmount`, `financeTerm`. Other fields (`content`, `email`, car information) are optional. The response contains only the new ID, timestamp, and `accepted`, never submitted contact details. The API records the enquiry for staff; it does not calculate a vehicle valuation or loan approval.

`GET /admin/leads` (`lead.read`) supports `type`, `status`, `search`, `page`, and `limit`; `GET /admin/leads/:id` reads one. `PATCH /admin/leads/:id` (`lead.update`) accepts `status: unread|read|replied`; `DELETE /admin/leads/:id` (`lead.delete`) removes personal data. Status changes and deletions are audited without copying contact details into the audit record.

`POST /newsletter-subscriptions` is public and limited to 5 requests per minute per IP. Email is normalized to lowercase and resubscription reactivates an existing record. Admin endpoints: `GET /admin/newsletter-subscribers` (`lead.read`, paginated), `GET /admin/newsletter-subscribers/export` (`lead.read`, CSV), `PATCH /admin/newsletter-subscribers/:id` (`lead.update`, active/inactive), and `DELETE /admin/newsletter-subscribers/:id` (`lead.delete`).

## Admin customers

Admin customer records use `GET/POST /admin/customers` and `GET/PATCH/DELETE /admin/customers/:id` with `customer.read/create/update/delete`. The list supports search, status, and pagination; delete is soft. Audit records track operations without copying customer contact data. This is the admin customer list only: it does not create a Supabase Auth user or activate the legacy public account pages. Setting a customer status to `blocked` here does not revoke a Supabase Auth session.

`GET /admin/dashboard` (`dashboard.read`) returns counts of cars, featured cars, unread leads, and customers from PostgreSQL. `websiteViews` is `null` because no analytics provider has been configured. The existing analytics charts in admin remain a Phase 8 integration concern; this API does not manufacture traffic numbers.

## Scope from the analyzed UI

Phase 1 found no standalone accessory catalog, automated valuation screen, or traffic fine lookup in the active web/admin code. No accessory tables, pricing algorithm, or external traffic-fine provider were invented for Phase 7. The existing sell/trade-in forms submit leads for human follow-up. These capabilities require a confirmed UI and business/provider requirements before implementation.

No schema migration is needed for Phase 7: `content_entries`, `site_settings`, `seo_metadata`, all listed collections, `leads`, and `newsletter_subscribers` were created in Phase 2. Phase 8/9 will connect the existing frontends to these APIs; no frontend changes are part of Phase 7.
