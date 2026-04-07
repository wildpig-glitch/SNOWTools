# SNOWTools

A [Rovo Agent](https://developer.atlassian.com/platform/forge/rovo-agents/) built on the [Atlassian Forge](https://developer.atlassian.com/platform/forge/) platform that creates **ServiceNow (SNOW) Change Requests** from **Jira releases**, enriched with context from **Confluence architecture documentation**.

## What it does

SNOWTools guides a user through creating a ServiceNow Change Request by:

1. **Fetching real Jira release data** via the Jira REST API (release name, dates, linked issues)
2. **Finding an architecture reference** in Confluence (searches for a space matching the Jira project, then looks for a page with "architecture" in the title)
3. **Performing a single unified analysis** of the release issues + architecture doc to generate:
   - Change type recommendation (normal / standard / emergency)
   - Risk level recommendation (low / moderate / high)
   - Impact level recommendation (high / medium / low)
   - Implementation Plan
   - Risk & Impact Analysis
   - Test Plan
4. **Asking the user to confirm** the recommendations and provide the SNOW assignment group
5. **Creating the Change Request** in ServiceNow via the Table REST API

## Architecture

```
User (Rovo Chat)
  │
  ▼
SNOWTools Rovo Agent
  │
  ├─► Action: get-jira-release
  │     └─ Jira REST API: GET /rest/api/3/project/{key}/versions
  │     └─ Jira REST API: GET /rest/api/3/search/jql?fixVersion={id}
  │
  ├─► Native Confluence access (read:confluence-content.all)
  │     └─ Searches for architecture reference page in matching space
  │
  └─► Action: create-snow-change-request
        └─ SNOW Table API: POST /api/now/table/change_request
```

## Forge Actions

| Action | Function | Purpose |
|--------|----------|---------|
| `get-jira-release` | `getJiraRelease` | Fetches Jira version details and linked issues |
| `create-snow-change-request` | `createSnowChangeRequest` | Creates the CR in ServiceNow |

## Setup

### Prerequisites

- [Forge CLI](https://developer.atlassian.com/platform/forge/getting-started/) installed and logged in
- A ServiceNow developer instance ([developer.servicenow.com](https://developer.servicenow.com))
- An Atlassian site with Jira and Confluence

### 1. Clone and install dependencies

```bash
git clone https://github.com/wildpig-glitch/SNOWTools.git
cd SNOWTools
npm install
```

### 2. Set Forge environment variables

```bash
forge variables set --environment development SNOW_INSTANCE_URL https://yourinstance.service-now.com
forge variables set --environment development SNOW_USERNAME your-service-account
forge variables set --environment development SNOW_PASSWORD your-password
```

### 3. Deploy and install

```bash
forge deploy --non-interactive -e development
forge install --non-interactive --site yoursite.atlassian.net --product jira --environment development
forge install --non-interactive --site yoursite.atlassian.net --product confluence --environment development
```

## Confluence Architecture Reference

The agent works best when there is a Confluence space matching your Jira project name, containing a page with "architecture" in the title. This page should describe:

- Platform components and their criticality
- Component dependencies and downstream impact
- Risk levels per component
- Standard deployment steps
- Rollback strategies

See the [Nova Data – Application Architecture Overview](https://sk-demo-site.atlassian.net/wiki/spaces/SAN/pages/132448258) in the SAN space as an example.

## ServiceNow Field Mapping

| SNOW Field | Source |
|------------|--------|
| `short_description` | "Release {name} - {project}" |
| `description` | Release description + issue list |
| `type` | User confirmed (normal/standard/emergency) |
| `risk` | Agent recommendation confirmed by user (mapped to SNOW numeric: 2=High, 3=Moderate, 4=Low) |
| `impact` | Agent recommendation confirmed by user (mapped to SNOW numeric: 1=High, 2=Medium, 3=Low) |
| `assignment_group` | User provided |
| `start_date` | Jira release start date (user confirms) |
| `end_date` | Jira release date (user confirms) |
| `justification` | Auto-generated: "Scheduled Jira release {name} in project {project}" |
| `implementation_plan` | Agent-generated from issues + architecture doc |
| `risk_impact_analysis` | Agent-generated from issues + architecture doc |
| `test_plan` | Agent-generated from issue acceptance criteria |

## Known Limitations

- ServiceNow developer instances hibernate after inactivity — wake them up at [developer.servicenow.com](https://developer.servicenow.com) before use
- The `risk` field supports 3 values on this SNOW instance (Low/Moderate/High) — "Very High" is mapped to "High"
- Assignment group is free-text — if the group name doesn't exist in SNOW, the CR may be created without it

## Project Context

See [CONTEXT.md](./CONTEXT.md) for detailed technical decisions, lessons learned, and next steps.
