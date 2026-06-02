(function () {
  const AUTH_LINK_SELECTOR = '[data-auth-link]';
  const SIGNED_IN_FLAG = 'rootedbyte_user_signed_in';

  let cachedClient = null;

  function setLocalSignedInFlag(isSignedIn) {
    try {
      if (isSignedIn) {
        localStorage.setItem(SIGNED_IN_FLAG, 'true');
      } else {
        localStorage.removeItem(SIGNED_IN_FLAG);
      }
    } catch {
      // Ignore localStorage issues.
    }
  }

  function updateBodyAuthState(isSignedIn) {
    if (!document.body) return;

    document.body.setAttribute(
      'data-auth-state',
      isSignedIn ? 'signed-in' : 'signed-out'
    );
  }

  function updateAuthLinks(isSignedIn) {
    const authLinks = document.querySelectorAll(AUTH_LINK_SELECTOR);

    authLinks.forEach((link) => {
      if (isSignedIn) {
        link.href = 'account.html';
        link.textContent = 'My Account';
        link.setAttribute('aria-label', 'Go to My Account');
      } else {
        link.href = 'signin.html';
        link.textContent = 'Sign In';
        link.setAttribute('aria-label', 'Sign in to RootedByte');
      }
    });
  }

  function applyAuthState(isSignedIn) {
    updateAuthLinks(isSignedIn);
    updateBodyAuthState(isSignedIn);
    setLocalSignedInFlag(isSignedIn);
  }

  async function getPublicConfig() {
    const response = await fetch('/api/public-config', {
      method: 'GET',
      cache: 'no-store'
    });

    const config = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(config.error || 'Could not load account configuration.');
    }

    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error('Supabase configuration is incomplete.');
    }

    return config;
  }

  async function getSupabaseClient() {
    if (cachedClient) {
      return cachedClient;
    }

    if (window.rootedbyteSupabase) {
      cachedClient = window.rootedbyteSupabase;
      return cachedClient;
    }

    if (!window.supabase || !window.supabase.createClient) {
      throw new Error('Supabase client library is not loaded.');
    }

    const config = await getPublicConfig();

    cachedClient = window.supabase.createClient(
      config.supabaseUrl,
      config.supabaseAnonKey
    );

    window.rootedbyteSupabase = cachedClient;

    return cachedClient;
  }

  async function initAuthNav() {
    const authLinks = document.querySelectorAll(AUTH_LINK_SELECTOR);

    if (!authLinks.length) {
      return;
    }

    applyAuthState(false);

    try {
      const supabaseClient = await getSupabaseClient();

      const { data, error } = await supabaseClient.auth.getSession();

      if (error) {
        throw error;
      }

      applyAuthState(Boolean(data && data.session));

      supabaseClient.auth.onAuthStateChange((_event, session) => {
        applyAuthState(Boolean(session));
      });
    } catch (error) {
      console.warn('[RootedByte auth nav]', error.message || error);
      applyAuthState(false);
    }
  }

  window.RootedByteAuth = window.RootedByteAuth || {};
  window.RootedByteAuth.getClient = getSupabaseClient;
  window.RootedByteAuth.refreshNav = initAuthNav;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuthNav);
  } else {
    initAuthNav();
  }
})();
