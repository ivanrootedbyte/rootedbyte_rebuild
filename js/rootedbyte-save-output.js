(function () {
  let rootedByteSaveClient = null;
  let rootedByteSaveConfigPromise = null;

  async function loadRootedByteSaveConfig() {
    if (!rootedByteSaveConfigPromise) {
      rootedByteSaveConfigPromise = fetch("/api/public-config")
        .then(function (res) {
          if (!res.ok) {
            throw new Error("Could not load public Supabase config.");
          }
          return res.json();
        })
        .then(function (config) {
          const supabaseUrl = config.supabaseUrl || config.SUPABASE_URL;
          const supabaseAnonKey =
            config.supabaseAnonKey || config.SUPABASE_ANON_KEY;

          if (!supabaseUrl || !supabaseAnonKey) {
            throw new Error("Missing Supabase public config.");
          }

          return {
            supabaseUrl: supabaseUrl,
            supabaseAnonKey: supabaseAnonKey,
          };
        });
    }

    return rootedByteSaveConfigPromise;
  }

  async function getRootedByteSaveClient() {
    if (rootedByteSaveClient) {
      return rootedByteSaveClient;
    }

    if (!window.supabase || !window.supabase.createClient) {
      throw new Error("Supabase browser client is not loaded.");
    }

    const config = await loadRootedByteSaveConfig();

    rootedByteSaveClient = window.supabase.createClient(
      config.supabaseUrl,
      config.supabaseAnonKey
    );

    return rootedByteSaveClient;
  }

  async function getCurrentRootedByteUser() {
    const client = await getRootedByteSaveClient();
    const result = await client.auth.getSession();

    if (result.error) {
      throw result.error;
    }

    const session = result.data && result.data.session;

    if (!session || !session.user) {
      return null;
    }

    return session.user;
  }

  async function saveRootedByteOutput(options) {
    const client = await getRootedByteSaveClient();
    const user = await getCurrentRootedByteUser();

    if (!user) {
      return {
        ok: false,
        reason: "not_signed_in",
        message: "Please sign in to save this privately.",
      };
    }

    if (!options || !options.appType || !options.title || !options.outputJson) {
      return {
        ok: false,
        reason: "missing_data",
        message: "Could not save yet. Missing output details.",
      };
    }

    const payload = {
      user_id: user.id,
      app_type: options.appType,
      title: options.title,
      input_summary: options.inputSummary || "",
      output_json: options.outputJson,
    };

    const insertResult = await client
      .from("saved_outputs")
      .insert(payload)
      .select("id")
      .single();

    if (insertResult.error) {
      throw insertResult.error;
    }

    return {
      ok: true,
      id: insertResult.data.id,
      message: "Saved privately to your account.",
    };
  }

  window.RootedByteSaveOutput = {
    save: saveRootedByteOutput,
    getUser: getCurrentRootedByteUser,
  };
})();
