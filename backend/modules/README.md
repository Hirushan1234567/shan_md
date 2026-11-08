# API modules

Each module lives in its own directory and contains its own model, controller and routes:
- `modules/<category>/model.js`
- `modules/<category>/controller.js`
- `modules/<category>/routes.js`

Register API gateway handlers in `modules/registry.js` using the category slug and action name. The gateway first validates that the category and endpoint are enabled in MongoDB, then checks plan access and dispatches to the registered handler.

The Movies module is registered with `list`, `search` and `detail` actions. A generic database-backed Content module provides those same actions for administrator-created categories that do not have a dedicated module. Dedicated modules take priority over the generic content handlers. Add only data sources you own or are licensed to distribute. Do not add scraping or unauthorized media-download functionality.
