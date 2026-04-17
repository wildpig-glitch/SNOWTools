# SNOWTools

A [Rovo Agent](https://developer.atlassian.com/platform/forge/rovo-agents/) built on the [Atlassian Forge](https://developer.atlassian.com/platform/forge/) platform with two capabilities:

1. **Create ServiceNow (SNOW) Change Requests** from Jira releases, enriched with Confluence architecture documentation
2. **Convert SNOW CSV exports** into Jira-ready import files

## Capabilities

### 1. Create SNOW Change Requests from Jira Releases

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

### 2. Convert SNOW CSV Export to Jira Import

SNOWTools can transform a raw ServiceNow ticket export (CSV) into a Jira-ready import file:

1. User attaches the SNOW CSV export to any Jira issue
2. User tells the agent the Jira issue key (e.g. `SNKB-42`)
3. Agent fetches and downloads the CSV attachment via the Jira REST API
4. Transforms each row:
   - **Summary**: `{SNOW_number} - {short_description}`
   - **Work Type**: Incident / Change Request / Service Request (`Request Item` → `Service Request`)
   - **Priority**: mapped from SNOW format (`3 - Moderate` → `Medium`)
   - **Labels**: `incident`, `change_request`, `service_request`
   - **Description**: plain-text block with all SNOW metadata + problem description + resolution
   - **Comments**: In the SNOW CSV, all comments and work notes are concatenated into a single `comments_and_work_notes` field. The converter splits them into individual comments by detecting each comment's timestamp header (pattern: `YYYY-MM-DD HH:MM:SS - Author (Type)`). The Jira CSV import format requires one repeated `Comment` column per comment, so the converter scans all tickets first to find the maximum comment count, then generates exactly that many `Comment` columns — tickets with fewer comments get empty cells in the extra columns.
5. Uploads `jira_import.csv` back to the same Jira issue as an attachment

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
  ├─► Action: create-snow-change-request
  │     └─ SNOW Table API: POST /api/now/table/change_request
  │
  └─► Action: convert-snow-csv-to-jira
        └─ Jira REST API: GET /rest/api/3/issue/{key}?fields=attachment
        └─ Jira REST API: GET /rest/api/3/attachment/content/{id}
        └─ Jira REST API: POST /rest/api/2/issue/{key}/attachments
```

## Forge Actions

| Action | Function | Purpose |
|--------|----------|---------|
| `get-jira-release` | `getJiraRelease` | Fetches Jira version details and linked issues |
| `create-snow-change-request` | `createSnowChangeRequest` | Creates the CR in ServiceNow |
| `convert-snow-csv-to-jira` | `convertSnowCsvToJira` | Converts a SNOW CSV export into a Jira-ready import CSV |

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
```

## Rovo Studio Scenario

The `prompts/snow-csv-to-jira-prompt.md` file contains a ready-to-use scenario prompt for Rovo Studio.
Create a new scenario in the SNOWTools agent in Studio and paste the contents of that file as the scenario instructions.
This will enable the agent to guide users through the SNOW CSV → Jira import conversion flow.

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
- `api.asUser().requestConfluence()` is not available in Rovo action function context (no user session) — Confluence attachment reads must use `asApp()` or be avoided in favour of Jira attachments

## Project Context

See [santander-hackathon-progress.md](./santander-hackathon-progress.md) for detailed technical decisions, lessons learned, and next steps.
