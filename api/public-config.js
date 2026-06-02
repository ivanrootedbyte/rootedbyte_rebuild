function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.end(JSON.stringify(data));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, {
      error: "Method not allowed. Use GET."
    });
  }

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL;

  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return sendJson(res, 500, {
      error: "Public Supabase configuration is missing."
    });
  }

  return sendJson(res, 200, {
    supabaseUrl: String(supabaseUrl).replace(/\/+$/, ""),
    supabaseAnonKey
  });
};
