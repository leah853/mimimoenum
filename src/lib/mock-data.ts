import type { Task, Iteration, Quarter, Week, Dependency, EODUpdate, TaskStatus } from "./types";

// ============================================
// DATA FROM CSV ONLY - Q2 Milestones spreadsheet
// ============================================

export const CATEGORIES = [
  "Customer Success & PG Acquisition",
  "Product / Engineering / Workflows",
  "Cybersecurity",
  "Continuous Learning",
  "Talent Acquisition",
  "Branding",
] as const;

export type Category = (typeof CATEGORIES)[number];

// Quarter milestone goals per category (from "Q2 Milestones" column in CSV)
export const QUARTER_GOALS: Record<Category, string[]> = {
  "Customer Success & PG Acquisition": [
    "Transition all users in unsaturated regions/MSAs to be contracted under the new entity, with the exception of San Antonio, DFW, OKC, Wichita Falls, Amarillo, Lubbock, Boston, and Providence (+ Other High Risk Accounts)",
    "Kick off and execute enterprise acquisition initiatives across all PG verticals",
  ],
  "Product / Engineering / Workflows": [
    "All system-workflow-task-actions with Orchestrator fleshed out for Market Analysis, PG Acquisition, Customer Success",
    "MVP - Ready to Pilot + Pilot in Progress",
  ],
  "Cybersecurity": [
    "SSP - GovRamp & FedRamp POV",
    "3PAO Audit Readiness",
    "HIPAA + SOC2 Certified",
  ],
  "Continuous Learning": [
    "Knowledge and Culture Materials Workflows + Systems",
    "Foundation + Build + Adoption",
  ],
  "Talent Acquisition": [
    "Hiring Engine Defined",
    "Onboarding Immediate Hiring Requirements",
    "Pre, During, Post Hiring Plans",
  ],
  "Branding": [],
};

export const MOCK_QUARTER: Quarter = {
  id: "q2-2026",
  name: "Q2 2026",
  start_date: "2026-04-06",
  end_date: "2026-07-04",
};

export const MOCK_ITERATIONS: Iteration[] = [
  { id: "ip1", quarter_id: "q2-2026", name: "Iteration 1", iteration_number: 1, start_date: "2026-04-06", end_date: "2026-04-26" },
  { id: "ip2", quarter_id: "q2-2026", name: "Iteration 2", iteration_number: 2, start_date: "2026-04-27", end_date: "2026-05-17" },
  { id: "ip3", quarter_id: "q2-2026", name: "Iteration 3", iteration_number: 3, start_date: "2026-05-18", end_date: "2026-06-07" },
  { id: "ip4", quarter_id: "q2-2026", name: "Iteration 4", iteration_number: 4, start_date: "2026-06-08", end_date: "2026-07-04" },
];

export const MOCK_WEEKS: Week[] = [
  { id: "w1-ip1", iteration_id: "ip1", week_number: 1, start_date: "2026-04-06", end_date: "2026-04-12" },
  { id: "w2-ip1", iteration_id: "ip1", week_number: 2, start_date: "2026-04-13", end_date: "2026-04-19" },
  { id: "w3-ip1", iteration_id: "ip1", week_number: 3, start_date: "2026-04-20", end_date: "2026-04-26" },
  { id: "w1-ip2", iteration_id: "ip2", week_number: 1, start_date: "2026-04-27", end_date: "2026-05-03" },
  { id: "w2-ip2", iteration_id: "ip2", week_number: 2, start_date: "2026-05-04", end_date: "2026-05-10" },
  { id: "w3-ip2", iteration_id: "ip2", week_number: 3, start_date: "2026-05-11", end_date: "2026-05-17" },
  { id: "w1-ip3", iteration_id: "ip3", week_number: 1, start_date: "2026-05-18", end_date: "2026-05-24" },
  { id: "w2-ip3", iteration_id: "ip3", week_number: 2, start_date: "2026-05-25", end_date: "2026-05-31" },
  { id: "w3-ip3", iteration_id: "ip3", week_number: 3, start_date: "2026-06-01", end_date: "2026-06-07" },
  { id: "w1-ip4", iteration_id: "ip4", week_number: 1, start_date: "2026-06-08", end_date: "2026-06-14" },
  { id: "w2-ip4", iteration_id: "ip4", week_number: 2, start_date: "2026-06-15", end_date: "2026-06-21" },
  { id: "w3-ip4", iteration_id: "ip4", week_number: 3, start_date: "2026-06-22", end_date: "2026-07-04" },
];

