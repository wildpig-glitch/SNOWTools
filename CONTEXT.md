# SNOWTools — Project Context

## What This App Does

SNOWTools is a Rovo agent Forge app that creates ServiceNow (SNOW) Change Requests from Jira releases,
enriched with context from Confluence architecture documentation.
It is a PoC deployed on `sk-demo-site.atlassian.net` (Jira + Confluence, development environment).

The agent guides the user through:
1. Specifying a Jira project key and release name
2. Fetching real release data (dates, issues) via the Jira REST API
3. Finding and reading an architecture reference page in Confluence
4. Performing a single unified analysis to derive risk, impact, change type, and three CR text sections
5. Asking the user to confirm recommendations and provide the assignment group
6. Creating the Change Request in ServiceNow

---

## App Identity

- **App ID**: `ari:cloud:ecosystem::app/8b2c8e05-c269-42a0-a25a-f2ff5eb67d33`
- **Agent key**: `snowtools-hello-world-agent`
- **Agent name**: SNOWTools
- **Environment**: development
- **Installed on**: `sk-demo-site.atlassian.net` (Jira + Confluence)
- **App directory**: `/Users/giannazzo/dev/SNOWTools`
- **GitHub**: https://github.com/wildpig-glitch/SNOWTools

### Deploy command
```bash
forge deploy --non-interactive -e development && forge install --non-interactive --upgrade --site sk-demo-site.atlassian.net --product jira --environment development
```

---

## Architecture

### Actions

| Action key | Function | Purpose |
|---|---|---|
| `get-jira-release` | `getJiraRelease` | Fetches a Jira version by project key + release name via Jira REST API. Returns name, description, startDate, releaseDate, and linked issues. |
| `create-snow-change-request` | `createSnowChangeRequest` | Creates a Change Request in ServiceNow via the Table API. |

### Forge Variables (credentials)
Set via `forge variables set --environment development <KEY> <VALUE>`:

| Variable | Purpose |
|---|---|
| `SNOW_INSTANCE_URL` | ServiceNow instance URL (e.g. `https://dev367049.service-now.com`) |
| `SNOW_USERNAME` | SNOW service account username |
| `SNOW_PASSWORD` | SNOW service account password |

### Permissions / Scopes
- `read:jira-work` — for Jira REST API calls (versions + issue search)
- `read:confluence-content.all` — for reading Confluence pages (architecture reference)
- `read:confluence-space.summary` — for searching Confluence spaces
- Egress: `*.service-now.com`

---

## Agent Flow (current)

### STEP 1: Ask for project key + release name
Agent always asks explicitly — never infers from context.

### STEP 2: Call `get-jira-release`
Fetches real Jira data via REST API. Uses version ID (not name) in JQL to avoid encoding issues.
Uses `/rest/api/3/search/jql` endpoint (the old `/rest/api/3/search` returns HTTP 410).

### STEP 3: Present release data + ask user to type dates
Shows issues, description, dates found in Jira. User must type dates explicitly.

### STEP 3b: Find architecture reference page in Confluence
Agent natively searches Confluence (has `read:confluence-content.all` scope):
1. Searches for a space matching the Jira project name
2. Within that space, searches for pages with "architecture" + release name in title
3. Falls back to "architecture" alone
4. If not found, asks user for a URL or to skip

### STEP 4: Single unified analysis
From ONE evaluation of issues + architecture doc, derives ALL of:
- Change type recommendation (normal/standard/emergency)
- Risk level (low/moderate/high — this SNOW instance only supports 3 values)
- Impact level (high/medium/low)
- Implementation Plan text
- Risk & Impact Analysis text (coherent with risk/impact recommendations)
- Test Plan text

Presents recommendations + draft sections to user. Asks user to explicitly type:
type, risk, impact, and assignment group.

### STEP 5: Confirm summary
Shows full CR details. Waits for user to type "yes".

### STEP 6: Call `create-snow-change-request`
Passes all collected values. The `additional_sections` input is a structured text block:
```
IMPLEMENTATION_PLAN: <text>
RISK_AND_IMPACT: <text>
TEST_PLAN: <text>
```
The handler's `parseAdditionalSections()` function parses this into individual SNOW fields.

### STEP 7: Report result
Returns CR number + link on success. Full error details on failure.

---

## Action Inputs (create-snow-change-request) — 10 inputs max

| Input | Source |
|---|---|
| `release_name` | From `get-jira-release` |
| `project_name` | Typed by user |
| `description` | Agent combines release description + issues list |
| `type` | Typed by user (agent recommends) |
| `risk` | Typed by user (agent recommends; mapped to SNOW numeric in handler) |
| `impact` | Typed by user (agent recommends; mapped to SNOW numeric in handler) |
| `assignment_group` | Typed by user |
| `start_date` | Typed by user (YYYY-MM-DD, handler appends time) |
| `end_date` | Typed by user (YYYY-MM-DD, handler appends time) |
| `additional_sections` | Agent-generated block: IMPLEMENTATION_PLAN / RISK_AND_IMPACT / TEST_PLAN |

---

## Key Technical Decisions & Lessons Learned

### 1. Teamwork graph does not reliably have JiraVersion data
`JiraVersion` nodes were not indexed for `sk-demo-site.atlassian.net`. Agent hallucinated data.
Switched to Jira REST API via `get-jira-release` action.

