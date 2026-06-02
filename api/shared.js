function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.end(JSON.stringify(data));
}

function getQueryId(req) {
  if (req.query && req.query.id) {
    return String(req.query.id).trim();
  }

  const host = req.headers.host || "localhost";
  const url = new URL(req.url, `https://${host}`);

  return String(url.searchParams.get("id") || "").trim();
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

  return map[value] || value || "rootedbyte";
}

function getAppName(appType) {
  const normalized = normalizeAppType(appType);

  if (normalized === "inner_work") return "Inner Work";
  if (normalized === "signal") return "Signal";
  if (normalized === "soundsense") return "SoundSense";

  return "RootedByte";
}

function isValidShareSlug(id) {
  return /^[a-zA-Z0-9_-]{6,80}$/.test(id);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, {
      error: "Method not allowed. Use GET."
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

  const id = getQueryId(req);

  if (!id) {
    return sendJson(res, 400, {
      error: "Missing shared output id."
    });
  }

  if (!isValidShareSlug(id)) {
    return sendJson(res, 400, {
      error: "Invalid shared output id."
    });
  }

  try {
    const query = new URLSearchParams({
      share_slug: `eq.${id}`,
      select:
        "share_slug,app_type,title,input_summary,output_json,is_public,expires_at,created_at",
      limit: "1"
    });

    const response = await fetch(
      `${supabaseUrl}/rest/v1/shared_outputs?${query.toString()}`,
      {
        method: "GET",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json"
        }
      }
    );

    const rows = await response.json().catch(() => []);

    if (!response.ok) {
      return sendJson(res, 500, {
        error: "Could not retrieve shared output.",
        details: rows
      });
    }

    const row = Array.isArray(rows) ? rows[0] : null;

    if (!row || row.is_public !== true) {
      return sendJson(res, 404, {
        error: "Shared output not found."
      });
    }

    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
      return sendJson(res, 404, {
        error: "This shared output has expired."
      });
    }

    const normalizedAppType = normalizeAppType(row.app_type);

    return sendJson(res, 200, {
      shareSlug: row.share_slug,

      // New safe frontend fields
      appType: normalizedAppType,
      appName: getAppName(normalizedAppType),

      // Compatibility field for older HTML/JS checks
      originalAppType: row.app_type,

      title: row.title || "Shared RootedByte Output",
      inputSummary: row.input_summary || "",
      output: row.output_json || {},
      createdAt: row.created_at
    });
  } catch (error) {
    return sendJson(res, 500, {
      error:
        error.message ||
        "Something went wrong retrieving the shared output."
    });
  }
};
