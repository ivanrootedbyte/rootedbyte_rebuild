const crypto = require("crypto");

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function createShareSlug() {
  return crypto
    .randomBytes(9)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function parseBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }

  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}

function getBaseUrl(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || "https";

  return `${protocol}://${host}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, {
      error: "Method not allowed. Use POST."
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return sendJson(res, 500, {
      error: "Supabase environment variables are missing."
    });
  }

  try {
    const body = await parseBody(req);

    const appType = String(body.appType || "").trim();
    const title = String(body.title || "").trim();
    const inputSummary = String(body.inputSummary || "").trim();
    const output = body.output;

    if (!["rootedos", "newsverse"].includes(appType)) {
      return sendJson(res, 400, {
        error: "Invalid appType. Use rootedos or newsverse."
      });
    }

    if (!output || typeof output !== "object") {
      return sendJson(res, 400, {
        error: "Missing output object."
      });
    }

    let createdRow = null;
    let lastError = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const shareSlug = createShareSlug();

      const response = await fetch(`${supabaseUrl}/rest/v1/shared_outputs`, {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          share_slug: shareSlug,
          app_type: appType,
          title: title || (appType === "rootedos" ? "RootedOS Reflection" : "NewsVerse Reflection"),
          input_summary: inputSummary || null,
          output_json: output,
          is_public: true,
          expires_at: null
        })
      });

      const data = await response.json().catch(() => null);

      if (response.ok && Array.isArray(data) && data[0]) {
        createdRow = data[0];
        break;
      }

      lastError = data;

      const duplicateSlug =
        data &&
        typeof data === "object" &&
        String(data.code || "") === "23505";

      if (!duplicateSlug) {
        break;
      }
    }

    if (!createdRow) {
      return sendJson(res, 500, {
        error: "Could not create share link.",
        details: lastError
      });
    }

    const baseUrl = getBaseUrl(req);
    const shareUrl = `${baseUrl}/share.html?id=${encodeURIComponent(createdRow.share_slug)}`;

    return sendJson(res, 200, {
      shareUrl,
      shareSlug: createdRow.share_slug
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: error.message || "Something went wrong creating the share link."
    });
  }
};
