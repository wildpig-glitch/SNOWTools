# Santander UK Rovo Hackathon — Use Case 1: ServiceNow Knowledge Base

## Event Details
- **Date**: April 21, 2026
- **Type**: Rovo Hackathon / Train the Trainer
- **Customer**: Santander UK
- **Hackathon Page**: https://as-a-team.atlassian.net/wiki/spaces/SANTUK/pages/11229462585/April+21+2026+-+Rovo+Hackathon+Santander+Train+the+Trainer
- **Use Case Page**: https://as-a-team.atlassian.net/wiki/spaces/santgrp/pages/11239391489/Use+Case+1+-+ServiceNow+Knowledge+Base+to+help+resolve+incidents
- **Instance**: https://santander-rovo-workshop.atlassian.net

## Use Case Summary
Santander UK's CIO Enterprise Services team raises 100+ requests/month across incidents, requests, changes and releases in ServiceNow. Many are repetitive. Teams lack visibility into how similar issues were resolved in the past. The goal is to create a knowledge base from historical SNOW tickets and use a Rovo Agent to help resolve new incoming tickets by finding similar past issues and their resolutions.

## What Was Built

### 1. SNOW Ticket Export
- **Source**: ServiceNow dev instance `https://dev367049.service-now.com/` (user: admin, password: of^3j3nXQWJ$)
- **Method**: REST API calls to `/api/now/table/{table}` with `sysparm_display_value=true`
- **Tables pulled**:
  - `incident` — 67 tickets (35 with comments)
  - `change_request` — 121 tickets (0 with comments)
  - `sc_request` — 1 ticket
  - `sc_req_item` — 5 tickets
- **Total real SNOW tickets**: 194

### 2. Synthetic Data Augmentation
- Added **20 synthetic incidents** in 5 clusters of repetitive issues (to demo the agent finding similar past issues):
  - **VPN issues** (5 tickets) — connection drops, auth failures, slow speeds, Teams disconnects, cert issues
  - **Email/Exchange issues** (4 tickets) — Outlook sync, attachment limits, delivery delays, shared mailbox
  - **Password/Access issues** (5 tickets) — lockouts, SSO issues, onboarding, MFA, service account expiry
  - **Database issues** (3 tickets) — slow queries, replication lag, disk space
  - **Cloud/AWS issues** (3 tickets) — EC2 unreachable, S3 access denied, Lambda timeouts
- Added **15 synthetic service requests** — laptops, AWS access, software licenses, firewall rules, mailbox creation, data restores, Jira projects, server decommission, bulk user creation, MDM enrolment, SSL cert renewal
- **Total KB tickets**: 229

### 3. SNKB Jira Project (Knowledge Base)
- **Project**: SNKB (SNOW Knowledge Base) — team-managed Kanban project
- **Instance**: https://santander-rovo-workshop.atlassian.net
- **Work Types**: Incident, Change Request, Service Request (custom work types created in team-managed project)
- **229 tickets imported** (SNKB-1 through SNKB-229+)
- **Labels**: `incident`, `change_request`, `service_request`

