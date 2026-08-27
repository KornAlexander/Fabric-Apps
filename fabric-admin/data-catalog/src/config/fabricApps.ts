// Curated inventory of the Fabric (Rayfin) apps built by Alexander Korn.
// Source of truth for classification: "Demystify DE - Fabric Apps mit Rayfin /
// Fabric-Apps-Demo-Inventory.md". Deployed URLs come from each repo's
// rayfin/.deployments.json (hostingUrl).
//
// Maintenance:
//  - Add a new app by appending a FabricApp entry below.
//  - `isCustomerNamed: true` marks apps named after a real customer (Hochschule
//    Fresenius, GIZ, …). The gallery hides these by default; the
//    "Show customer-named apps" toggle reveals them.
//  - For the generic/anonymized apps, `customerProject` records the customer
//    engagement they originated from (still shown, just anonymized).
//  - Extend `presentations` whenever an app is shown at a new event.

export type AppTier = 'A' | 'B' | 'C' | 'D' | 'E';

export interface FabricAppPresentation {
  /** Event / talk / customer meeting the app was (or will be) shown at. */
  event: string;
  /** Display date, e.g. "20.07.2026". */
  date?: string;
  /** "presented" = already shown; "planned" = committed / upcoming. */
  status: 'presented' | 'planned';
}

export interface FabricApp {
  id: string;
  name: string;
  tagline: string;
  tier: AppTier;
  /** Human-readable category label. */
  category: string;
  tech: string;
  dataPattern: string;
  /** The point this app proves in the demo arc. */
  proves: string;
  /** Live deployed URL (Fabric SSO). */
  url: string;
  status: 'live' | 'wip';
  /** Path under /public. Falls back to a branded placeholder when omitted. */
  screenshot?: string;
  /** Tailwind gradient classes for the placeholder / card accent. */
  accent: string;
  /** True when the app is named after a real customer → excluded by default. */
  isCustomerNamed: boolean;
  /** Customer engagement the (possibly anonymized) app originated from. */
  customerProject?: string;
  presentations: FabricAppPresentation[];
}

export const TIER_LABELS: Record<AppTier, string> = {
  A: 'Showpiece — impossible in canvas',
  B: 'Bespoke viz on Direct Lake',
  C: 'Enterprise power-tool',
  D: 'Gamified / mobile',
  E: 'Overlap zone (a Power App could do it)',
};

const DEMYSTIFY: FabricAppPresentation = {
  event: 'Demystify DE — Fabric Apps mit Rayfin',
  date: '20.07.2026',
  status: 'planned',
};

