export function formatCompanyGreetingName(name: string | null | undefined): string {
  return name?.trim() || "there";
}
