/**
 * The public expert roster. Everything here is public marketing data
 * (mirrors get-an-expert-web); join codes NEVER live here: they exist
 * only in GET_AN_EXPERT_EXPERT_TOKENS as <code>:<id> pairs.
 * Ratings and fix counts are hardcoded by decision (2026-07-17) until a
 * review system exists.
 */
export interface PublicExpertProfile {
  id: string;
  name: string;
  photo: string;
  role: string;
  companies: { logo?: string; label: string }[];
  tag: string;
  rating: number;
  fixesDelivered: number;
  linkedin?: string;
}

export const ROSTER: readonly PublicExpertProfile[] = [
  {
    id: "rohit", name: "Rohit Jain", photo: "/experts/rohit.jpg",
    role: "Senior software engineer",
    companies: [
      { logo: "/experts/amazon.jpg", label: "Amazon" },
      { logo: "/experts/square.jpg", label: "Square" },
    ],
    tag: "Code, payments & APIs", rating: 4.8, fixesDelivered: 12,
    linkedin: "https://www.linkedin.com/in/rohit-jain-343437187/",
  },
  {
    id: "aakash", name: "Aakash Sangani", photo: "/experts/aakash.jpg",
    role: "Senior full-stack cloud engineer",
    companies: [
      { logo: "/experts/fidelity.jpg", label: "Fidelity" },
      { label: "IIT Kharagpur" },
    ],
    tag: "Deploys & infrastructure", rating: 4.7, fixesDelivered: 9,
    linkedin: "https://www.linkedin.com/in/aakash-sangani/",
  },
  {
    id: "senjal", name: "Senjal Pandharpatte", photo: "/experts/senjal.jpg",
    role: "Senior UX designer",
    companies: [
      { logo: "/experts/lightbox.jpg", label: "LightBox" },
      { logo: "/experts/rit.jpg", label: "RIT" },
    ],
    tag: "Design & user experience", rating: 4.8, fixesDelivered: 14,
    linkedin: "https://www.linkedin.com/in/senjalpandharpatte/",
  },
  {
    id: "inigo", name: "Iñigo Fernández", photo: "/experts/inigo.jpg",
    role: "AI engineer & product owner",
    companies: [
      { logo: "/experts/mck.jpg", label: "McKinsey & Company" },
      { logo: "/experts/hbs.jpg", label: "Harvard Business School" },
    ],
    tag: "AI, RAG & agents", rating: 4.8, fixesDelivered: 6,
    linkedin: "https://www.linkedin.com/in/inigofernandezguerraabdala/",
  },
  {
    id: "hardik", name: "Hardik Acharya", photo: "/experts/hardik.jpg",
    role: "Senior security operations analyst",
    companies: [{ logo: "/experts/mck.jpg", label: "McKinsey & Company" }],
    tag: "Security & compliance", rating: 4.6, fixesDelivered: 7,
    linkedin: "https://www.linkedin.com/in/acharyahardik/",
  },
  {
    id: "pulkit", name: "Pulkit Walia", photo: "/experts/pulkit.jpg",
    role: "Business & growth leader",
    companies: [
      { logo: "/experts/uc.jpg", label: "Urban Company" },
      { logo: "/experts/bessemer.jpg", label: "Bessemer" },
      { logo: "/experts/hbs.jpg", label: "Harvard Business School" },
    ],
    tag: "GTM & business automations", rating: 4.7, fixesDelivered: 10,
    linkedin: "https://www.linkedin.com/in/pulkitwalia/",
  },
];

export function findExpert(id: string): PublicExpertProfile | undefined {
  return ROSTER.find((e) => e.id === id);
}
