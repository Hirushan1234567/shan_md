export async function listCategoryItems(db, slug, { q = "", page = 1, limit = 20 } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const filter = { categorySlug: slug, published: true };
  if (q) filter.$or = [
    { title: { $regex: escapeRegex(q), $options: "i" } },
    { customFields: { $regex: escapeRegex(q), $options: "i" } }
  ];
  const [items, total] = await Promise.all([
    db.collection("moduleItems").find(filter, { projection: { categorySlug: 0 } })
      .sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).toArray(),
    db.collection("moduleItems").countDocuments(filter)
  ]);
  return { items, page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) };
}
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
