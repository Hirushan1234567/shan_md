# SHAN API HUB — Modular Categories

The portal uses a data-driven category registry so an administrator can create categories without editing or redeploying code. Category-specific behavior can be added as a module under `modules/<slug>/`.

## Runtime structure

- `modules/registry.js` selects a dedicated module when one exists and otherwise uses the safe generic data manager.
- `modules/quotes/routes.js`, `controller.js`, and `model.js` are the dedicated Quotes example.
- `modules/_template/` contains the reusable list/search/latest implementation for categories created from Admin.
- Category definitions are stored in MongoDB collection `apiCategories`.
- Category data is stored in `moduleItems`, with `categorySlug`, `title`, `customFields`, `searchText`, and `published`.

## Create a Quotes category

1. Sign in with the administrator account and open **Admin Panel → API Category Manager**.
2. Enter **Name**: `Quotes`, **Slug**: `quotes`, and a short description.
3. Choose **Free + Premium access**, set Free quota to `200`, Premium quota to `5000`, choose a quota period, and leave the category enabled.
4. Save the category.
5. In **Category Data Manager**, select `Quotes`.
6. Add an item with title `Stay curious` and custom fields:
   ```json
   {
     "text": "Stay curious and keep learning.",
     "author": "SHAN"
   }
   ```
7. Set the item to **Published** and save. Draft items are not returned by the public API.
8. Open **API Documentation**. The enabled Quotes category and its Try it panel are generated automatically.

## Endpoints

- `GET /api/v1/categories` — public list of enabled categories and documentation metadata.
- `GET /api/v1/quotes/list?api_key=YOUR_KEY` — paginated published quotes.
- `GET /api/v1/quotes/search?q=curious&api_key=YOUR_KEY` — search quotes.
- `GET /api/v1/quotes/latest?api_key=YOUR_KEY` — latest quotes.
- Other data-driven categories support `list`, `search`, and `latest` actions using the same route pattern.

You can send the API key using the `x-api-key` header instead of the query string. The portal's Try it control uses the header to avoid placing keys in URLs.

## Add custom category logic

For a category that needs behavior beyond the generic data manager, create `modules/<slug>/model.js`, `controller.js`, and `routes.js`, then register its route in `modules/registry.js`. The generic template remains the fallback for categories created only through Admin.
