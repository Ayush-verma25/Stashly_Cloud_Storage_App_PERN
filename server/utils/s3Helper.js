export const deleteMultipleFromStorage = async (keys) => {
  if (keys.length > 0) {
    throw new Error("Object storage deletion is not configured.");
  }
};
