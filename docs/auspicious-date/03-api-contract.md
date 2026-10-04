# REST contract

Public /api/v1/auspicious-dates:
GET /config: enabled, maxSearchDays, supported/default purposes, display flags, disclaimer, CTA, SEO, currentDate timezone, supported years, ruleset versions.
POST /search: {birthDate,gender?,purpose,from,to}; inclusive max range. Returns chronological results and separately ranked recommendations, monthly calendar grid computed by backend. No trace/source/admin fields.
POST /detail: {birthDate,gender?,purpose,targetDate}; optional expectedRulesetVersion pins search/detail consistency (409 if changed), no arbitrary historical selection.

Admin /api/v1/admin/auspicious-dates:
GET /overview; GET/PUT /settings; GET/POST /versions; GET /versions/:id; POST /versions/:id/clone; POST /versions/:id/review|validate|publish|archive.
PATCH /rules/:id; PUT /rules/:id/content; POST /rules/:id/sources; PUT/DELETE /sources/:id.
POST /simulate; GET/POST /versions/:id/cases; PUT/DELETE /cases/:id; POST /versions/:id/regression; GET /audit?page&limit.

Strict DTOs; UUID IDs; JWT+RBAC on every admin route. Publish accepts explicit confirmation and validates again transactionally.