#### Import Details
- **Importer used**: Old CSV import experience (new UI has bugs — can't import into existing project)
- **CSV columns**: Summary, Work Type, Priority, Labels, Description, Comment (x12)
- **Description format**: HTML tags used BUT the old importer treats them as plain text — tags show literally in UI. Content is still fully readable and searchable by Rovo. Could be fixed later.
- **Comments**: SNOW `comments_and_work_notes` split into separate Jira comments using regex pattern `(?=\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} - )`. Plain text with real newlines (not `<br>` — the importer doesn't render HTML in comments).
- **Summary format**: `{SNOW_number} - {short_description}` (e.g. "INC0000060 - Unable to connect to email")
- **Description content**: All SNOW metadata (ticket number, type, category, subcategory, impact, urgency, assignment group, assigned to, reported by, dates, resolved by) + Problem Description + Resolution

#### Key Learnings About Jira CSV Import
- The **new import UI** cannot import into an existing project (bug). Use the **old import experience**.
- Team-managed project custom work types DO appear in the old importer's work type mapping.
- The old importer treats Description as **plain text** (HTML tags are not rendered).
- Comments must use **plain text with real newlines** (not HTML/`<br>` tags).
- Multiple comments per ticket: use **repeated "Comment" column headers** in the CSV.
- Max comments observed: 12 per ticket.
- The importer may get stuck on "Import Links" step — can be safely ignored, import completes in background.

### 4. EN Jira Project (EnterpriseSupport — Incoming Tickets)
- **Project**: EN (EnterpriseSupport)
- **30 new tickets** representing current issues to resolve using the KB (EN-9 to EN-38, plus original EN-1 to EN-8)
- **Total**: 38 tickets

#### Ticket Breakdown
| Type | Count | Examples |
|------|-------|---------|
| Incident | 24 | VPN disconnect, Outlook sync, account lockout, DB slow, AWS Lambda timeout, MFA failure, EC2 unreachable, email delays, security patch login failures, disk space critical, app performance, printer jam, Jenkins pipeline, mobile app crash |
| Service Request | 8 | New laptop, AWS access for contractor, shared mailbox, firewall rule, bulk graduate accounts, data restore, new Jira project, MDM enrolment, software licence |
| Change Request | 6 | Oracle upgrade, FTP→SFTP migration, SSL renewal, server decommission, network segmentation, K8s upgrade |

### 5. TicketHelper Rovo Agent
- **Name**: TicketHelper (originally designed as "ResolutionIQ")
- **Created in**: Rovo Agent Studio on santander-rovo-workshop.atlassian.net
- **Knowledge source**: SNKB Jira project

#### Agent Prompt
```
You are TicketHelper, an intelligent support assistant for CIO Enterprise Services at Santander UK. Your purpose is to help teams quickly find how similar issues were resolved in the past by searching the historical ServiceNow knowledge base stored in the SNKB Jira project.

## What you do

When a user describes a problem, incident, request, or change they are facing, you search the SNKB Jira project for similar past tickets and provide actionable resolution guidance based on historical data.

## How you work

1. Analyse the user's problem description to identify key elements: symptoms, affected systems, error messages, category (network, email, database, access, cloud, etc.).

2. Search the SNKB Jira project for similar past tickets using relevant keywords, categories and symptoms. Search broadly first, then narrow down to the most relevant matches.

3. For each similar ticket found (show the top 3-5 most relevant), return a structured summary in this exact format:

---
### Similar Issue #[N] — [Relevance: High/Medium/Low]

| Field | Details |
|-------|---------|
| **Jira Ticket** | [SNKB-XXX](link) |
| **ServiceNow ID** | [original SNOW ticket number from description] |
| **Type** | [Incident / Change Request / Service Request] |
| **Original Issue** | [short description of the original problem] |
| **Actions Taken** | [resolution steps that were performed] |
| **Resolving Team** | [Assignment Group from the description] |
| **Primary Contact** | [Assigned To / Resolved By from the description] |
| **Resolution Status** | [Resolved / Workaround / Unresolved — based on state and close_notes] |

**Why this is relevant:** [Brief explanation of why this past case matches the current problem]

---

4. After listing similar cases, provide a **Recommended Action Plan** that synthesises the best resolution approach based on the patterns found across all similar historical tickets. Include:
   - The most effective resolution steps based on what worked before
   - Which team to engage
   - Who to contact
   - Any preventive measures that were identified

5. If no similar tickets are found, say so clearly and ask the user to provide more details, different keywords, or a broader description of the symptoms.

## Important guidelines

- Extract all structured data (ServiceNow ID, Assignment Group, Assigned To, Resolved By, Category, Resolution) from the ticket description field, where it is stored as metadata.
- Prioritise tickets that have detailed resolution information in their description (look for the "Resolution" section).
- Closed/resolved tickets are more valuable than open ones since they contain proven solutions.
- When the user provides a Jira ticket key (e.g. SNKB-123), look up that specific ticket and find similar ones in the knowledge base.
- Be concise but thorough. The goal is to save the user 60-80% of investigation time.
- If the user wants to create a new ticket for their current issue, help them create one in the SNKB project with the appropriate work type (Incident, Change Request, or Service Request).
```

#### Conversation Starters
1. `Find similar issues and how they were resolved`
2. `What teams handled problems like this before?`
3. `Suggest a resolution based on past tickets`

### 6. SNOWTools Forge App — `convert-snow-csv-to-jira` Action

A Forge app (`SNOWTools`) with a Rovo action that converts a SNOW CSV export into a Jira-ready import CSV.

- **App directory**: `/Users/giannazzo/dev/SNOWTools`
- **Branch**: `feature/snow-csv-to-jira-converter`
- **Deployed**: v7.0.0 on development environment
- **Installed on**:
  - `santander-rovo-workshop.atlassian.net` — Jira ✅
  - `one-atlas-bpjw.atlassian.net` — Jira ✅

#### Action: `convert-snow-csv-to-jira`

**Flow**:
1. User attaches the SNOW CSV export to any Jira issue (e.g. `SNKB-42`)
2. User tells the SNOWTools agent the issue key
3. Agent calls the action with `issue_key`
4. Action fetches the attachment list from the Jira issue via `api.asUser().requestJira()`
5. Downloads the first `.csv` attachment found (or one matching optional `attachment_filename` hint)
6. Parses CSV with a hand-rolled quoted-field parser (handles commas/newlines inside quoted fields)
7. Transforms each row:
   - **Summary**: `{SNOW_number} - {short_description}`
   - **Work Type**: Incident / Change Request / Service Request (`Request Item` → `Service Request`)
   - **Priority**: `1-Critical`, `2-High`, `3-Moderate→Medium`, `4/5→Low`
   - **Labels**: `incident`, `change_request`, `service_request`
   - **Description**: plain text (all SNOW metadata + problem description + resolution)
   - **Comments**: split via datetime regex, auto-detected max count
8. Uploads `jira_import.csv` back to the same Jira issue
9. Returns summary: ticket count, max comments, issue URL

**Inputs**:
- `issue_key` (string) — Jira issue key (e.g. `SNKB-42`)
- `attachment_filename` (string, optional) — partial filename hint if multiple CSVs on issue

**Scopes**: `read:jira-work`, `write:jira-work`, `read:chat:rovo`

#### Key Technical Learnings

- **`api.asUser()` vs `api.asApp()`**: In Rovo action function context, `api.asUser().requestConfluence()` throws `NEEDS_AUTHENTICATION_ERR` (no Confluence user session available). However, `api.asUser().requestJira()` works fine — because the Rovo agent is installed as a Jira app and the token service can mint Jira user tokens. Use Jira attachments instead of Confluence attachments to avoid this.
- **`route` template tag**: Must use static path strings with interpolated *values* only (e.g. `route\`/rest/api/3/issue/${issueKey}/attachments\``). Passing a pre-built dynamic string as the sole interpolated value (`route\`${dynamicPath}\``) causes Forge to reject/mangle the request.
- **Jira attachment upload**: `POST /rest/api/2/issue/{key}/attachments` with multipart/form-data body + `X-Atlassian-Token: no-check` header. Forge has no FormData global — construct multipart body as a string with a fixed boundary delimiter.
- **New scope → must upgrade**: Adding new scopes requires `forge install --upgrade` on every installed site.

#### Files

- `src/index.js` — `convertSnowCsvToJira` function (~400 lines, fully commented)
- `manifest.yml` — action + function entry + scopes
- `prompts/snow-csv-to-jira-prompt.md` — Rovo Studio scenario/trigger prompt (to create a new Studio scenario)
- `prompts/agent-instructions.md` — main agent prompt updated with CAPABILITY 2 section

#### Status

⏳ **Pending test** — needs to be tested end-to-end with a real SNOW CSV attached to a Jira issue on `santander-rovo-workshop.atlassian.net`.

---

## Pending / Next Steps

### SNOW CSV Converter — End-to-End Test
- Attach `snow_tickets_export.csv` to any Jira issue on `santander-rovo-workshop.atlassian.net`
- Trigger the SNOWTools agent: *"Convert my SNOW export — issue key is SNKB-X"*
- Verify `jira_import.csv` is attached to the issue and is valid for Jira CSV import

### Description Formatting Fix
- HTML tags in SNKB ticket descriptions are rendered as literal text (not formatted)
- Low priority — content is readable and Rovo searches it fine
- Could be fixed via Jira REST API bulk update if needed

## Files in Workspace
- `snow_tickets_export.csv` — Raw SNOW export (all 229 tickets, original SNOW fields)
- `snow_tickets_jira_import.csv` — Final Jira-ready CSV (with HTML descriptions + split comments)
- `santander-hackathon-progress.md` — This context file

## Reference: Similar Internal Prototypes Found
- **Encryption Knowledge Base (Rovo)** — `ekbr` space on hello.atlassian.net: JSM tickets auto-imported as Confluence pages for Rovo KB (https://hello.atlassian.net/wiki/spaces/ekbr/pages/6487998689/Help+Ticket+Knowledge+Base)
- **Finnair Similar Incidents Resolution Helper** — Rovo Agent searching Jira for similar historical incidents (https://hello.atlassian.net/wiki/spaces/fde/pages/6107610230/Finnair+Similar+Incidents+Resolution+Helper+Agent+Development)
- **Bertelsmann Dynamic Error Database** — Rovo + Jira Automation for automated solution suggestions (https://hello.atlassian.net/wiki/spaces/~giannazzo/pages/6058448431/)
