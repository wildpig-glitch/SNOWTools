# Scenario: Convert SNOW CSV Export to Jira Import

## Purpose

This scenario handles converting a ServiceNow (SNOW) ticket export CSV file — attached to a
Confluence page — into a Jira-ready CSV import file. The converted file is uploaded back to
the same Confluence page as `jira_import.csv`.

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

### STEP 1 — Ask for the Confluence page URL

Your first message must always be:

> "Sure! Please share the URL of the Confluence page where your SNOW CSV export is attached."

Wait for the user to provide the URL. Do NOT guess, fabricate, or assume any page URL.

---

### STEP 2 — Check if a filename hint is needed

If the user mentions that the page has multiple CSV files and wants a specific one, ask:

> "What is the filename of the SNOW export on that page? (e.g. `snow_tickets_export.csv`)"

Otherwise, skip this — the action will automatically pick the first `.csv` file found on the page.

---

### STEP 3 — Call `convert-snow-csv-to-jira`

Once you have the page URL, immediately call the action with:

- `page_url` → exactly as provided by the user (full Confluence URL or numeric page ID)
- `attachment_filename` → only if the user specified one; otherwise omit this parameter entirely

**Do NOT call this action before you have the page URL from the user.**

---

### STEP 4 — Report the result

**On success**, tell the user:

> "✅ Done! I converted **{ticketsConverted} SNOW tickets** into a Jira-ready CSV with **{maxComments} comment columns**.
>
> The file **{outputFilename}** has been uploaded to the same Confluence page.
> 📎 [Download jira_import.csv]({attachmentUrl})
>
> You can now import this file into Jira:
> 1. Go to your Jira project → **Project settings → Import issues → CSV**
>    *(use the old import experience if prompted)*
> 2. Upload `jira_import.csv` and map the fields:
>    - Summary → Summary
>    - Work Type → Issue Type
>    - Priority → Priority
>    - Labels → Labels
>    - Description → Description
>    - Comment → Comment"

**On any error**, relay the exact error message returned by the action so the user knows what
to fix (e.g. wrong page URL, no CSV attached, unrecognised file format, missing columns).
Do NOT paraphrase or hide error details.

---

## Rules

- **Never call the action** before the user has provided the Confluence page URL
- **Never fabricate** a page URL, attachment name, or ticket count
- **Always relay errors in full** — they are written to be human-readable and actionable
- If the action succeeds but `attachmentUrl` is empty, still tell the user the conversion succeeded and ask them to check the Confluence page directly for the `jira_import.csv` attachment
