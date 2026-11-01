const { MongoClient } = require("mongodb");
const crypto = require("crypto");

let clientPromise;

async function getDb() {
    if (!process.env.MONGODB_URI) {
        throw new Error("MONGODB_URI is missing");
    }

    if (!clientPromise) {
        const client = new MongoClient(process.env.MONGODB_URI);
        clientPromise = client.connect();
    }

    const client = await clientPromise;
    return client.db();
}

function send(res, status, data) {
    return res.status(status).json(data);
}

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        return send(res, 405, {
            status: false,
            message: "Method not allowed"
        });
    }

    res.setHeader("Cache-Control", "no-store");

    const secret = process.env.API_USAGE_INGEST_SECRET;

    if (!secret || req.headers["x-usage-secret"] !== secret) {
        return send(res, 401, {
            status: false,
            message: "Unauthorized"
        });
    }

    const { keyHash, apiSlug, method, status, requestId } = req.body || {};

    if (
        typeof keyHash !== "string" ||
        !/^[a-f0-9]{64}$/i.test(keyHash) ||
        typeof apiSlug !== "string" ||
        !/^[a-z0-9-]{2,60}$/i.test(apiSlug)
    ) {
        return send(res, 400, {
            status: false,
            message: "Invalid usage data"
        });
    }

    const httpMethod = String(method || "GET").toUpperCase();

    if (!["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(httpMethod)) {
        return send(res, 400, {
            status: false,
            message: "Invalid HTTP method"
        });
    }

    const httpStatus = Number(status || 200);

    if (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599) {
        return send(res, 400, {
            status: false,
            message: "Invalid HTTP status"
        });
    }

    try {
        const db = await getDb();

        const api = await db.collection("developerApis").findOne({
            slug: apiSlug,
            active: true
        });

        if (!api) {
            return send(res, 404, {
                status: false,
                message: "API not found or inactive"
            });
        }

        const key = await db.collection("developerApiKeys").findOne({
            apiSlug,
            keyHash: keyHash.toLowerCase(),
            revoked: { $ne: true }
        });

        if (!key || !key.userEmail) {
            return send(res, 404, {
                status: false,
                message: "Assigned API key not found"
            });
        }

        const record = {
            userEmail: key.userEmail,
            apiSlug,
            method: httpMethod,
            status: httpStatus,
            createdAt: new Date()
        };

        if (typeof requestId === "string" && requestId.length <= 120) {
            record.requestId = requestId;
        }

        if (record.requestId) {
            await db.collection("developerApiUsage").updateOne(
                {
                    userEmail: record.userEmail,
                    apiSlug,
                    requestId: record.requestId
                },
                { $setOnInsert: record },
                { upsert: true }
            );
        } else {
            await db.collection("developerApiUsage").insertOne(record);
        }

        return send(res, 200, {
            status: true,
            message: "Usage recorded"
        });
    } catch (error) {
        console.error("Universal usage ingest error:", error.message);

        return send(res, 500, {
            status: false,
            message: "Usage tracking failed"
        });
    }
};
