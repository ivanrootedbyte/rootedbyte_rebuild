(function () {
  async function getRootedByteSaveClient() {
    if (
      window.RootedByteAuth &&
      typeof window.RootedByteAuth.getClient === 'function'
    ) {
      return window.RootedByteAuth.getClient();
    }

    if (window.rootedbyteSupabase) {
      return window.rootedbyteSupabase;
    }

    if (!window.supabase || !window.supabase.createClient) {
      throw new Error('Supabase browser client is not loaded.');
    }

    const response = await fetch('/api/public-config', {
      method: 'GET',
      cache: 'no-store'
    });

    const config = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(config.error || 'Could not load public Supabase config.');
    }

    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error('Missing Supabase public config.');
    }

    window.rootedbyteSupabase = window.supabase.createClient(
      config.supabaseUrl,
      config.supabaseAnonKey
    );

    return window.rootedbyteSupabase;
  }

  async function getCurrentRootedByteUser() {
    const client = await getRootedByteSaveClient();

    const { data, error } = await client.auth.getSession();

    if (error) {
      throw error;
    }

    const session = data && data.session;

    if (!session || !session.user) {
      return null;
    }

    return session.user;
  }

  function normalizeAppType(appType) {
    const value = String(appType || '').trim().toLowerCase();

    const map = {
      rootedos: 'inner_work',
      'inner work': 'inner_work',
      inner_work: 'inner_work',

      newsverse: 'signal',
      signal: 'signal',

      tone: 'soundsense',
      soundsense: 'soundsense',
      'sound sense': 'soundsense'
    };

    return map[value] || value || 'rootedbyte';
  }

  function normalizeTitle(title, appType) {
    const cleanTitle = String(title || '').trim();

    if (cleanTitle) {
      return cleanTitle;
    }

    const normalizedApp = normalizeAppType(appType);

    if (normalizedApp === 'inner_work') return 'Inner Work Reflection';
    if (normalizedApp === 'signal') return 'Signal Check';
    if (normalizedApp === 'soundsense') return 'SoundSense Result';

    return 'RootedByte Output';
  }

  function normalizeOutputJson(outputJson) {
    if (!outputJson) {
      return null;
    }

    if (typeof outputJson === 'object') {
      return outputJson;
    }

    try {
      return JSON.parse(outputJson);
    } catch {
      return {
        content: String(outputJson)
      };
    }
  }

  async function saveRootedByteOutput(options) {
    const client = await getRootedByteSaveClient();
    const user = await getCurrentRootedByteUser();

    if (!user) {
      return {
        ok: false,
        reason: 'not_signed_in',
        message: 'Please sign in to save this privately.'
      };
    }

    const outputJson = normalizeOutputJson(options && options.outputJson);

    if (!options || !outputJson) {
      return {
        ok: false,
        reason: 'missing_data',
        message: 'Could not save yet. Missing output details.'
      };
    }

    const appType = normalizeAppType(options.appType);
    const title = normalizeTitle(options.title, appType);

    const payload = {
      user_id: user.id,
      app_type: appType,
      title: title,
      input_summary: String(options.inputSummary || '').trim(),
      output_json: outputJson
    };

    const { data, error } = await client
      .from('saved_outputs')
      .insert(payload)
      .select('id, app_type, title, created_at')
      .single();

    if (error) {
      throw error;
    }

    return {
      ok: true,
      id: data.id,
      appType: data.app_type,
      title: data.title,
      createdAt: data.created_at,
      message: 'Saved privately to your account.'
    };
  }

  window.RootedByteSaveOutput = {
    save: saveRootedByteOutput,
    getUser: getCurrentRootedByteUser,
    getClient: getRootedByteSaveClient
  };
})();