// Team members / owners
export const OWNERS = [
  { id: "owner-leah", name: "Leah", email: "leah@eonexea.com" },
  { id: "owner-resources", name: "Resources", email: "resources@eonexea.com" },
  { id: "owner-unassigned", name: "Unassigned", email: "" },
] as const;

// Week reports structure
export interface WeekReport {
  weekId: string;
  type: "wednesday" | "saturday";
  content: string;
  fileUrl?: string;
  feedback?: { rating: number; comment: string; by: string; createdAt: string }[];
}

export const MOCK_WEEK_REPORTS: WeekReport[] = [];

// Helper - creates task placed at iteration level (from CSV iteration columns)
function mk(id: string, title: string, cat: Category, iterationId: string, status: TaskStatus = "not_started"): Task {
  const iter = MOCK_ITERATIONS.find(i => i.id === iterationId)!;
  return {
    id, title, category: cat, status,
    quarter_id: "q2-2026", iteration_id: iterationId,
    start_date: iter.start_date, end_date: iter.end_date,
    deadline: iter.end_date,
    progress: status === "completed" ? 100 : status === "in_progress" ? 40 : 0,
    created_at: "2026-04-06T00:00:00Z", updated_at: "2026-04-06T00:00:00Z",
    subtasks: [], deliverables: [], feedback: [],
  };
}

