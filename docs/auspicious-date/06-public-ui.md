# Public

Compact brand-red/white hero, current supplied utility icon, labeled form, gender optional, no birth hour. Server config controls max range/defaults. Client only formats dates/displays backend calendar cells; no lunar/business calculation.

Backend-computed monthly calendars, accessible day buttons with labels/classification (not color alone), no suggested-date sidebar, inline date-detail region. Detail content is limited to lunar date, day Can Chi, month/year Can Chi, solar term at start of day and reference hours. Disclaimer always shown on results. CTA /san-pham. Loading/error/retry/maintenance; no browser persistence of birthdate.

Public results use three display groups consistently in the calendar, legend and details: VERY_GOOD + GOOD → Rất phù hợp (green); NORMAL → Bình thường (yellow); NOT_RECOMMENDED + AVOID → Nên tránh (red). Stronger background colors and mobile symbols distinguish these groups (one check mark for very suitable days). The API scoring and admin rules retain their original classifications; this grouping is presentation only.

Each valid form submission opens an accessible native modal with the owner-provided reference notice and Đồng ý / Hủy actions. Search requests start only after agreement. Cancel or Escape preserves the inputs and any existing results; focus returns to the form. No consent/birthdate is stored in the browser. Retry of an already agreed search does not ask again. Desktop calendar is centered with a 980px maximum width and larger day cells; mobile cells retain their prior size.

Responsive 360–430/tablet/laptop/desktop; existing header/footer unchanged. SEO through routeMetadata with settings fallback; manual global SEO override still wins.
