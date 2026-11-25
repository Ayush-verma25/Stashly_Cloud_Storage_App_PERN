export function errorHandler(error, _req, res, _next) {
  const databaseStatus = {
    "22P02": 400,
    "23503": 400,
    "23505": 409,
  }[error.code];
  const status = error.name === "MulterError"
    ? error.code === "LIMIT_FILE_SIZE" || error.code === "LIMIT_FILE_COUNT"
      ? 413
      : 400
    : databaseStatus ||
      (Number.isInteger(error.status) && error.status >= 400 && error.status < 500
        ? error.status
        : 500);

  if (status >= 500) {
    console.error("Unhandled API error:", error);
  }

  let message = "Something went wrong.";
  if (error.name === "MulterError") {
    message =
      error.code === "LIMIT_FILE_SIZE"
        ? "File exceeds the maximum allowed size."
        : error.code === "LIMIT_FILE_COUNT"
          ? "Too many files in one upload."
          : "Invalid file upload.";
  } else if (error.type === "entity.parse.failed") {
    message = "Invalid JSON request body.";
  } else if (error.code === "22P02") {
    message = "A request ID is invalid.";
  } else if (error.code === "23503") {
    message = "A referenced item is invalid.";
  } else if (error.code === "23505") {
    message = "An item with these details already exists.";
  } else if (status < 500) {
    message = error.expose ? error.message : "Invalid request.";
  }

  return res.status(status).json({ error: message });
}
