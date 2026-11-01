const { currentUser, getDb } = require("./_local-auth.cjs");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await currentUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const db = await getDb();
    const usage = db.collection("developerApiUsage");

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [totalRequests, last7Days, history] = await Promise.all([
      usage.countDocuments({ userEmail: user.email }),
      usage.countDocuments({
        userEmail: user.email,
        createdAt: { $gte: since }
      }),
      usage.find(
        { userEmail: user.email },
        {
          projection: {
            _id: 0,
            apiSlug: 1,
            method: 1,
            status: 1,
            createdAt: 1
          }
        }
      ).sort({ createdAt: -1 }).limit(100).toArray()
    ]);

    return res.status(200).json({
      success: true,
      totalRequests,
      last7Days,
      history
    });
  } catch (error) {
    console.error("Usage API error:", error.message);
    return res.status(500).json({ error: "Unable to load usage" });
  }
};