### 2. Rovo agents only pass to actions what the user explicitly typed
Data the agent looks up or presents does NOT automatically flow into action inputs.
Drove key decisions:
- All action inputs are `required: false` (prevents platform's form-fill behaviour)
- Agent prompt instructs user to explicitly type key values
- `release_name` and `project_name` are separate inputs

### 3. JQL double-encoding bug
`route` template literal auto-encodes values. Using `encodeURIComponent()` before `route` caused
double-encoding (`%25` errors). Fix: pass raw JQL string to `route`, let it handle encoding.

### 4. `/rest/api/3/search` endpoint removed (HTTP 410)
Must use `/rest/api/3/search/jql` instead. Discovered during testing.

### 5. SNOW field mappings
- **Risk**: SNOW instance supports 3 values only: `2`=High, `3`=Moderate, `4`=Low. `very_high` maps to `2`.
- **Impact**: `1`=High, `2`=Medium, `3`=Low
- **Planned dates**: Use `start_date` and `end_date` (NOT `planned_start_date`/`planned_end_date`)
- **Justification**: Constructed by handler from `release_name` + `project_name`
- **short_description**: Constructed by handler as "Release {release_name} - {project_name}"
- **description**: Pre-built by agent (release description + issues list)
- **Additional sections**: `implementation_plan`, `risk_impact_analysis`, `test_plan` — parsed from single `additional_sections` input

### 6. SNOW developer instances hibernate
Free SNOW instances go to sleep after inactivity. API calls get HTML login pages (HTTP 200).
Handler detects HTML responses and suggests waking the instance. Wake up at developer.servicenow.com.

### 7. SNOW response body read-once
Can't call both `response.json()` and `response.text()`. Fixed by reading text first, then `JSON.parse()`.

### 8. Confluence access requires explicit scopes in Forge
Rovo Studio agents get Confluence access automatically. Forge agents need explicit scopes:
`read:confluence-content.all` and `read:confluence-space.summary`.

### 9. Single unified analysis for coherence
Risk level, impact level, and Risk & Impact Analysis text are all derived from ONE evaluation pass.
Prevents inconsistency (e.g. analysis says "high risk" but field says "low").

### 10. Max 10 action inputs in Forge
Consolidated `release_description` + `issues` → single `description` input.
Consolidated 3 CR sections → single `additional_sections` input with structured format.

---

## Architecture Reference Page

A Confluence page exists in the SAN space as the architecture reference:
- **URL**: https://sk-demo-site.atlassian.net/wiki/spaces/SAN/pages/132448258/Nova+Data+Application+Architecture+Overview
- **Contains**: Component overview, dependency/risk guide, deployment steps, compliance requirements
- **Used by**: Agent (STEP 3b) to generate richer Implementation Plan, Risk Analysis, and Test Plan

---

## Jira Automation Rule (Ticket-based)

A separate implementation as a Jira automation rule for individual ticket deployments.
Unlike the agent flow (release-based, conversational), this is fully automated with zero user interaction.

### Flow
```
Trigger: Issue transitions to "READY FOR DEPLOYMENT"
  │
  ├─ Step 1: Invoke Rovo agent (Studio agent, automation scenario)
  │    Message: "AUTOMATION RULE {{issue.key}}"
  │    Agent reads the ticket, extracts deployment details from description,
  │    returns a single JSON object with all SNOW CR fields
  │
  ├─ Step 2: Send web request → POST to SNOW API
  │    Body: {{agentResponse}}  (the full JSON from the agent, passed directly)
  │    Headers: Content-Type, Accept, Authorization (Basic Auth)
  │
  └─ Step 3: Add comment to Jira ticket
       "✅ SNOW CR created: {{webResponse.body.result.number}}"
```

### Key Design Decisions
- **Agent returns raw JSON** — no code fences, no markdown, no explanations. Just valid JSON.
  This allows `{{agentResponse}}` to be passed directly as the web request body.
- **Prompt handles value mapping** — risk/impact labels are converted to SNOW numeric values
  in the prompt (e.g. "Moderate" → `"3"`), not in a handler function.
- **Deployment details in ticket description** — the ticket must contain a "Deployment Details"
  section with: Environment, Affected Components, Deployment Window, Assignment Group,
  Rollback Plan, Risk Level.
- **Studio agent with scenario** — the prompt is in `prompts/automation-scenario.md`, copied
  to a separate scenario in the Studio agent. The Forge agent code is not modified.
- **`{{agentResponse}}`** is a single string, not a parsed JSON object — dot notation
  (e.g. `{{agentResponse.short_description}}`) does NOT work in Jira automation.

### Files
- `prompts/automation-scenario.md` — the prompt for the automation scenario
- `snowtools-automation-rule.json` — draft automation rule JSON (not committed, in .gitignore)

### Test Ticket
- SAN-8: https://sk-demo-site.atlassian.net/browse/SAN-8
- Contains deployment details section with all needed fields
- Workflow has "READY FOR DEPLOYMENT" status configured

---

## Potential Next Steps
- Fix the automation rule JSON import format
- Verify `additional_sections` flows to SNOW correctly (implementation_plan, risk_impact_analysis, test_plan)
- Add `searchSnowAssignmentGroups` action for validated group lookup
- Consider making the agent available from the Jira release page directly (context-aware module)
- Add Backout Plan as an additional section
- Add priority field support