// ============================================
// TASKS - EXACTLY as listed in CSV iteration columns
// ============================================
export const MOCK_TASKS: Task[] = [
  // --- Customer Success & PG Acquisition ---
  // Iteration 1
  mk("cs-data-analysis", "Data Analysis + Execution Strategy: UnSaturated MSAs Transition Plan", "Customer Success & PG Acquisition", "ip1", "not_started"),
  mk("cs-vision-doc", "Vision_Strategy_Tactics_Ops Doc", "Customer Success & PG Acquisition", "ip1", "not_started"),
  mk("cs-outreach-engagement", "Outreach + Engagement", "Customer Success & PG Acquisition", "ip1", "not_started"),
  mk("pg-chc-plan", "CHC Execution Plan", "Customer Success & PG Acquisition", "ip1", "not_started"),
  // Iteration 2
  mk("cs-outreach-all", "Outreach + Engagement - All Transition", "Customer Success & PG Acquisition", "ip2"),
  mk("pg-chc-exec", "CHC Acquisition Execution", "Customer Success & PG Acquisition", "ip2"),
  mk("pg-housecalls", "Housecalls + Health Science Centers + Hospital Based Groups: Planning + Execution", "Customer Success & PG Acquisition", "ip2"),
  mk("pg-remaining-verticals", "Remaining Verticals: Planning + Ready to Execute", "Customer Success & PG Acquisition", "ip2"),
  // Iteration 3
  mk("cs-low-risk-pilots", "Week 1 I3: Low Risk Pilots", "Customer Success & PG Acquisition", "ip3"),
  mk("pg-medium-high-risk", "Week 3 I3: Medium + High Risk Pilots", "Customer Success & PG Acquisition", "ip3"),
  mk("pg-remaining-v-exec", "Remaining Verticals: Planning + Ready to Execute", "Customer Success & PG Acquisition", "ip3"),
  // Iteration 4
  mk("cs-all-risk-pilots", "Low + Medium Risk Pilots", "Customer Success & PG Acquisition", "ip4"),
  mk("pg-all-verticals", "All PG Verticals: Execution", "Customer Success & PG Acquisition", "ip4"),

  // --- Product / Engineering / Workflows ---
  // Iteration 1
  mk("eng-mvp-demo", "MVP - Demo: With All Features Defined", "Product / Engineering / Workflows", "ip1"),
  mk("eng-orchestrator", "All system-workflow-task-actions with Orchestrator fleshed out for Market Analysis, Enterprise PG Acquisition, Customer Success", "Product / Engineering / Workflows", "ip1"),
  mk("eng-architecture", "System Architecture laid out by an Expert Architect", "Product / Engineering / Workflows", "ip1"),
  mk("eng-devops", "DevOps: Onboarded + Set Up done", "Product / Engineering / Workflows", "ip1"),
  mk("eng-dev-team", "Development Team Onboarded + Requirements Shared + Set up Complete", "Product / Engineering / Workflows", "ip1"),
  // Iteration 2
  mk("eng-unit-testing", "Independent Unit Testing", "Product / Engineering / Workflows", "ip2"),
  mk("eng-pilot-readiness", "V1 - Pilot Readiness Testing", "Product / Engineering / Workflows", "ip2"),
  mk("eng-marketer-reqs", "Marketer Account: Requirements Defined", "Product / Engineering / Workflows", "ip2"),
  mk("eng-sa-pg-plan", "SA / Regional PG Acquisition Plan defined", "Product / Engineering / Workflows", "ip2"),
  // Iteration 3
  mk("eng-pilot-low-risk", "Pilot 1: Low Risk Accounts in Progress", "Product / Engineering / Workflows", "ip3"),
  mk("eng-v2-testing", "V2 - Testing", "Product / Engineering / Workflows", "ip3"),
  mk("eng-chc-integration", "CHC Tool + All Verticals Acquisition Tool: Integration to MVP", "Product / Engineering / Workflows", "ip3"),
  // Iteration 4
  mk("eng-transition-mvp", "Transition PGs + HHAHs on MVP", "Product / Engineering / Workflows", "ip4"),
  mk("eng-marketer-builtin", "Marketer Account: Built in", "Product / Engineering / Workflows", "ip4"),

  // --- Cybersecurity ---
  // Iteration 1
  mk("cyber-fte", "FTE engagement", "Cybersecurity", "ip1"),
  mk("cyber-govramp-plan", "GovRamp Project Plan", "Cybersecurity", "ip1"),
  mk("cyber-vendor-disc", "Vendor Discussions ON GovRamp + FedRamp", "Cybersecurity", "ip1"),
  // Iteration 2
  mk("cyber-govramp-cont", "Contt GovRamp + FedRamp", "Cybersecurity", "ip2"),
  mk("cyber-hipaa-cert", "HIPAA Certification", "Cybersecurity", "ip2"),
  mk("cyber-govramp-tbd", "TBD: GovRamp Project Plan", "Cybersecurity", "ip2"),
  // Iteration 3
  mk("cyber-soc2-cert", "SOC2 Certification", "Cybersecurity", "ip3"),
  mk("cyber-govramp-cont2", "Contt GovRamp + FedRamp", "Cybersecurity", "ip3"),
  mk("cyber-govramp-tbd2", "TBD: GovRamp Project Plan", "Cybersecurity", "ip3"),
  // Iteration 4
  mk("cyber-ssp-review", "SSP: Ready for Review", "Cybersecurity", "ip4"),
  mk("cyber-govramp-tbd3", "TBD: GovRamp Project Plan", "Cybersecurity", "ip4"),

  // --- Continuous Learning ---
  // Iteration 1
  mk("cl-soul-doc", "Soul Doc - Continuous Learning + Culture", "Continuous Learning", "ip1"),
  mk("cl-culture-principles", "Outline culture principles + communication guidelines", "Continuous Learning", "ip1"),
  mk("cl-identify-workflows", "Identify critical workflows", "Continuous Learning", "ip1"),
  // Iteration 2
  mk("cl-central-knowledge", "Set up a central knowledge system", "Continuous Learning", "ip2"),
  mk("cl-doc-templates", "Standardize documentation format: Templates for SOPs, playbooks, updates", "Continuous Learning", "ip2"),
  mk("cl-system-workflows-v1", "System + Workflows: V1", "Continuous Learning", "ip2"),
  // Iteration 3
  mk("cl-internal-adoption", "Start internal adoption across teams", "Continuous Learning", "ip3"),
  mk("cl-training-modules", "Introduce training/onboarding modules using these materials", "Continuous Learning", "ip3"),
  mk("cl-system-workflows-v1b", "System + Workflows: V1", "Continuous Learning", "ip3"),
  mk("cl-role-dashboards", "Role-based dashboards/views: Requirements Defined", "Continuous Learning", "ip3"),
  // Iteration 4
  mk("cl-track-optimize", "Track usage + optimize gaps", "Continuous Learning", "ip4"),
  mk("cl-live-system", "A live, structured knowledge system", "Continuous Learning", "ip4"),

  // --- Talent Acquisition ---
  // Iteration 1
  mk("ta-engine", "TA Engine: Workflows", "Talent Acquisition", "ip1"),
  mk("ta-cybersec-interns", "Pipeline: CyberSec Interns", "Talent Acquisition", "ip1"),
  mk("ta-onboard-cybersec-fte", "Onboard: CyberSec FTE", "Talent Acquisition", "ip1"),
  mk("ta-cs-interns-plan", "Plan to hire: Computer science Interns", "Talent Acquisition", "ip1"),
  mk("ta-onboard-engg", "Onboard: Engg Vendors", "Talent Acquisition", "ip1"),
  // Iteration 2
  mk("ta-core-architecture", "Core Talent Architecture is established", "Talent Acquisition", "ip2"),
  mk("ta-sourcing-pipelines", "Initial multi-channel sourcing pipelines are activated", "Talent Acquisition", "ip2"),
  mk("ta-frameworks", "Frameworks and reporting cadences", "Talent Acquisition", "ip2"),
  mk("ta-onboard-cyber-interns", "Onboard Cyber Sec Interns", "Talent Acquisition", "ip2"),
  mk("ta-kpis", "TA KPIs: Identified and defined", "Talent Acquisition", "ip2"),
  // Iteration 3
  mk("ta-operational-engine", "A fully defined and operational hiring engine", "Talent Acquisition", "ip3"),
  mk("ta-performance-tracking", "Performance tracking systems are implemented", "Talent Acquisition", "ip3"),
  mk("ta-onboard-cs-interns", "Onboard CS interns", "Talent Acquisition", "ip3"),
  // Iteration 4
  mk("ta-integrated-systems", "Pipelines, performance tracking, and learning systems are all integrated", "Talent Acquisition", "ip4"),

  // --- Branding ---
  // Iteration 1
  mk("brand-website", "Website Up", "Branding", "ip1"),
  mk("brand-chc-tool", "CHC Tool - Plan till August Conferences", "Branding", "ip1"),
  mk("brand-infra", "Infra Set Up: Social Media, Websites, Phone, emails etc", "Branding", "ip1"),
  // Iteration 2
  mk("brand-social-media", "Social Media Branding Executed", "Branding", "ip2"),
  mk("brand-content-themes", "Content themes laid out", "Branding", "ip2"),
  // Iteration 3
  mk("brand-consistent", "Consistent branding across channels", "Branding", "ip3"),
  // Iteration 4
  mk("brand-refine", "Refine messaging based on what's working in the market", "Branding", "ip4"),
  mk("brand-double-down", "Double down on content and narratives that perform", "Branding", "ip4"),
];

