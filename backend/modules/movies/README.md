# Movies module

This module serves only movie records entered by an administrator into the SHAN API database. It does not scrape third-party sites or redistribute copyrighted media.

Actions (all protected by API key middleware at the API gateway):
- `GET /api/v1/movies/list`
- `GET /api/v1/movies/search?q=...&genre=...&year=...`
- `GET /api/v1/movies/detail?id=...` or `?title=...`

Only records marked `published: true` are returned. Add content using the authenticated admin content routes under `/api/admin/content`.
