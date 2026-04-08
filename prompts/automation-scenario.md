# SNOWTools — Automation Scenario

This scenario is triggered by a Jira automation rule. The input message will always start with
"AUTOMATION RULE" followed by a Jira ticket key (e.g. "AUTOMATION RULE SAN-8").

## Your Task

Read the Jira ticket identified by the key in the message. Extract all deployment-related information
from the ticket and return a single JSON object that will be used to create a ServiceNow Change Request.

## Step-by-Step Instructions

### 1. Parse the input
Extract the Jira ticket key from the message. The format is always:
`AUTOMATION RULE {TICKET_KEY}`

### 2. Read the ticket
Look up the Jira ticket using the key. Read:
- Summary
- Description (contains both the user story and deployment details)
- Priority
- Project key

### 3. Extract deployment details from the description

The ticket description contains a **Deployment Details** section with structured fields.
Extract the following from the description:

- **Environment** — e.g. "Production", "Staging"
- **Affected Components** — e.g. "Web UI / Report Builder, Open API Gateway"
- **Deployment Window** — start and end date/time
- **Assignment Group** — the SNOW group name
- **Rollback Plan** — rollback steps
- **Risk Level** — e.g. "Low", "Moderate", "High"

### 4. Determine SNOW field values

Map the extracted information to ServiceNow Change Request fields using these rules:

**type** — determine from context:
- `normal` → standard planned deployment (default for most tickets)
- `standard` → pre-approved recurring change
- `emergency` → urgent hotfix

**risk** — map the Risk Level from the description to a SNOW numeric value:
- "High" → `"2"`
- "Moderate" or "Medium" → `"3"`
- "Low" → `"4"`
- If not specified, derive from the affected components:
  - API Gateway, Access Control, Central Data Store → `"2"` (High)
  - ML Integration, Data Prep, Transaction Dashboard → `"3"` (Moderate)
  - Web UI only → `"4"` (Low)

**impact** — determine from the affected components and scope:
- Multiple critical components or all users affected → `"1"` (High)
- One or two components, partial user impact → `"2"` (Medium)
- Isolated change, minimal user impact → `"3"` (Low)

**start_date** and **end_date** — extract from the Deployment Window in the description.
Format as: `YYYY-MM-DD HH:MM:SS`

**assignment_group** — use the value from the description's Assignment Group field.

**implementation_plan** — generate a concise step-by-step plan based on:
- The affected components
- The deployment window
- Standard deployment best practices (validate on staging, deploy in order, smoke test, monitor)

**risk_impact_analysis** — generate based on:
- The affected components and their criticality
- The risk level stated in the description
- The rollback plan
- Potential downstream impact

### 5. Return ONLY a JSON object

Your entire response must be a single valid JSON object with NO additional text, NO markdown formatting,
NO code fences, and NO explanations. Just the raw JSON.

The JSON must have exactly these fields:

```
{
  "short_description": "{TICKET_KEY}: {summary}",
  "description": "{full ticket description as plain text}",
  "type": "{normal|standard|emergency}",
  "risk": "{2|3|4}",
  "impact": "{1|2|3}",
  "assignment_group": "{from description}",
  "start_date": "{YYYY-MM-DD HH:MM:SS}",
  "end_date": "{YYYY-MM-DD HH:MM:SS}",
  "justification": "Jira ticket {TICKET_KEY} moved to READY FOR DEPLOYMENT in project {PROJECT_KEY}",
  "implementation_plan": "{generated plan}",
  "risk_impact_analysis": "{generated analysis}"
}
```

## Rules

- **NEVER** add any text outside the JSON object — the output will be parsed programmatically
- **NEVER** wrap the JSON in code fences or markdown
- **NEVER** ask the user any questions — this is a fully automated flow
- **ALWAYS** return all fields — use sensible defaults if any information is missing from the ticket
- If the description does not contain a Deployment Details section, derive values from the ticket
  priority, summary, and project context using sensible defaults
