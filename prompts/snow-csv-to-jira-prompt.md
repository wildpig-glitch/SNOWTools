# Scenario: Convert SNOW CSV Export to Jira Import

## Purpose

This scenario handles converting a ServiceNow (SNOW) ticket export CSV file — attached to a
Jira issue as an attachment — into a Jira-ready CSV import file. The converted file is uploaded
back to the same Jira issue as `jira_import.csv`.

---

## When to trigger this scenario

Activate this scenario when the user says something like:

- "Convert my SNOW export to Jira"
- "Transform the ServiceNow CSV for Jira import"
- "I have a SNOW tickets export, can you convert it for Jira?"
- "Turn my ServiceNow export into a Jira CSV"
- "I need to import SNOW tickets into Jira"

---

## Conversation flow

### STEP 1 — Ask for the Jira issue key

Your first message must always be:

> "Sure! Please share the Jira issue key where your SNOW CSV export is attached (e.g. SNKB-42)."

Wait for the user to provide the issue key. Do NOT guess, fabricate, or assume any issue key.

---

### STEP 2 — Check if a filename hint is needed

If the user mentions that the issue has multiple CSV attachments and wants a specific one, ask:

> "What is the filename of the SNOW export attached to that issue? (e.g. `snow_tickets_export.csv`)"

Otherwise, skip this — the action will automatically pick the first `.csv` file found on the issue.

---

### STEP 3 — Call `convert-snow-csv-to-jira`

Once you have the issue key, immediately call the action with:

- `issue_key` → exactly as provided by the user (e.g. `SNKB-42`)
- `attachment_filename` → only if the user specified one; otherwise omit this parameter entirely

**Do NOT call this action before you have the issue key from the user.**

---

### STEP 4 — Report the result

**On success**, tell the user:

> "✅ Done! I converted **{ticketsConverted} SNOW tickets** into a Jira-ready CSV with **{maxComments} comment columns**.
>
> The file **{outputFilename}** has been attached to Jira issue [{issueKey}]({issueUrl}).
>
> You can now import this file into Jira:
> 1. Download `jira_import.csv` from the issue's attachments
> 2. Go to your Jira project → **Project settings → Import issues → CSV**
>    *(use the old import experience if prompted)*
> 3. Upload `jira_import.csv` and map the fields:
>    - Summary → Summary
>    - Work Type → Issue Type
>    - Priority → Priority
>    - Labels → Labels
>    - Description → Description
>    - Comment → Comment"

**On any error**, relay the exact error message returned by the action so the user knows what
to fix (e.g. wrong issue key, no CSV attached, unrecognised file format, missing columns).
Do NOT paraphrase or hide error details.

---

## Rules

- **Never call the action** before the user has provided the Jira issue key
- **Never fabricate** an issue key, attachment name, or ticket count
- **Always relay errors in full** — they are written to be human-readable and actionable
- If the action succeeds but `issueUrl` is empty, still tell the user the conversion succeeded and ask them to check the Jira issue directly for the `jira_import.csv` attachment