export const FABRIC_APPS: FabricApp[] = [
  // ── Tier A — showpieces ────────────────────────────────────────────────
  {
    id: 'airport-iq',
    name: '3D Airport Terminal (Airport IQ)',
    tagline: 'Live-approach & Live-Ops on Direct Lake — custom 3D on live enterprise data, no copy.',
    tier: 'A',
    category: TIER_LABELS.A,
    tech: 'Three.js + CesiumJS, WebGL, live ADS-B',
    dataPattern: 'Direct Lake read + live event stream',
    proves: 'Custom 3D on live enterprise data with no data copy; real-time ops.',
    url: '<your-app-host>.webapp.fabricapps.net',
    status: 'live',
    screenshot: '/app-previews/airport-iq.png',
    accent: 'from-sky-500 to-indigo-600',
    isCustomerNamed: false,
    presentations: [DEMYSTIFY],
  },
  {
    id: 'jump-and-run',
    name: 'Jump & Run',
    tagline: 'A platformer game on Fabric — proof there is no UI ceiling.',
    tier: 'A',
    category: TIER_LABELS.A,
    tech: 'Canvas game engine',
    dataPattern: 'App data (GameStats write-back)',
    proves: 'There is literally no UI ceiling.',
    url: '<your-app-host>.webapp.fabricapps.net',
    status: 'live',
    screenshot: '/app-previews/jump-and-run.jpeg',
    accent: 'from-fuchsia-500 to-purple-700',
    isCustomerNamed: false,
    presentations: [],
  },

  // ── Tier B — bespoke viz on Direct Lake ────────────────────────────────
  {
    id: 'klimadaten',
    name: 'Klimadaten-Explorer (DWD Klimaspirale)',
    tagline: 'Animated climate spiral + #ShowYourStripes, 4 views, live Direct-Lake toggle.',
    tier: 'B',
    category: TIER_LABELS.B,
    tech: 'SVG/Canvas animated spiral, 4 views',
    dataPattern: 'Direct Lake / semantic model, live toggle',
    proves: 'Enterprise data → custom animated visualization, no data copy.',
    url: '<your-app-host>.webapp.fabricapps.net',
    status: 'live',
    screenshot: '/app-previews/klimadaten.jpeg',
    accent: 'from-orange-500 to-red-600',
    isCustomerNamed: false,
    presentations: [DEMYSTIFY],
  },
  {
    id: 'hochschul-race',
    name: 'Hochschul Studierende-Race',
    tagline: 'Bar-chart-race SPA on LIVE Direct Lake via UDF proxy.',
    tier: 'B',
    category: TIER_LABELS.B,
    tech: 'Bar-chart-race SPA',
    dataPattern: 'Live Direct Lake via UDF proxy',
    proves: 'Real-time enterprise data + custom chart.',
    url: '<your-app-host>.webapp.fabricapps.net',
    status: 'live',
    screenshot: '/app-previews/hochschul-race.jpeg',
    accent: 'from-blue-500 to-cyan-600',
    isCustomerNamed: false,
    presentations: [],
  },
  {
    id: 'patent-insights',
    name: 'Patent Insights (Cockpit + Gallery)',
    tagline: 'One app, two audiences: an operational Examiner Cockpit plus a 10-view visual gallery (grant heatmap, citation network, 3D innovation terrain & globe) on live patent data.',
    tier: 'B',
    category: TIER_LABELS.B,
    tech: 'React SPA + Three.js/globe.gl 3D + Data Agent',
    dataPattern: 'Direct Lake + executeQueries + AI agent',
    proves: 'Flagship analytics storytelling: KPI cockpit, AI ask-the-docket and bespoke 3D — all on the same live dataset.',
    url: '<your-app-host>.webapp.fabricapps.net',
    status: 'live',
    screenshot: '/app-previews/patent-gallery.jpeg',
    accent: 'from-blue-600 to-slate-900',
    isCustomerNamed: false,
    customerProject: 'EPO — Patent Insights (anonymized)',
    presentations: [{ event: 'EPO customer engagement', status: 'presented' }],
  },

  // ── Tier C — enterprise power-tools ────────────────────────────────────
  {
    id: 'pbi-fixer',
    name: 'Power BI Fixer',
    tagline: 'Governed logic on the semantic model — live TMDL/DAX read & write via UDF.',
    tier: 'C',
    category: TIER_LABELS.C,
    tech: 'React + Fluent UI v9',
    dataPattern: 'Live semantic-model read/write (TMDL/DAX via UDF)',
    proves: 'Complex governed logic on the model — not eye-candy.',
    url: '<your-app-host>.webapp.fabricapps.net',
    status: 'live',
    screenshot: '/app-previews/pbi-fixer.jpeg',
    accent: 'from-amber-500 to-orange-700',
    isCustomerNamed: false,
    presentations: [DEMYSTIFY],
  },

  // ── Tier D — gamified / mobile ─────────────────────────────────────────
  {
    id: 'ibcs-trainer',
    name: 'IBCS Trainer',
    tagline: '3-game hub teaching 98 IBCS rules — swipe/mobile, gamified learning UX.',
    tier: 'D',
    category: TIER_LABELS.D,
    tech: 'Canvas game, 3-game hub, swipe/mobile',
    dataPattern: 'App data (GameStats) + charts',
    proves: 'Breadth + runs on mobile; learning UX.',
    url: '<your-app-host>.webapp.fabricapps.net',
    status: 'live',
    screenshot: '/app-previews/ibcs-trainer.jpeg',
    accent: 'from-teal-500 to-emerald-700',
    isCustomerNamed: false,
    presentations: [DEMYSTIFY],
  },

  // ── Tier E — overlap zone (a Power App could do it) ────────────────────
  {
    id: 'einsatzplanung-uni',
    name: 'Einsatzplanung Hochschule (anonymized)',
    tagline: 'A real customer Power App rebuilt as a Fabric App with a 0-diff parity harness.',
    tier: 'E',
    category: TIER_LABELS.E,
    tech: 'React 19 + Fluent UI v9 + Fabric SQL + Direct Lake',
    dataPattern: 'Fabric SQL write-back + Lakehouse mirror',
    proves: 'The honest proof point: a real Power App rebuilt as a Fabric App, reconciled 1:1.',
    url: '<your-app-host>.webapp.fabricapps.net',
    status: 'wip',
    screenshot: '/app-previews/einsatzplanung-uni.jpeg',
    accent: 'from-rose-500 to-pink-700',
    isCustomerNamed: false,
    customerProject: 'Hochschule Fresenius (anonymized)',
    presentations: [],
  },
  {
    id: 'program-insights',
    name: 'Program Insights',
    tagline: 'Transactional write on a shared model.',
    tier: 'E',
    category: TIER_LABELS.E,
    tech: 'React + raw MSAL',
    dataPattern: 'Shared model + write-back UDF',
    proves: 'Transactional write on a shared model.',
    url: '<your-app-host>.webapp.fabricapps.net',
    status: 'live',
    screenshot: '/app-previews/program-insights.jpeg',
    accent: 'from-violet-500 to-indigo-700',
    isCustomerNamed: false,
    presentations: [],
  },
  {
    id: 'feedback-board',
    name: 'Demo Feedback Board',
    tagline: 'Angular + Material board on mssql — the honest case where a Power App is the better choice.',
    tier: 'E',
    category: TIER_LABELS.E,
    tech: 'Angular 21 + Material',
    dataPattern: 'mssql (Dataverse-like)',
    proves: 'Where a Power App is the better choice.',
    url: '<your-app-host>.webapp.fabricapps.net',
    status: 'live',
    screenshot: '/app-previews/feedback-board.jpeg',
    accent: 'from-gray-500 to-gray-700',
    isCustomerNamed: false,
    presentations: [],
  },
  {
    id: 'atelier',
    name: 'Atelier Dashboard',
    tagline: 'Angular + Material dashboard with GitHub sync — honest overlap.',
    tier: 'E',
    category: TIER_LABELS.E,
    tech: 'Angular 21 + Material',
    dataPattern: 'GitHub sync / mssql',
    proves: 'Honest overlap with low-code.',
    url: '<your-app-host>.webapp.fabricapps.net',
    status: 'live',
    screenshot: '/app-previews/atelier.jpeg',
    accent: 'from-lime-500 to-green-700',
    isCustomerNamed: false,
    presentations: [],
  },

  // ── Customer-named apps (hidden by default via the exclude filter) ─────
  {
    id: 'einsatzplanung-fresenius',
    name: 'Einsatzplanung Hochschule Fresenius',
    tagline: 'The real customer app: a Power App (Excel/SharePoint) rebuilt as a Fabric App.',
    tier: 'E',
    category: TIER_LABELS.E,
    tech: 'React 19 + Fluent UI v9 + Fabric SQL + Direct Lake',
    dataPattern: 'Fabric SQL write-back (Track B) / Excel-via-Graph (Track A) + Lakehouse mirror',
    proves: 'A customer Power App rebuilt as a Fabric App with a 0-diff parity harness.',
    url: '<your-app-host>.webapp.fabricapps.net',
    status: 'wip',
    screenshot: '/app-previews/einsatzplanung-fresenius.jpeg',
    accent: 'from-rose-600 to-pink-800',
    isCustomerNamed: true,
    customerProject: 'Hochschule Fresenius',
    presentations: [{ event: 'Hochschule Fresenius customer POC', status: 'presented' }],
  },
  {
    id: 'giz-actiapp',
    name: 'GIZ ActiApp',
    tagline: 'Customer app with row-level security on the shared model.',
    tier: 'E',
    category: TIER_LABELS.E,
    tech: 'React + Fabric UDF + RLS',
    dataPattern: 'Shared model + write-back UDF (RLS)',
    proves: 'Governed transactional app for the customer.',
    url: '<your-app-host>.webapp.fabricapps.net',
    status: 'live',
    screenshot: '/app-previews/giz-actiapp.jpeg',
    accent: 'from-cyan-700 to-blue-900',
    isCustomerNamed: true,
    customerProject: 'GIZ',
    presentations: [{ event: 'GIZ customer engagement', status: 'presented' }],
  },
];

export function wasPresented(app: FabricApp): boolean {
  return app.presentations.length > 0;
}

export function fromCustomerProject(app: FabricApp): boolean {
  return Boolean(app.customerProject);
}
