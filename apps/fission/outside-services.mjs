// Every service outside the person's device that SpindleLabs can contact, and
// the name the privacy page (public/privacy.html) must give it. e2e/privacy.test.mjs
// fails when the app's source names an address that is in neither list below,
// or when the page leaves out a service's name, so the policy can't quietly
// fall behind the code. Add a service here and to the page in the same change.

/** Contacted: each `name` must appear on the privacy page. */
export const CONTACTED = [
  { name: "GitHub", hosts: ["spindlelabs.app", "github.com", "github.io", "githubusercontent.com"], why: "hosts the site (GitHub Pages); the in-browser AI's code is downloaded from GitHub" },
  { name: "Hugging Face", hosts: ["huggingface.co"], why: "the in-browser AI model's files, downloaded once when the person chooses it" },
  { name: "Anthropic", hosts: ["api.anthropic.com"], why: "the AI assistant, only with the person's own key and after showing what is sent" },
  { name: "OpenAI", hosts: ["api.openai.com"], why: "the AI assistant, only with the person's own key and after showing what is sent" },
  { name: "Supabase", hosts: ["supabase.co"], why: "Report a bug's service, only when the person presses Send (signed in or not)" },
  { name: "Ollama", hosts: ["localhost", "127.0.0.1"], why: "the AI assistant on the person's own computer, or one they name" },
];

/** Only while optional accounts are on (accounts.config.mjs): then the page must name these too. */
export const ACCOUNT_SERVICES = [
  { name: "Supabase", hosts: ["supabase.co"], why: "keeps the account: sign-in, plan, email choice" },
  { name: "Google", hosts: ["accounts.google.com"], why: "the sign-in page the person chooses to use" },
  { name: "Stripe", hosts: ["stripe.com"], why: "Pro's checkout and manage pages, only after the person chooses Upgrade or Manage" },
];

/** Addresses in the source that are never contacted, each with why. */
export const NOT_CONTACTED = [
  { host: "www.w3.org", why: "XML namespace names in SVG, never fetched" },
  { host: "schemas.microsoft.com", why: "XML namespace names inside an exported 3MF file (the 3MF format's own), never fetched" },
  { host: "schemas.openxmlformats.org", why: "XML package namespace names inside an exported 3MF file, never fetched" },
  { host: "example.com", why: "an example address shown as a hint" },
  { host: "your-fission-address", why: "a placeholder shown as a hint" },
  { host: "192.168.1.50", why: "an example address shown as a hint (a computer the person names is asked first, and is Ollama)" },
  { host: "abcdefghijklmnopqrst.supabase.co", why: "an example address in a comment" },
];
