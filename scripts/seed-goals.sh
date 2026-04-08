#!/bin/bash
KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhsaXBjd2pscmd1eHdmaW1waG53Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTQxMjk2MiwiZXhwIjoyMDkwOTg4OTYyfQ.Fm4zLXihsSTJP3q3MZg7HKveA4QvOaM-mmPNPL0sYpI"
URL="https://xlipcwjlrguxwfimphnw.supabase.co/rest/v1"
QID="c7413037-733f-4634-87ef-623b71301e30"

curl -s -X POST "$URL/quarter_goals" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "[
    {\"quarter_id\":\"$QID\",\"category\":\"Customer Success & PG Acquisition\",\"goal\":\"Transition all users in unsaturated regions/MSAs to be contracted under the new entity, with the exception of San Antonio, DFW, OKC, Wichita Falls, Amarillo, Lubbock, Boston, and Providence (+ Other High Risk Accounts)\",\"sort_order\":1},
    {\"quarter_id\":\"$QID\",\"category\":\"Customer Success & PG Acquisition\",\"goal\":\"Kick off and execute enterprise acquisition initiatives across all PG verticals\",\"sort_order\":2},
    {\"quarter_id\":\"$QID\",\"category\":\"Product / Engineering / Workflows\",\"goal\":\"All system-workflow-task-actions with Orchestrator fleshed out for Market Analysis, PG Acquisition, Customer Success\",\"sort_order\":1},
    {\"quarter_id\":\"$QID\",\"category\":\"Product / Engineering / Workflows\",\"goal\":\"MVP - Ready to Pilot + Pilot in Progress\",\"sort_order\":2},
    {\"quarter_id\":\"$QID\",\"category\":\"Cybersecurity\",\"goal\":\"SSP - GovRamp & FedRamp POV\",\"sort_order\":1},
    {\"quarter_id\":\"$QID\",\"category\":\"Cybersecurity\",\"goal\":\"3PAO Audit Readiness\",\"sort_order\":2},
    {\"quarter_id\":\"$QID\",\"category\":\"Cybersecurity\",\"goal\":\"HIPAA + SOC2 Certified\",\"sort_order\":3},
    {\"quarter_id\":\"$QID\",\"category\":\"Continuous Learning\",\"goal\":\"Knowledge and Culture Materials Workflows + Systems\",\"sort_order\":1},
    {\"quarter_id\":\"$QID\",\"category\":\"Continuous Learning\",\"goal\":\"Foundation + Build + Adoption\",\"sort_order\":2},
    {\"quarter_id\":\"$QID\",\"category\":\"Talent Acquisition\",\"goal\":\"Hiring Engine Defined\",\"sort_order\":1},
    {\"quarter_id\":\"$QID\",\"category\":\"Talent Acquisition\",\"goal\":\"Onboarding Immediate Hiring Requirements\",\"sort_order\":2},
    {\"quarter_id\":\"$QID\",\"category\":\"Talent Acquisition\",\"goal\":\"Pre, During, Post Hiring Plans\",\"sort_order\":3}
  ]"
