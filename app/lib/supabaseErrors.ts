export const isMissingTableError = (message: string) => {
  const lower = message.toLowerCase();
  return (
    lower.includes("schema cache") ||
    lower.includes("does not exist") ||
    (lower.includes("relation") && lower.includes("does not exist"))
  );
};

export const friendlySupabaseError = (message: string) => {
  if (isMissingTableError(message)) {
    return "Database table is missing. Run the Supabase migrations first.";
  }
  if (message.toLowerCase().includes("failed to fetch")) {
    return "Network error. Please check your connection.";
  }
  return message;
};