// Dependencies (logical from CSV flow)
export const MOCK_DEPENDENCIES: Dependency[] = [
  { id: "dep1", task_id: "cs-outreach-all", depends_on_task_id: "cs-data-analysis" },
  { id: "dep2", task_id: "cs-low-risk-pilots", depends_on_task_id: "cs-outreach-all" },
  { id: "dep3", task_id: "cs-all-risk-pilots", depends_on_task_id: "cs-low-risk-pilots" },
  { id: "dep4", task_id: "pg-chc-exec", depends_on_task_id: "pg-chc-plan" },
  { id: "dep5", task_id: "pg-medium-high-risk", depends_on_task_id: "pg-chc-exec" },
  { id: "dep6", task_id: "pg-all-verticals", depends_on_task_id: "pg-medium-high-risk" },
  { id: "dep7", task_id: "eng-unit-testing", depends_on_task_id: "eng-architecture" },
  { id: "dep8", task_id: "eng-pilot-readiness", depends_on_task_id: "eng-unit-testing" },
  { id: "dep9", task_id: "eng-pilot-low-risk", depends_on_task_id: "eng-pilot-readiness" },
  { id: "dep10", task_id: "eng-v2-testing", depends_on_task_id: "eng-pilot-readiness" },
  { id: "dep11", task_id: "eng-dev-team", depends_on_task_id: "eng-architecture" },
  { id: "dep12", task_id: "cyber-govramp-cont", depends_on_task_id: "cyber-vendor-disc" },
  { id: "dep13", task_id: "cyber-hipaa-cert", depends_on_task_id: "cyber-fte" },
  { id: "dep14", task_id: "cyber-soc2-cert", depends_on_task_id: "cyber-hipaa-cert" },
  { id: "dep15", task_id: "cyber-ssp-review", depends_on_task_id: "cyber-soc2-cert" },
  { id: "dep16", task_id: "cl-central-knowledge", depends_on_task_id: "cl-soul-doc" },
  { id: "dep17", task_id: "cl-internal-adoption", depends_on_task_id: "cl-central-knowledge" },
  { id: "dep18", task_id: "cl-track-optimize", depends_on_task_id: "cl-internal-adoption" },
  { id: "dep19", task_id: "ta-core-architecture", depends_on_task_id: "ta-engine" },
  { id: "dep20", task_id: "ta-operational-engine", depends_on_task_id: "ta-core-architecture" },
  { id: "dep21", task_id: "ta-integrated-systems", depends_on_task_id: "ta-operational-engine" },
  { id: "dep22", task_id: "brand-social-media", depends_on_task_id: "brand-infra" },
  { id: "dep23", task_id: "brand-consistent", depends_on_task_id: "brand-social-media" },
];

export const MOCK_EOD_UPDATES: EODUpdate[] = [];
