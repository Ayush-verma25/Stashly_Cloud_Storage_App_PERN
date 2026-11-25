export function normalizeResourceName(value) {
  if (typeof value !== "string") return null;

  const name = value.trim();
  if (!name || name.includes("\0") || Array.from(name).length > 255) {
    return null;
  }

  return name;
}
