-- ============================================
-- SEED DATA from Q2 Milestones Spreadsheet
-- ============================================

-- Allow specific emails
INSERT INTO allowed_emails (email, role) VALUES
  ('admin@eonexea.com', 'admin'),
  ('momentum@eonexea.com', 'mimimomentum'),
  ('team@eonexea.com', 'eonexea')
ON CONFLICT (email) DO NOTHING;

-- Quarter
INSERT INTO quarters (id, name, start_date, end_date) VALUES
  ('q2-2026', 'Q2 2026', '2026-04-01', '2026-06-30')
ON CONFLICT DO NOTHING;

-- Iterations
INSERT INTO iterations (id, quarter_id, name, iteration_number, start_date, end_date) VALUES
  ('ip1', 'q2-2026', 'Iteration Period 1 (Week 1-3)', 1, '2026-04-01', '2026-04-21'),
  ('ip2', 'q2-2026', 'IP 2 (Week 4-6)', 2, '2026-04-22', '2026-05-12'),
  ('ip3', 'q2-2026', 'IP 3 (Week 7-9)', 3, '2026-05-13', '2026-06-02'),
  ('ip4', 'q2-2026', 'Macro Mi 4', 4, '2026-06-03', '2026-06-30')
ON CONFLICT DO NOTHING;

-- Weeks for each iteration
INSERT INTO weeks (id, iteration_id, week_number, start_date, end_date) VALUES
  ('w1-ip1', 'ip1', 1, '2026-04-01', '2026-04-07'),
  ('w2-ip1', 'ip1', 2, '2026-04-08', '2026-04-14'),
  ('w3-ip1', 'ip1', 3, '2026-04-15', '2026-04-21'),
  ('w1-ip2', 'ip2', 1, '2026-04-22', '2026-04-28'),
  ('w2-ip2', 'ip2', 2, '2026-04-29', '2026-05-05'),
  ('w3-ip2', 'ip2', 3, '2026-05-06', '2026-05-12'),
  ('w1-ip3', 'ip3', 1, '2026-05-13', '2026-05-19'),
  ('w2-ip3', 'ip3', 2, '2026-05-20', '2026-05-26'),
  ('w3-ip3', 'ip3', 3, '2026-05-27', '2026-06-02'),
  ('w1-ip4', 'ip4', 1, '2026-06-03', '2026-06-09'),
  ('w2-ip4', 'ip4', 2, '2026-06-10', '2026-06-16'),
  ('w3-ip4', 'ip4', 3, '2026-06-17', '2026-06-23')
ON CONFLICT DO NOTHING;

