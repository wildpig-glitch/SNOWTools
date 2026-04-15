# SNOW CSV to Jira Import — Conversation Starter Prompt

Use this prompt to kick off the SNOW CSV conversion flow with the SNOWTools Rovo agent.
Copy and paste the text below (under "Prompt to paste") into the Rovo chat window.

---

## Prompt to paste

```
I have a ServiceNow ticket export that I need to convert into a Jira-ready CSV import file.

The SNOW CSV export is attached to this Confluence page:
[paste your Confluence page URL here]

Please convert it and upload the result back to the same page.
```

---

## What will happen

1. The agent will call the `convert-snow-csv-to-jira` action with the page URL you provided.
2. The action will:
   - Find the first `.csv` file attached to that Confluence page
   - Parse and transform all SNOW tickets into the Jira import format
   - Auto-detect the number of comment columns needed
   - Upload the result as `jira_import.csv` back to the same page
3. The agent will reply with:
   - ✅ Number of tickets converted
   - Number of comment columns generated
   - 📎 A direct download link for `jira_import.csv`

---

## Optional: specify the filename

If your Confluence page has multiple CSV attachments and you need a specific one, add this to your prompt:

```
The filename of the SNOW export is: [e.g. snow_tickets_export.csv]
```

---

## What the output CSV contains

| Jira Column   | Source                                                                 |
|---------------|------------------------------------------------------------------------|
| Summary       | `{SNOW number} - {short_description}`                                  |
| Work Type     | Incident / Change Request / Service Request (Request Item → Service Request) |
| Priority      | Mapped: 1-Critical, 2-High, 3-Moderate→Medium, 4/5-Low→Low            |
| Labels        | Lowercase ticket type: `incident`, `change_request`, `service_request` |
| Description   | Plain-text block: all SNOW metadata + problem description + resolution |
| Comment (×N)  | Each SNOW work note / comment as a separate Jira Comment column        |

---

## How to import into Jira

Once you have downloaded `jira_import.csv`:

1. Go to your Jira project
2. Navigate to **Project settings → Import issues → CSV**
   *(use the **old import experience** if prompted — the new one does not support multi-comment CSV)*
3. Upload `jira_import.csv`
4. On the field mapping screen, map:
   - `Summary` → Summary
   - `Work Type` → Issue Type
   - `Priority` → Priority
   - `Labels` → Labels
   - `Description` → Description
   - `Comment` → Comment
5. Complete the import

> **Tip:** Run a test import with a small sample (10 rows) first to validate field mappings
> before importing all tickets.
