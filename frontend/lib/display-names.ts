const COMPANY_NAME_FALLBACK = "there";
const COMPANY_DISPLAY_FALLBACK = "Company";

function cleanDisplayName(name: string | null | undefined): string {
  return name?.trim() ?? "";
}

export function companyGreetingName(name: string | null | undefined): string {
  return cleanDisplayName(name) || COMPANY_NAME_FALLBACK;
}

export function companyDisplayName(name: string | null | undefined): string {
  return cleanDisplayName(name) || COMPANY_DISPLAY_FALLBACK;
}