-- ============================================
-- CUSTOMER SUCCESS TASKS
-- ============================================
INSERT INTO tasks (id, title, description, category, status, quarter_id, iteration_id, start_date, end_date, deadline) VALUES
  ('cs-transition', 'Transition Unsaturated Regions/MSAs', 'Transition all users in unsaturated regions/MSAs to be contracted under the new entity, with the exception of San Antonio, DFW, OKC, Wichita Falls, Amarillo, Lubbock, Boston, and Providence (+ Other High Risk Accounts)', 'Customer Success', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-06-30', '2026-06-30'),
  ('cs-data-analysis', 'Data Analysis + Execution Strategy: UnSaturated MSAs Transition Plan', 'Vision_Strategy_Tactics_Ops Doc + Outreach + Engagement', 'Customer Success', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-04-21', '2026-04-21'),
  ('cs-outreach-all', 'Outreach + Engagement - All Transition', NULL, 'Customer Success', 'not_started', 'q2-2026', 'ip2', '2026-04-22', '2026-05-12', '2026-05-12'),
  ('cs-low-risk-pilots', 'Week 1 I3: Low Risk Pilots', NULL, 'Customer Success', 'not_started', 'q2-2026', 'ip3', '2026-05-13', '2026-06-02', '2026-06-02'),
  ('cs-all-risk-pilots', 'Low + Medium Risk Pilots', NULL, 'Customer Success', 'not_started', 'q2-2026', 'ip4', '2026-06-03', '2026-06-30', '2026-06-30')
ON CONFLICT DO NOTHING;

-- ============================================
-- PG ACQUISITION TASKS
-- ============================================
INSERT INTO tasks (id, title, description, category, status, quarter_id, iteration_id, start_date, end_date, deadline) VALUES
  ('pg-kickoff', 'Kick Off Enterprise Acquisition Initiatives', 'Kick off and execute enterprise acquisition initiatives across all PG verticals', 'PG Acquisition', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-06-30', '2026-06-30'),
  ('pg-chc-plan', 'CHC Execution Plan', NULL, 'PG Acquisition', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-04-21', '2026-04-21'),
  ('pg-chc-exec', 'CHC Acquisition Execution', NULL, 'PG Acquisition', 'not_started', 'q2-2026', 'ip2', '2026-04-22', '2026-05-12', '2026-05-12'),
  ('pg-housecalls', 'Housecalls + Health Science Centers + Hospital Based Groups Planning', 'Housecalls + Health Science Centers + Hospital Based Groups: Planning + execution. Remaining Verticals: Planning + Ready to execute', 'PG Acquisition', 'not_started', 'q2-2026', 'ip2', '2026-04-22', '2026-05-12', '2026-05-12'),
  ('pg-medium-risk', 'Week 3 I3: Medium + High Risk Pilots', NULL, 'PG Acquisition', 'not_started', 'q2-2026', 'ip3', '2026-05-13', '2026-06-02', '2026-06-02'),
  ('pg-all-verticals', 'All PG Verticals: Execution', NULL, 'PG Acquisition', 'not_started', 'q2-2026', 'ip4', '2026-06-03', '2026-06-30', '2026-06-30')
ON CONFLICT DO NOTHING;

-- ============================================
-- PRODUCT / ENGINEERING / WORKFLOWS
-- ============================================
INSERT INTO tasks (id, title, description, category, status, quarter_id, iteration_id, start_date, end_date, deadline) VALUES
  ('eng-orchestrator', 'All System Workflow Task Actions with Orchestrator', 'All system-workflow-task-actions with Orchestrator fleshed out for Market Analysis, PG Acquisition, Customer Success', 'Product / Engineering', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-06-30', '2026-06-30'),
  ('eng-mvp-demo', 'MVP Demo: With All Features Defined', NULL, 'Product / Engineering', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-04-21', '2026-04-21'),
  ('eng-mvp-pilot', 'MVP Ready to Pilot + Pilot in Progress', NULL, 'Product / Engineering', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-06-30', '2026-06-30'),
  ('eng-architecture', 'System Architecture Laid Out by Expert Architect', NULL, 'Product / Engineering', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-04-21', '2026-04-21'),
  ('eng-devops', 'DevOps: Onboarded + Set Up Done', NULL, 'Product / Engineering', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-04-21', '2026-04-21'),
  ('eng-dev-team', 'Development Team Onboarded + Requirements Shared + Set Up Complete', NULL, 'Product / Engineering', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-04-21', '2026-04-21'),
  ('eng-unit-testing', 'Independent Unit Testing', NULL, 'Product / Engineering', 'not_started', 'q2-2026', 'ip2', '2026-04-22', '2026-05-12', '2026-05-12'),
  ('eng-pilot-readiness', 'V1 Pilot Readiness Testing', NULL, 'Product / Engineering', 'not_started', 'q2-2026', 'ip2', '2026-04-22', '2026-05-12', '2026-05-12'),
  ('eng-marketer-reqs', 'Marketer Account: Requirements Defined', NULL, 'Product / Engineering', 'not_started', 'q2-2026', 'ip2', '2026-04-22', '2026-05-12', '2026-05-12'),
  ('eng-sa-pg-plan', 'SA / Regional PG Acquisition Plan Defined', NULL, 'Product / Engineering', 'not_started', 'q2-2026', 'ip2', '2026-04-22', '2026-05-12', '2026-05-12'),
  ('eng-pilot-low-risk', 'Pilot 1: Low Risk Accounts in Progress', NULL, 'Product / Engineering', 'not_started', 'q2-2026', 'ip3', '2026-05-13', '2026-06-02', '2026-06-02'),
  ('eng-v2-testing', 'V2 Testing', NULL, 'Product / Engineering', 'not_started', 'q2-2026', 'ip3', '2026-05-13', '2026-06-02', '2026-06-02'),
  ('eng-chc-integration', 'CHC Tool + All Verticals Acquisition Tool: Integration to MVP', NULL, 'Product / Engineering', 'not_started', 'q2-2026', 'ip3', '2026-05-13', '2026-06-02', '2026-06-02'),
  ('eng-transition-mvp', 'Transition PGs + HHAHs on MVP', NULL, 'Product / Engineering', 'not_started', 'q2-2026', 'ip4', '2026-06-03', '2026-06-30', '2026-06-30'),
  ('eng-marketer-builtin', 'Marketer Account: Built In', NULL, 'Product / Engineering', 'not_started', 'q2-2026', 'ip4', '2026-06-03', '2026-06-30', '2026-06-30')
ON CONFLICT DO NOTHING;

-- ============================================
-- CYBERSECURITY
-- ============================================
INSERT INTO tasks (id, title, description, category, status, quarter_id, iteration_id, start_date, end_date, deadline) VALUES
  ('cyber-ssp', 'SSP - GovRamp & FedRamp POV', NULL, 'Cybersecurity', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-06-30', '2026-06-30'),
  ('cyber-fte', 'FTE Engagement', NULL, 'Cybersecurity', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-04-21', '2026-04-21'),
  ('cyber-govramp-plan', 'GovRamp Project Plan', NULL, 'Cybersecurity', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-04-21', '2026-04-21'),
  ('cyber-vendor-disc', 'Vendor Discussions ON GovRamp + FedRamp', NULL, 'Cybersecurity', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-04-21', '2026-04-21'),
  ('cyber-3pao', '3PAO Audit Readiness', NULL, 'Cybersecurity', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-06-30', '2026-06-30'),
  ('cyber-hipaa-soc2', 'HIPAA + SOC2 Certified', NULL, 'Cybersecurity', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-06-30', '2026-06-30'),
  ('cyber-govramp-cont', 'Continue GovRamp + FedRamp', NULL, 'Cybersecurity', 'not_started', 'q2-2026', 'ip2', '2026-04-22', '2026-05-12', '2026-05-12'),
  ('cyber-hipaa-cert', 'HIPAA Certification', NULL, 'Cybersecurity', 'not_started', 'q2-2026', 'ip2', '2026-04-22', '2026-05-12', '2026-05-12'),
  ('cyber-govramp-tbd', 'TBD: GovRamp Project Plan', NULL, 'Cybersecurity', 'not_started', 'q2-2026', 'ip2', '2026-04-22', '2026-05-12', '2026-05-12'),
  ('cyber-soc2-cert', 'SOC2 Certification', NULL, 'Cybersecurity', 'not_started', 'q2-2026', 'ip3', '2026-05-13', '2026-06-02', '2026-06-02'),
  ('cyber-ssp-review', 'SSP: Ready for Review', NULL, 'Cybersecurity', 'not_started', 'q2-2026', 'ip4', '2026-06-03', '2026-06-30', '2026-06-30'),
  ('cyber-govramp-tbd2', 'TBD: GovRamp Project Plan (Final)', NULL, 'Cybersecurity', 'not_started', 'q2-2026', 'ip4', '2026-06-03', '2026-06-30', '2026-06-30')
ON CONFLICT DO NOTHING;

-- ============================================
-- CONTINUOUS LEARNING
-- ============================================
INSERT INTO tasks (id, title, description, category, status, quarter_id, iteration_id, start_date, end_date, deadline) VALUES
  ('cl-knowledge', 'Knowledge and Culture Materials Workflows + Systems', NULL, 'Continuous Learning', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-06-30', '2026-06-30'),
  ('cl-soul-doc', 'Soul Doc - Continuous Learning + Culture', NULL, 'Continuous Learning', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-04-21', '2026-04-21'),
  ('cl-culture-principles', 'Outline Culture Principles + Communication Guidelines', NULL, 'Continuous Learning', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-04-21', '2026-04-21'),
  ('cl-identify-workflows', 'Identify Critical Workflows', NULL, 'Continuous Learning', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-04-21', '2026-04-21'),
  ('cl-foundation', 'Foundation + Build + Adoption', NULL, 'Continuous Learning', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-06-30', '2026-06-30'),
  ('cl-central-knowledge', 'Set Up Central Knowledge System', NULL, 'Continuous Learning', 'not_started', 'q2-2026', 'ip2', '2026-04-22', '2026-05-12', '2026-05-12'),
  ('cl-doc-templates', 'Standardize Documentation Format: Templates for SOPs, Playbooks, Updates', NULL, 'Continuous Learning', 'not_started', 'q2-2026', 'ip2', '2026-04-22', '2026-05-12', '2026-05-12'),
  ('cl-system-workflows-v1', 'System + Workflows: V1', NULL, 'Continuous Learning', 'not_started', 'q2-2026', 'ip2', '2026-04-22', '2026-05-12', '2026-05-12'),
  ('cl-internal-adoption', 'Start Internal Adoption Across Teams', NULL, 'Continuous Learning', 'not_started', 'q2-2026', 'ip3', '2026-05-13', '2026-06-02', '2026-06-02'),
  ('cl-training-modules', 'Introduce Training/Onboarding Modules Using Materials', NULL, 'Continuous Learning', 'not_started', 'q2-2026', 'ip3', '2026-05-13', '2026-06-02', '2026-06-02'),
  ('cl-role-dashboards', 'Role-Based Dashboards/Views: Requirements Defined', NULL, 'Continuous Learning', 'not_started', 'q2-2026', 'ip3', '2026-05-13', '2026-06-02', '2026-06-02'),
  ('cl-track-optimize', 'Track Usage + Optimize Gaps', NULL, 'Continuous Learning', 'not_started', 'q2-2026', 'ip4', '2026-06-03', '2026-06-30', '2026-06-30'),
  ('cl-live-system', 'A Live, Structured Knowledge System', NULL, 'Continuous Learning', 'not_started', 'q2-2026', 'ip4', '2026-06-03', '2026-06-30', '2026-06-30')
ON CONFLICT DO NOTHING;

-- ============================================
-- TALENT ACQUISITION
-- ============================================
INSERT INTO tasks (id, title, description, category, status, quarter_id, iteration_id, start_date, end_date, deadline) VALUES
  ('ta-engine', 'TA Engine: Workflows', NULL, 'Talent Acquisition', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-04-21', '2026-04-21'),
  ('ta-hiring-engine', 'Hiring Engine Defined', NULL, 'Talent Acquisition', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-06-30', '2026-06-30'),
  ('ta-cybersec-interns', 'Pipeline: CyberSec Interns', NULL, 'Talent Acquisition', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-04-21', '2026-04-21'),
  ('ta-onboard-cybersec-fte', 'Onboard: CyberSec FTE', NULL, 'Talent Acquisition', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-04-21', '2026-04-21'),
  ('ta-cs-interns-plan', 'Plan to Hire: Computer Science Interns', NULL, 'Talent Acquisition', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-04-21', '2026-04-21'),
  ('ta-onboard-engg', 'Onboard: Engg Vendors', NULL, 'Talent Acquisition', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-04-21', '2026-04-21'),
  ('ta-onboard-immediate', 'Onboarding Immediate Hiring Requirements', NULL, 'Talent Acquisition', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-06-30', '2026-06-30'),
  ('ta-pre-during-post', 'Pre, During, Post Hiring Plans', NULL, 'Talent Acquisition', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-06-30', '2026-06-30'),
  ('ta-core-architecture', 'Core Talent Architecture Established', NULL, 'Talent Acquisition', 'not_started', 'q2-2026', 'ip2', '2026-04-22', '2026-05-12', '2026-05-12'),
  ('ta-sourcing-pipelines', 'Initial Multi-Channel Sourcing Pipelines Activated', NULL, 'Talent Acquisition', 'not_started', 'q2-2026', 'ip2', '2026-04-22', '2026-05-12', '2026-05-12'),
  ('ta-frameworks-reporting', 'Frameworks and Reporting Cadences', NULL, 'Talent Acquisition', 'not_started', 'q2-2026', 'ip2', '2026-04-22', '2026-05-12', '2026-05-12'),
  ('ta-onboard-cyber-interns', 'Onboard Cyber Sec Interns', NULL, 'Talent Acquisition', 'not_started', 'q2-2026', 'ip2', '2026-04-22', '2026-05-12', '2026-05-12'),
  ('ta-kpis', 'TA KPIs: Identified and Defined', NULL, 'Talent Acquisition', 'not_started', 'q2-2026', 'ip2', '2026-04-22', '2026-05-12', '2026-05-12'),
  ('ta-operational-engine', 'A Fully Defined and Operational Hiring Engine', NULL, 'Talent Acquisition', 'not_started', 'q2-2026', 'ip3', '2026-05-13', '2026-06-02', '2026-06-02'),
  ('ta-performance-tracking', 'Performance Tracking Systems Implemented', NULL, 'Talent Acquisition', 'not_started', 'q2-2026', 'ip3', '2026-05-13', '2026-06-02', '2026-06-02'),
  ('ta-onboard-cs-interns', 'Onboard CS Interns', NULL, 'Talent Acquisition', 'not_started', 'q2-2026', 'ip3', '2026-05-13', '2026-06-02', '2026-06-02'),
  ('ta-integrated-systems', 'Pipelines, Performance Tracking, and Learning Systems All Integrated', NULL, 'Talent Acquisition', 'not_started', 'q2-2026', 'ip4', '2026-06-03', '2026-06-30', '2026-06-30')
ON CONFLICT DO NOTHING;

-- ============================================
-- BRANDING
-- ============================================
INSERT INTO tasks (id, title, description, category, status, quarter_id, iteration_id, start_date, end_date, deadline) VALUES
  ('brand-website', 'Website Up', NULL, 'Branding', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-04-21', '2026-04-21'),
  ('brand-chc-tool', 'CHC Tool - Plan till August Conferences', NULL, 'Branding', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-04-21', '2026-04-21'),
  ('brand-infra', 'Infra Set Up: Social Media, Websites, Phone, Emails etc', NULL, 'Branding', 'not_started', 'q2-2026', 'ip1', '2026-04-01', '2026-04-21', '2026-04-21'),
  ('brand-social-media', 'Social Media Branding Executed', NULL, 'Branding', 'not_started', 'q2-2026', 'ip2', '2026-04-22', '2026-05-12', '2026-05-12'),
  ('brand-content-themes', 'Content Themes Laid Out', NULL, 'Branding', 'not_started', 'q2-2026', 'ip2', '2026-04-22', '2026-05-12', '2026-05-12'),
  ('brand-consistent', 'Consistent Branding Across Channels', NULL, 'Branding', 'not_started', 'q2-2026', 'ip3', '2026-05-13', '2026-06-02', '2026-06-02'),
  ('brand-refine', 'Refine Messaging Based on Market Performance', NULL, 'Branding', 'not_started', 'q2-2026', 'ip4', '2026-06-03', '2026-06-30', '2026-06-30'),
  ('brand-double-down', 'Double Down on Content and Narratives That Perform', NULL, 'Branding', 'not_started', 'q2-2026', 'ip4', '2026-06-03', '2026-06-30', '2026-06-30')
ON CONFLICT DO NOTHING;

-- ============================================
-- DEPENDENCIES
-- ============================================
INSERT INTO dependencies (task_id, depends_on_task_id) VALUES
  -- CS: outreach depends on data analysis
  ('cs-outreach-all', 'cs-data-analysis'),
  -- CS: low risk pilots depend on outreach
  ('cs-low-risk-pilots', 'cs-outreach-all'),
  -- CS: all risk pilots depend on low risk pilots
  ('cs-all-risk-pilots', 'cs-low-risk-pilots'),
  -- PG: CHC execution depends on CHC plan
  ('pg-chc-exec', 'pg-chc-plan'),
  -- PG: medium risk depends on CHC execution
  ('pg-medium-risk', 'pg-chc-exec'),
  -- PG: all verticals depends on medium risk
  ('pg-all-verticals', 'pg-medium-risk'),
  -- Eng: unit testing depends on architecture
  ('eng-unit-testing', 'eng-architecture'),
  -- Eng: pilot readiness depends on unit testing
  ('eng-pilot-readiness', 'eng-unit-testing'),
  -- Eng: pilot depends on pilot readiness
  ('eng-pilot-low-risk', 'eng-pilot-readiness'),
  -- Eng: v2 testing depends on pilot readiness
  ('eng-v2-testing', 'eng-pilot-readiness'),
  -- Eng: MVP demo depends on orchestrator
  ('eng-mvp-demo', 'eng-orchestrator'),
  -- Eng: dev team onboarding depends on architecture
  ('eng-dev-team', 'eng-architecture'),
  -- Cyber: continue depends on vendor discussions
  ('cyber-govramp-cont', 'cyber-vendor-disc'),
  -- Cyber: HIPAA cert depends on FTE engagement
  ('cyber-hipaa-cert', 'cyber-fte'),
  -- Cyber: SOC2 cert depends on HIPAA cert
  ('cyber-soc2-cert', 'cyber-hipaa-cert'),
  -- Cyber: SSP review depends on SOC2
  ('cyber-ssp-review', 'cyber-soc2-cert'),
  -- CL: central knowledge depends on soul doc
  ('cl-central-knowledge', 'cl-soul-doc'),
  -- CL: internal adoption depends on central knowledge
  ('cl-internal-adoption', 'cl-central-knowledge'),
  -- CL: track optimize depends on internal adoption
  ('cl-track-optimize', 'cl-internal-adoption'),
  -- TA: core architecture depends on engine workflows
  ('ta-core-architecture', 'ta-engine'),
  -- TA: operational engine depends on core architecture
  ('ta-operational-engine', 'ta-core-architecture'),
  -- TA: integrated systems depends on operational engine
  ('ta-integrated-systems', 'ta-operational-engine'),
  -- Brand: social media depends on infra
  ('brand-social-media', 'brand-infra'),
  -- Brand: consistent depends on social media
  ('brand-consistent', 'brand-social-media')
ON CONFLICT DO NOTHING;
