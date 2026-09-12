type CompanyGreetingProps = {
  name?: string | null;
};

export function CompanyGreeting({ name }: CompanyGreetingProps) {
  const displayName = typeof name === "string" && name.trim() ? name : "there";

  return <h1 className="dash-title">Welcome back, {displayName}</h1>;
}
