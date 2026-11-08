import { listQuotes } from "./model.js";

export async function quotesController({ db, action, query }) {
  if (!["list", "search", "latest"].includes(action)) {
    return { statusCode: 404, detail: "Unknown quotes action. Use list, search or latest." };
  }
  const result = await listQuotes(db, {
    q: action === "search" ? String(query.q || "").slice(0, 100) : "",
    page: action === "latest" ? 1 : query.page,
    limit: action === "latest" ? Math.min(20, Number(query.limit) || 10) : query.limit
  });
  return { statusCode: 200, result: result.items, pagination: {
    page: result.page, limit: result.limit, total: result.total, pages: result.pages
  } };
}
