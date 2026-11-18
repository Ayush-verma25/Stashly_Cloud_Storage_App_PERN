import "dotenv/config";

// Imported before database and route modules are evaluated during startup.
if (!process.env.JWT_SECRET?.trim()) {
  throw new Error("JWT_SECRET must be present and non-empty.");
}
