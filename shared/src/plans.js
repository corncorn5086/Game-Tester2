/**
 * Billing plans. Real checkout runs through PayPal / Braintree
 * (see backend/src/payments). Prices are the amounts actually charged.
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
    id: 'annual',
    name: 'Annual',
    price: 500,
    period: 'per year',
    interval: 'year',
    tagline: 'A full year of Ember — save vs paying monthly',
    stripePriceId: null,
    features: [
      'Everything in Studio, all year',
      'Most capable AI model & longest history',
      'Advanced integrations & early access',
      'Priority support'
    ],
    limits: { projects: -1, reportsPerMonth: -1, teamMembers: 15, cloudSync: true }
  },
  {
    id: 'lifetime',
    name: 'Lifetime',
    price: 2500,
    period: 'one-time',
    oneTime: true,
    tagline: 'Own Ember forever — pay once, no subscription',
    stripePriceId: null,
    features: [
      'Everything in Annual, forever',
      'One-time payment — no monthly fees, ever',
      'All future updates included',
      'Unlimited projects, reports & exports',
      'Team workspace, shared reports & cloud sync',
      'Priority support for life'
    ],
    limits: { projects: -1, reportsPerMonth: -1, teamMembers: 15, cloudSync: true, lifetime: true }
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
