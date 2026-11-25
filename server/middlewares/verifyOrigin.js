const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function verifyOrigin(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.get("Origin");
  const allowedOrigins = (process.env.ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!origin || origin === "null" || !allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: "Forbidden origin." });
  }

  return next();
}
