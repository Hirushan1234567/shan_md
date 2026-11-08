import { listCategoryItems } from "./model.js";

export async function genericCategoryController({ db, category, action, query }) {
  if (!["list", "search", "latest"].includes(action)) {
    return { statusCode: 404, detail: "Unknown action. Use list, search or latest." };
  }
  const result = await listCategoryItems(db, category.slug, {
    q: action === "search" ? String(query.q || "").slice(0, 100) : "",
    page: action === "latest" ? 1 : query.page,
    limit: action === "latest" ? Math.min(20, Number(query.limit) || 10) : query.limit
  });
  return { statusCode: 200, result: result.items, pagination: {
    page: result.page, limit: result.limit, total: result.total, pages: result.pages
  } };
}
