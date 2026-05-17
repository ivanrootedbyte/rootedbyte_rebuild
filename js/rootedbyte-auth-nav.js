(function () {
  const AUTH_LINK_SELECTOR = '[data-auth-link]';

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

  async function getPublicConfig() {
    const response = await fetch('/api/public-config');
    const config = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(config.error || 'Could not load account configuration.');
    }

    return config;
  }

  async function initAuthNav() {
    const authLinks = document.querySelectorAll(AUTH_LINK_SELECTOR);

    if (!authLinks.length) {
      return;
    }

    updateAuthLinks(false);

    if (!window.supabase) {
      return;
    }

    try {
      const config = await getPublicConfig();

      const supabaseClient = window.supabase.createClient(
        config.supabaseUrl,
        config.supabaseAnonKey
      );

      const { data } = await supabaseClient.auth.getSession();

      updateAuthLinks(Boolean(data.session));

      supabaseClient.auth.onAuthStateChange((_event, session) => {
        updateAuthLinks(Boolean(session));
      });
    } catch {
      updateAuthLinks(false);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuthNav);
  } else {
    initAuthNav();
  }
})();
