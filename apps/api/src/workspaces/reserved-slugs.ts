// =====================================================================
// apps/api/src/workspaces/reserved-slugs.ts
// =====================================================================
// Workspace slugs that must never be claimable. These conflict with
// app routes, marketing pages, or future product surface.
// =====================================================================

export const RESERVED_SLUGS = new Set<string>([
  // App routes
  "api", "app", "admin", "auth", "login", "logout", "signup", "signin",
  "register", "billing", "settings", "account", "support", "help",
  "dashboard", "docs", "blog", "pricing", "about", "contact",
  "terms", "privacy", "legal", "security", "status",

  // Subdomains commonly used
  "www", "ftp", "mail", "email", "smtp", "imap", "pop", "ssh",
  "vpn", "ns1", "ns2", "cdn", "assets", "static", "media",

  // Brand
  "ibirdos", "ibird", "claude", "anthropic",

  // Sensitive
  "root", "system", "internal", "private", "test", "staging", "prod",
  "production", "dev", "development",
]);
