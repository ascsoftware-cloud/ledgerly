/**
 * Who is behind Ledgerly, for the legal pages and footer. Set the NEXT_PUBLIC_COMPANY_* variables in Vercel; until
 * they are set the pages show a visible "[to confirm]" in place of each missing detail, and say the text is a draft.
 */
const TBC = (what: string) => `[${what}: to confirm]`;

export type Company = {
  name: string;
  registration: string;
  address: string;
  infoOfficer: string;
  contactEmail: string;
  dataRegion: string;
  /** True when any detail above is still a placeholder. */
  incomplete: boolean;
};

export function getCompany(env: Record<string, string | undefined> = process.env): Company {
  const v = (k: string) => env[k]?.trim() || null;
  const name = v("NEXT_PUBLIC_COMPANY_NAME");
  const registration = v("NEXT_PUBLIC_COMPANY_REG");
  const address = v("NEXT_PUBLIC_COMPANY_ADDRESS");
  const infoOfficer = v("NEXT_PUBLIC_INFO_OFFICER");
  const dataRegion = v("NEXT_PUBLIC_DATA_REGION");
  return {
    name: name ?? TBC("company name"),
    registration: registration ?? TBC("registration number"),
    address: address ?? TBC("physical address"),
    infoOfficer: infoOfficer ?? TBC("information officer"),
    contactEmail: v("NEXT_PUBLIC_CONTACT_EMAIL") ?? "hello@ascsoftware.co.za",
    dataRegion: dataRegion ?? TBC("hosting region"),
    incomplete: !(name && registration && address && infoOfficer && dataRegion),
  };
}
