/**
 * Billing plans. Prices are placeholders until Stripe is wired
 * (see .env.example — STRIPE_* keys, never hardcoded).
 */

export const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    period: 'forever',
    tagline: 'Try Ember on one project',
    stripePriceId: null,
    features: [
      '1 connected project',
      'Local scans & code analysis',
      'Limited reports (5 / month)',
      'Demo mode',
      'Community support'
    ],
    limits: { projects: 1, reportsPerMonth: 5, teamMembers: 1, cloudSync: false }
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 29,
    period: 'per user / month',
    tagline: 'For indie developers shipping seriously',
    stripePriceId: null,
    highlighted: true,
    features: [
      'Unlimited projects',
      'Real agent scans & log analysis',
      'Unlimited report exports (JSON / Markdown)',
      'Custom test plans & custom rules',
      'Email support'
    ],
    limits: { projects: -1, reportsPerMonth: -1, teamMembers: 1, cloudSync: false }
  },
  {
    id: 'studio',
    name: 'Studio',
    price: 99,
    period: 'per workspace / month',
    tagline: 'For teams with a QA pipeline',
    stripePriceId: null,
    features: [
      'Everything in Pro',
      'Team workspace & shared reports',
      'CI/CD integration',
      'Advanced bug triage board',
      'Cloud sync (coming soon)',
      'Priority support'
    ],
    limits: { projects: -1, reportsPerMonth: -1, teamMembers: 15, cloudSync: true }
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: null,
    period: 'custom',
    tagline: 'For studios with security requirements',
    stripePriceId: null,
    features: [
      'Everything in Studio',
      'Custom engine integrations',
      'Private / on-prem deployment',
      'Security controls & audit log',
      'Advanced permissions (SSO, SCIM planned)',
      'Dedicated support'
    ],
    limits: { projects: -1, reportsPerMonth: -1, teamMembers: -1, cloudSync: true }
  }
];

export function getPlan(id) {
  return PLANS.find((p) => p.id === id) ?? null;
}
