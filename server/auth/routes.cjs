function asyncRoute(fn) {
  return (req, res) => Promise.resolve(fn(req, res)).catch((error) => {
    const status = error.statusCode || (/not configured|not installed|AUTH_SECRET|DATABASE_URL/i.test(error.message) ? 503 : 400);
    res.status(status).json({ ok: false, error: error.message || "Request failed." });
  });
}

function createAuthRoutes({ app, accountService }) {
  app.get("/api/shop", (req, res) => {
    res.json({ ok: true, skins: accountService.publicCatalog() });
  });

  app.post("/api/auth/register", asyncRoute(async (req, res) => {
    const result = await accountService.register(req.body || {});
    res.json({ ok: true, ...result, skins: accountService.publicCatalog() });
  }));

  app.post("/api/auth/login", asyncRoute(async (req, res) => {
    const result = await accountService.login(req.body || {});
    res.json({ ok: true, ...result, skins: accountService.publicCatalog() });
  }));

  app.post("/api/auth/guest", asyncRoute(async (req, res) => {
    const result = await accountService.createGuest(req.body || {});
    res.json({ ok: true, ...result, skins: accountService.publicCatalog() });
  }));

  app.get("/api/account", asyncRoute(async (req, res) => {
    const account = await accountService.accountFromRequest(req);
    if (!account) return res.status(401).json({ ok: false, error: "Not signed in." });
    res.json({ ok: true, account, skins: accountService.publicCatalog() });
  }));

  app.post("/api/shop/buy", asyncRoute(async (req, res) => {
    const account = await accountService.accountFromRequest(req);
    if (!account) return res.status(401).json({ ok: false, error: "Sign in or play as guest first." });
    const nextAccount = await accountService.purchaseSkin(account.id, req.body?.skinId);
    res.json({ ok: true, account: nextAccount, skins: accountService.publicCatalog() });
  }));
}

module.exports = { createAuthRoutes };
