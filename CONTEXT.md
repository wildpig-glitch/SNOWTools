# SNOWTools — Project Context

## What This App Does

SNOWTools is a Rovo agent Forge app that creates ServiceNow (SNOW) Change Requests from Jira releases.
It is a PoC (Proof of Concept) deployed on `sk-demo-site.atlassian.net` (Jira, development environment).

The agent guides the user through:
1. Specifying a Jira project key and release name
2. Fetching real release data (dates, issues) via the Jira REST API
3. Collecting SNOW-specific fields from the user (type, risk, impact, assignment group)
4. Confirming a summary before creating the Change Request in ServiceNow

---

## App Identity

- **App ID**: `ari:cloud:ecosystem::app/8b2c8e05-c269-42a0-a25a-f2ff5eb67d33`
- **Agent key**: `snowtools-hello-world-agent`
- **Agent name**: SNOWTools
- **Environment**: development
- **Installed on**: `sk-demo-site.atlassian.net` (Jira)
- **App directory**: `/Users/giannazzo/dev/SNOWTools`

### Deploy command
```bash
forge deploy --non-interactive -e development && forge install --non-interactive --upgrade --site sk-demo-site.atlassian.net --product jira --environment development
```

---

## Architecture

### Actions

| Action key | Function | Purpose |
|---|---|---|
| `get-jira-release` | `getJiraRelease` | Fetches a Jira version by project key + release name via Jira REST API. Returns name, description, startDate, releaseDate, and issues list. |
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
- Egress: `*.service-now.com`

---

## Key Technical Decisions & Lessons Learned

### 1. Teamwork graph does not reliably have JiraVersion data
We initially planned to use the Atlassian Teamwork Graph to look up Jira releases natively.
However, `JiraVersion` nodes were not indexed for `sk-demo-site.atlassian.net`, causing the agent
to hallucinate release data. We switched to using the **Jira REST API** via a dedicated
`get-jira-release` action instead.

### 2. Rovo agents only pass to actions what the user explicitly typed
A critical platform behaviour: data the agent looks up or presents to the user does NOT
automatically flow into action inputs. Only values the user explicitly types in the conversation
are reliably captured. This drove several design decisions:
- All action inputs are `required: false` (to prevent the platform's action-planning layer from
  intercepting the conversation and asking for all inputs upfront as a form)
- The agent prompt instructs the user to explicitly type key values (dates, project key, release name)
- `release_name` and `project_name` are passed as separate inputs (instead of constructing
  `short_description` in the agent) to avoid `undefined` values

### 3. SNOW field mappings
- **Risk**: SNOW expects numeric values. The handler maps: `low→4`, `moderate→3`, `high→2`, `very_high→1`
- **Impact**: SNOW expects numeric values. The handler maps: `high→1`, `medium→2`, `low→3`
- **Planned dates**: Use `start_date` and `end_date` fields (NOT `planned_start_date`/`planned_end_date`)
- **Justification**: Constructed by the handler from `release_name` + `project_name` — not asked from user
- **short_description**: Constructed by the handler as "Release {release_name} - {project_name}"
- **description**: Built by the handler from `release_description` + `issues` (newline-separated)

### 4. Issue fetching
The `get-jira-release` action uses two Jira API calls:
1. `GET /rest/api/3/project/{projectKey}/versions` — to find the version by name
2. `GET /rest/api/3/search?jql=project="{key}" AND fixVersion="{name}"` — to get issues

### 5. Agent prompt design
The prompt is in `prompts/agent-instructions.md`. Key rules enforced in the prompt:
- Agent must ALWAYS ask for project key + release name as first message (never infer from context)
- Agent must call `get-jira-release` before presenting any data (no hallucination)
- Agent must never call `create-snow-change-request` before user confirms summary

---

## Current State (as of 2026-04-03)

### Working ✅
- Agent asks for project key + release name
- `get-jira-release` fetches real Jira data (version details + dates)
- Agent presents real data to user for confirmation
- Dates (start_date, end_date) correctly set in SNOW Schedule section
- Risk and impact correctly mapped to SNOW numeric values
- Justification correctly populated in SNOW Planning section
- Assignment group, change type set correctly
- CR number and link returned to user on success
- Meaningful error messages for all failure scenarios

### Known Issues / Limitations
- **Issues not fetching**: The JQL query in `getJiraRelease` is occasionally failing silently.
  Likely a JQL encoding issue or scope limitation. Needs investigation.
- **No group validation**: Assignment group is free-text — if the user types a non-existent group,
  SNOW silently accepts it or returns a 400 error.
- **additional_sections not flowing**: The structured text block for Implementation Plan, Risk Analysis
  and Test Plan may not flow reliably into the action (same "values not typed by user" problem).
  To be verified in testing.

### Architecture Reference Page
A Confluence page has been created in the SAN space to serve as the architecture reference:
- **URL**: https://sk-demo-site.atlassian.net/wiki/spaces/SAN/pages/132448258/Nova+Data+Application+Architecture+Overview
- **Purpose**: Used by the agent to generate Implementation Plan, Risk & Impact Analysis, and Test Plan sections
- **Contains**: Component overview, dependency/risk guide, deployment steps, compliance requirements

### Agent Flow (updated)
1. Ask user for project key + release name
2. Call `get-jira-release` → fetch real Jira data
3. Present release data + ask user to type dates
3b. Search Confluence for architecture page (space matching project name, page title containing "architecture")
    → confirm with user → read page content for use in CR section generation
    → if not found: ask user for URL or skip (high-level sections only)
4. Ask for SNOW fields (type, risk, impact, assignment group)
5. Generate Implementation Plan, Risk & Impact Analysis, Test Plan from issues + architecture page
6. Show summary → user confirms → call `create-snow-change-request`
7. Return CR number + link

### Action Inputs (create-snow-change-request) — 10 inputs max
| Input | Source |
|---|---|
| `release_name` | From `get-jira-release` |
| `project_name` | Typed by user |
| `description` | Agent combines release description + issues list |
| `type` | Typed by user |
| `risk` | Typed by user (mapped to SNOW numeric in handler) |
| `impact` | Typed by user (mapped to SNOW numeric in handler) |
| `assignment_group` | Typed by user |
| `start_date` | Typed by user (YYYY-MM-DD, handler appends time) |
| `end_date` | Typed by user (YYYY-MM-DD, handler appends time) |
| `additional_sections` | Agent-generated block: IMPLEMENTATION_PLAN / RISK_AND_IMPACT / TEST_PLAN |

### Potential Next Steps
- Fix the issues fetching in `getJiraRelease` (JQL encoding issue)
- Verify `additional_sections` flows correctly into the action
- Add `searchSnowAssignmentGroups` action to let users search for valid SNOW groups
- Consider making the agent available from the Jira release page directly (context-aware module)
- Add priority field support
- Add Backout Plan as an additional section
