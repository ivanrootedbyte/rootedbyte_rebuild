const crypto = require("crypto");

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store, max-age=0");
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

function normalizeAppType(appType) {
  const value = String(appType || "").trim().toLowerCase();

  const map = {
    rootedos: "inner_work",
    "inner work": "inner_work",
    inner_work: "inner_work",

    newsverse: "signal",
    signal: "signal",

    tone: "soundsense",
    soundsense: "soundsense",
    "sound sense": "soundsense"
  };

  return map[value] || "";
}

function getDefaultTitle(appType) {
  const normalized = normalizeAppType(appType);

  if (normalized === "inner_work") return "Inner Work Reflection";
  if (normalized === "signal") return "Signal Truth Check";
  if (normalized === "soundsense") return "SoundSense Breakdown";

  return "RootedByte Reflection";
}

function isValidOutput(output) {
  return output && typeof output === "object" && !Array.isArray(output);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, {
      error: "Method not allowed. Use POST."
    });
  }

  const supabaseUrl = String(
    process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      ""
  ).replace(/\/+$/, "");

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return sendJson(res, 500, {
      error: "Supabase environment variables are missing."
    });
  }

  try {
    const body = await parseBody(req);

    const rawAppType = String(body.appType || "").trim();
    const appType = normalizeAppType(rawAppType);
    const title = String(body.title || "").trim();
    const inputSummary = String(body.inputSummary || "").trim();
    const output = body.output;

    if (!["inner_work", "signal", "soundsense"].includes(appType)) {
      return sendJson(res, 400, {
        error:
          "Invalid appType. Use inner_work, signal, soundsense, rootedos, newsverse, or tone."
      });
    }

    if (!isValidOutput(output)) {
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
          title: title || getDefaultTitle(appType),
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
    const shareUrl = `${baseUrl}/share.html?id=${encodeURIComponent(
      createdRow.share_slug
    )}`;

    return sendJson(res, 200, {
      shareUrl,
      shareSlug: createdRow.share_slug,
      appType: createdRow.app_type
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: error.message || "Something went wrong creating the share link."
    });
  }
};
