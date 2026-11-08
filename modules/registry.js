import { quotesRoutes } from "./quotes/routes.js";
import { genericCategoryRoutes } from "./_template/routes.js";

// A category can use a dedicated module or the safe data-driven template.
// Adding a category in Admin makes it available immediately through the template.
const moduleRoutes = new Map([["quotes", quotesRoutes]]);

export async function dispatchCategory(context) {
  const route = moduleRoutes.get(context.category.slug) || genericCategoryRoutes;
  return route(context);
}
