import api, { route } from '@forge/api';

// ServiceNow credentials are stored as Forge environment variables.
// Set them via the Forge CLI:
//   forge variables set --environment development SNOW_INSTANCE_URL https://mycompany.service-now.com
//   forge variables set --environment development SNOW_USERNAME myuser
//   forge variables set --environment development SNOW_PASSWORD mypassword
//
// process.env is available in Forge backend functions and reads these variables at runtime.

/**
 * Fetches details of a Jira release (version) by project key and release name.
 *
 * Uses the Jira REST API (.asUser()) to:
 * 1. Find the version by name in the given project
 * 2. Fetch all issues assigned to that version
 *
 * @param {object} payload - The action input payload.
 * @param {string} payload.project_key - The Jira project key (e.g. "SDF").
 * @param {string} payload.release_name - The name of the Jira version (e.g. "Camuf1Toti").
 * @returns {object} Release details or an error object.
 */
export async function getJiraRelease(payload) {
  const projectKey = (payload.project_key || '').trim();
  const releaseName = (payload.release_name || '').trim();

  // Validate inputs
  if (!projectKey || !releaseName) {
    return {
      success: false,
      error: 'Both project_key and release_name are required. Please provide them and try again.'
    };
  }

  console.log(`Fetching Jira release: project=${projectKey}, release=${releaseName}`);

  // --- Step 1: Fetch all versions for the project and find the matching one ---
  let versionsResponse;
  try {
    versionsResponse = await api.asUser().requestJira(
      route`/rest/api/3/project/${projectKey}/versions`
    );
  } catch (err) {
    console.error(`Error fetching Jira versions: ${err.message}`);
    return {
      success: false,
      error: `Could not fetch versions for project "${projectKey}": ${err.message}. ` +
        `Please verify the project key is correct.`
    };
  }

  if (!versionsResponse.ok) {
    const errorText = await versionsResponse.text();
    console.error(`Jira versions API error ${versionsResponse.status}: ${errorText}`);

    if (versionsResponse.status === 404) {
      return {
        success: false,
        error: `Project "${projectKey}" was not found in Jira. Please check the project key and try again.`
      };
    }
    if (versionsResponse.status === 403) {
      return {
        success: false,
        error: `You do not have permission to access project "${projectKey}". ` +
          `Please check your Jira permissions.`
      };
    }
    return {
      success: false,
      error: `Jira API returned HTTP ${versionsResponse.status} when fetching versions for project "${projectKey}". ` +
        `Detail: ${errorText}`
    };
  }

  const versions = await versionsResponse.json();

  // Find the version matching the release name (case-insensitive)
  const version = versions.find(
    v => v.name.toLowerCase() === releaseName.toLowerCase()
  );

  if (!version) {
    // List available versions to help the user
    const availableNames = versions.map(v => v.name).join(', ');
    return {
      success: false,
      error: `Release "${releaseName}" was not found in project "${projectKey}". ` +
        `Available releases are: ${availableNames || 'none'}. ` +
        `Please check the release name and try again.`
    };
  }

  console.log(`Found version: ${JSON.stringify(version)}`);

  // --- Step 2: Fetch issues assigned to this version ---
  // Note: we use the version ID (not name) in the JQL to avoid encoding issues with
  // version names that contain spaces, dots or special characters.
  let issues = [];
  try {
    // Build the JQL using the version ID for reliability.
    // Do NOT use encodeURIComponent — route template literal handles encoding automatically.
    // Double-encoding causes a 400 "reserved JQL character" error.
    const jql = `project = "${projectKey}" AND fixVersion = ${version.id} ORDER BY key ASC`;

    // Note: /rest/api/3/search is removed (HTTP 410) — use /rest/api/3/search/jql instead.
    const issuesResponse = await api.asUser().requestJira(
      route`/rest/api/3/search/jql?jql=${jql}&fields=summary,status&maxResults=100`
    );

    if (issuesResponse.ok) {
      const issuesData = await issuesResponse.json();
      issues = (issuesData.issues || []).map(issue => ({
        key: issue.key,
        summary: issue.fields.summary
      }));
      console.log(`Fetched ${issues.length} issues for version ${version.name} (id: ${version.id})`);
    } else {
      const errorText = await issuesResponse.text();
      console.warn(`Could not fetch issues for version ${version.name}: HTTP ${issuesResponse.status} — ${errorText}`);
    }
  } catch (err) {
    console.warn(`Error fetching issues for version ${version.name}: ${err.message}`);
  }

  // Format the issues as a newline-separated string for easy use by the agent
  const issuesString = issues
    .map(i => `${i.key}: ${i.summary}`)
    .join('\n');

  return {
    success: true,
    name: version.name,
    description: version.description || '',
    startDate: version.startDate || null,
    releaseDate: version.releaseDate || null,
    released: version.released || false,
    issueCount: issues.length,
    issues: issuesString
  };
}

/**
 * Parses the additional_sections structured text block into individual SNOW field values.
 *
 * The agent generates a block like:
 *   IMPLEMENTATION_PLAN: <text>
 *   RISK_AND_IMPACT: <text>
 *   TEST_PLAN: <text>
 *
 * This function extracts each section and maps it to the corresponding SNOW field name:
 * - implementation_plan → maps to SNOW field "implementation_plan"
 * - risk_and_impact     → maps to SNOW field "risk_impact_analysis"  
 * - test_plan           → maps to SNOW field "test_plan"
 *
 * @param {string} additionalSections - The structured text block from the agent.
 * @returns {object} An object with the individual SNOW field values (only non-empty ones).
 */
function parseAdditionalSections(additionalSections) {
  if (!additionalSections) return {};

  const result = {};

  // Extract each section using regex — each label starts a section, next label ends it.
  const sections = {
    implementation_plan: /IMPLEMENTATION_PLAN:\s*([\s\S]*?)(?=RISK_AND_IMPACT:|TEST_PLAN:|$)/i,
    risk_impact_analysis: /RISK_AND_IMPACT:\s*([\s\S]*?)(?=IMPLEMENTATION_PLAN:|TEST_PLAN:|$)/i,
    test_plan: /TEST_PLAN:\s*([\s\S]*?)(?=IMPLEMENTATION_PLAN:|RISK_AND_IMPACT:|$)/i
  };

  for (const [field, regex] of Object.entries(sections)) {
    const match = additionalSections.match(regex);
    if (match && match[1] && match[1].trim()) {
      result[field] = match[1].trim();
    }
  }

  return result;
}

/**
 * Maps a human-readable risk label to the ServiceNow numeric risk value.
 * ServiceNow stores risk as: 1=Very High, 2=High, 3=Moderate, 4=Low.
 *
 * @param {string} risk - Human-readable risk label from the agent.
 * @returns {string} ServiceNow numeric risk value.
 */
function mapRisk(risk) {
  // This SNOW instance supports 3 risk values: 2=High, 3=Moderate, 4=Low.
  // "Very High" (1) is not supported — map it to High (2) as the closest valid value.
  const riskMap = {
    'very_high': '2',
    'very high': '2',
    '1': '2',
    'high': '2',
    '2': '2',
    'moderate': '3',
    'medium': '3',
    '3': '3',
    'low': '4',
    '4': '4'
  };
  return riskMap[(risk || '').toLowerCase()] || '4'; // default to Low
}

/**
 * Maps a human-readable impact label to the ServiceNow numeric impact value.
 * ServiceNow stores impact as: 1=High, 2=Medium, 3=Low.
 *
 * @param {string} impact - Human-readable impact label from the agent.
 * @returns {string} ServiceNow numeric impact value.
 */
function mapImpact(impact) {
  const impactMap = {
    'high': '1',
    '1': '1',
    'medium': '2',
    'moderate': '2',
    '2': '2',
    'low': '3',
    '3': '3'
  };
  return impactMap[(impact || '').toLowerCase()] || '3'; // default to Low
}

/**
 * Creates a Change Request in ServiceNow using the Table API.
 *
 * This function is called by the Rovo agent action `create-snow-change-request`.
 * It reads SNOW credentials from Forge environment variables, constructs the
 * API payload from the inputs collected by the agent, and handles all errors
 * in a way that gives the agent (and ultimately the user) meaningful feedback.
 *
 * @param {object} payload - The action input payload provided by the Rovo agent.
 * @param {string} payload.release_name - The Jira release/version name.
 * @param {string} payload.project_name - The Jira project name or key.
 * @param {string} payload.release_description - The Jira release description (may be empty).
 * @param {string} payload.issues - Newline-separated list of issues ("KEY: Summary").
 * @param {string} payload.type - Change type: normal, standard, or emergency.
 * @param {string} payload.risk - Risk label: low, moderate, high, or very_high.
 * @param {string} payload.impact - Impact label: high, medium, or low.
 * @param {string} payload.assignment_group - SNOW assignment group name.
 * @param {string} payload.start_date - Planned start datetime (YYYY-MM-DD HH:MM:SS).
 * @param {string} payload.end_date - Planned end datetime (YYYY-MM-DD HH:MM:SS).
 * @returns {object} Result object with success status, CR details or error information.
 */
/**
 * Converts a ServiceNow CSV export (attached to a Confluence page) into a
 * Jira-ready CSV import file, and uploads the result back as a new attachment
 * on the same Confluence page.
 *
 * ## What this function does
 *
 * 1. Extracts the Confluence page ID from the provided URL (or uses it directly
 *    if the caller already passed a numeric ID).
 * 2. Fetches the list of attachments on that page via the Confluence REST API.
 * 3. Finds the target CSV file (optionally filtered by filename hint).
 * 4. Downloads the raw CSV content.
 * 5. Parses the CSV properly (handles quoted fields containing commas and newlines).
 * 6. Transforms each SNOW row into a Jira-compatible row:
 *    - Summary:   "{SNOW number} - {short_description}"
 *    - Work Type: Incident / Change Request / Service Request
 *    - Priority:  mapped from SNOW format ("3 - Moderate") to Jira ("Medium")
 *    - Labels:    lowercase ticket type ("incident", "change_request", "service_request")
 *    - Description: plain-text block with all SNOW metadata + description + resolution
 *    - Comments:  split from comments_and_work_notes using a datetime regex;
 *                 the number of Comment columns is auto-detected from the data.
 * 7. Serialises the result as a properly-quoted CSV string.
 * 8. Uploads the output CSV as an attachment named "jira_import.csv" to the same
 *    Confluence page (replaces the file if it already exists).
 * 9. Returns a summary object for the agent to relay to the user.
 *
 * @param {object} payload - The action input payload provided by the Rovo agent.
 * @param {string} payload.page_url - The full Confluence page URL or a numeric page ID.
 * @param {string} [payload.attachment_filename] - Optional filename hint. If the page has
 *   multiple CSV attachments, this narrows the search. Partial match is fine (e.g. "snow").
 * @returns {object} Result object with success flag, ticket count, max comments, and
 *   the URL of the uploaded jira_import.csv attachment.
 */
export async function convertSnowCsvToJira(payload) {

  // ---------------------------------------------------------------------------
  // STEP 1 — Validate inputs
  // ---------------------------------------------------------------------------

  const rawPageUrl = (payload.page_url || '').trim();
  if (!rawPageUrl) {
    return {
      success: false,
      error: 'page_url is required. Please provide the full Confluence page URL or a numeric page ID.'
    };
  }

  // ---------------------------------------------------------------------------
  // STEP 2 — Extract the page ID from the URL
  //
  // Confluence page URLs come in two formats:
  //   Modern:  https://site.atlassian.net/wiki/spaces/KEY/pages/123456789/Page+Title
  //   Legacy:  https://site.atlassian.net/wiki/display/KEY/Page+Title?pageId=123456789
  //
  // We also accept a bare numeric page ID string (e.g. "123456789").
  // ---------------------------------------------------------------------------

  let pageId;

  // Try to extract numeric page ID from a "/pages/{id}/" segment in the URL.
  const pagesMatch = rawPageUrl.match(/\/pages\/(\d+)/);
  if (pagesMatch) {
    pageId = pagesMatch[1];
  } else {
    // Try query-string format: ?pageId=123456789
    const queryMatch = rawPageUrl.match(/[?&]pageId=(\d+)/);
    if (queryMatch) {
      pageId = queryMatch[1];
    } else if (/^\d+$/.test(rawPageUrl)) {
      // The caller passed a bare numeric ID.
      pageId = rawPageUrl;
    }
  }

  if (!pageId) {
    return {
      success: false,
      error: `Could not extract a page ID from: "${rawPageUrl}". ` +
        `Please provide a full Confluence page URL (e.g. https://site.atlassian.net/wiki/spaces/KEY/pages/123456789/Title) ` +
        `or a numeric page ID.`
    };
  }

  console.log(`convertSnowCsvToJira: using page ID ${pageId}`);

  // ---------------------------------------------------------------------------
  // STEP 3 — Fetch the list of attachments on the Confluence page
  // ---------------------------------------------------------------------------

  let attachmentsResponse;
  try {
    attachmentsResponse = await api.asApp().requestConfluence(
      route`/wiki/rest/api/content/${pageId}/child/attachment?expand=metadata&limit=50`
    );
    console.log(`Attachments API response status: ${attachmentsResponse.status}`);
  } catch (err) {
    // Log the full error object to help diagnose SDK-level failures.
    console.error(`Error fetching attachments (exception): ${err.message}`, JSON.stringify(err));
    return {
      success: false,
      error: `Could not fetch attachments for page ${pageId}: ${err.message}`
    };
  }

  if (!attachmentsResponse.ok) {
    const errText = await attachmentsResponse.text();
    console.error(`Confluence attachments API error ${attachmentsResponse.status}: ${errText}`);
    if (attachmentsResponse.status === 401) {
      return {
        success: false,
        error: `Confluence returned 401 Unauthorized for page ${pageId}. ` +
          `This usually means the app's Confluence scopes have not been consented to on this site. ` +
          `HTTP status: 401. Detail: ${errText}`
      };
    }
    if (attachmentsResponse.status === 404) {
      return {
        success: false,
        error: `Confluence page with ID "${pageId}" was not found. ` +
          `Please check the URL and make sure the page exists and you have access to it.`
      };
    }
    return {
      success: false,
      error: `Confluence API returned HTTP ${attachmentsResponse.status} when fetching attachments. Detail: ${errText}`
    };
  }

  const attachmentsData = await attachmentsResponse.json();
  const attachments = attachmentsData.results || [];

  if (attachments.length === 0) {
    return {
      success: false,
      error: `No attachments found on Confluence page ${pageId}. ` +
        `Please upload the SNOW CSV export file to that page first.`
    };
  }

  // ---------------------------------------------------------------------------
  // STEP 4 — Find the target CSV attachment
  //
  // Selection priority:
  //  1. If attachment_filename is provided, find an attachment whose filename
  //     contains that string (case-insensitive).
  //  2. Otherwise, pick the first attachment with a .csv extension.
  // ---------------------------------------------------------------------------

  const filenameHint = (payload.attachment_filename || '').trim().toLowerCase();

  let targetAttachment;
  if (filenameHint) {
    targetAttachment = attachments.find(a =>
      (a.title || '').toLowerCase().includes(filenameHint)
    );
    if (!targetAttachment) {
      const allNames = attachments.map(a => a.title).join(', ');
      return {
        success: false,
        error: `No attachment matching "${filenameHint}" found on page ${pageId}. ` +
          `Available attachments: ${allNames}. ` +
          `Please check the filename hint or leave it blank to pick the first CSV found.`
      };
    }
  } else {
    // No hint — pick the first .csv file.
    targetAttachment = attachments.find(a =>
      (a.title || '').toLowerCase().endsWith('.csv')
    );
    if (!targetAttachment) {
      const allNames = attachments.map(a => a.title).join(', ');
      return {
        success: false,
        error: `No CSV attachment found on page ${pageId}. ` +
          `Available attachments: ${allNames}. ` +
          `Please upload your SNOW export as a .csv file.`
      };
    }
  }

  console.log(`Found attachment: "${targetAttachment.title}" (id: ${targetAttachment.id})`);

  // Build the download URL from the attachment's _links.download path.
  // The download link is a relative path like /wiki/download/attachments/...
  const downloadPath = targetAttachment._links && targetAttachment._links.download;
  if (!downloadPath) {
    return {
      success: false,
      error: `Could not determine the download URL for attachment "${targetAttachment.title}".`
    };
  }

  // ---------------------------------------------------------------------------
  // STEP 5 — Download the CSV attachment content
  //
  // The attachment download path from _links.download looks like:
  //   /wiki/download/attachments/{pageId}/{filename}?version=1&modificationDate=...
  //
  // We must use route`` with the path as a static string. Since the download
  // path is fully dynamic, we split it into the base path and query string,
  // then construct the route with the path baked in.
  //
  // Simpler approach: use the attachment ID to build a known-safe API path
  // to retrieve the attachment content via the REST API instead of the
  // download URL, avoiding the need to pass a dynamic path to route``.
  // The Confluence REST API supports fetching attachment data via:
  //   GET /wiki/rest/api/content/{attachmentId}/data
  // ---------------------------------------------------------------------------

  let csvText;
  try {
    const attachmentId = targetAttachment.id;
    const downloadResponse = await api.asApp().requestConfluence(
      route`/wiki/rest/api/content/${attachmentId}/data`
    );
    if (!downloadResponse.ok) {
      const errText = await downloadResponse.text();
      return {
        success: false,
        error: `Failed to download attachment "${targetAttachment.title}": HTTP ${downloadResponse.status}. Detail: ${errText}`
      };
    }
    csvText = await downloadResponse.text();
  } catch (err) {
    console.error(`Error downloading attachment: ${err.message}`);
    return {
      success: false,
      error: `Error downloading attachment "${targetAttachment.title}": ${err.message}`
    };
  }

  console.log(`Downloaded CSV: ${csvText.length} characters`);

  // ---------------------------------------------------------------------------
  // STEP 6 — Parse the SNOW CSV
  //
  // We use a hand-rolled parser because SNOW exports can contain quoted fields
  // that themselves contain commas, newlines, and double-quotes (escaped as "").
  // JavaScript's built-in String.split(',') is not safe for this.
  // ---------------------------------------------------------------------------

  /**
   * Parses a CSV string into an array of row arrays.
   * Handles:
   *  - Fields quoted with double-quotes
   *  - Commas inside quoted fields
   *  - Newlines inside quoted fields
   *  - Escaped double-quotes ("") inside quoted fields
   *
   * @param {string} text - Raw CSV text.
   * @returns {string[][]} Array of rows, each row being an array of field strings.
   */
  function parseCsv(text) {
    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;
    let i = 0;

    // Normalise line endings to \n so we don't have to handle \r\n vs \n separately.
    const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    while (i < src.length) {
      const ch = src[i];

      if (inQuotes) {
        if (ch === '"') {
          // Peek at next character to decide if this is an escaped quote ("") or end-of-field.
          if (src[i + 1] === '"') {
            // Escaped double-quote — add a single " to the field and skip both chars.
            currentField += '"';
            i += 2;
          } else {
            // End of quoted field.
            inQuotes = false;
            i++;
          }
        } else {
          // Any other character inside quotes — add it verbatim (including newlines).
          currentField += ch;
          i++;
        }
      } else {
        if (ch === '"') {
          // Start of a quoted field.
          inQuotes = true;
          i++;
        } else if (ch === ',') {
          // Field separator — push field and start a new one.
          currentRow.push(currentField);
          currentField = '';
          i++;
        } else if (ch === '\n') {
          // Row separator — push the last field and start a new row.
          currentRow.push(currentField);
          rows.push(currentRow);
          currentRow = [];
          currentField = '';
          i++;
        } else {
          currentField += ch;
          i++;
        }
      }
    }

    // Push any remaining field/row (file may not end with a newline).
    if (currentField !== '' || currentRow.length > 0) {
      currentRow.push(currentField);
      rows.push(currentRow);
    }

    // Filter out completely empty rows (e.g. trailing newline at end of file).
    return rows.filter(row => row.some(cell => cell.trim() !== ''));
  }

  const allRows = parseCsv(csvText);

  if (allRows.length < 2) {
    return {
      success: false,
      error: `The CSV file "${targetAttachment.title}" appears to be empty or has no data rows.`
    };
  }

  // Extract header and data rows.
  const header = allRows[0].map(h => h.trim().toLowerCase());
  const dataRows = allRows.slice(1);

  console.log(`Parsed CSV: ${dataRows.length} data rows, headers: ${header.join(', ')}`);

  // Helper to get a field value by column name (case-insensitive, trimmed).
  const col = (row, name) => {
    const idx = header.indexOf(name.toLowerCase());
    return idx >= 0 ? (row[idx] || '').trim() : '';
  };

  // ---------------------------------------------------------------------------
  // STEP 7 — Validate that this looks like a SNOW export
  // ---------------------------------------------------------------------------

  const requiredColumns = ['ticket_type', 'number', 'short_description'];
  const missingColumns = requiredColumns.filter(c => !header.includes(c));
  if (missingColumns.length > 0) {
    return {
      success: false,
      error: `The CSV file "${targetAttachment.title}" does not appear to be a SNOW export. ` +
        `Missing required columns: ${missingColumns.join(', ')}. ` +
        `Expected columns include: ticket_type, number, short_description, description, ` +
        `state, priority, impact, urgency, category, subcategory, assignment_group, ` +
        `assigned_to, caller_or_opened_by, opened_at, resolved_or_closed_at, resolved_by, ` +
        `close_notes, comments_and_work_notes.`
    };
  }

  // ---------------------------------------------------------------------------
  // STEP 8 — Transform each SNOW row into a Jira row
  // ---------------------------------------------------------------------------

  /**
   * Maps a SNOW ticket_type value to a Jira Work Type string.
   * "Request Item" is treated as "Service Request" in Jira.
   *
   * @param {string} snowType - Raw ticket_type from SNOW CSV.
   * @returns {string} Jira Work Type label.
   */
  function mapWorkType(snowType) {
    const t = (snowType || '').trim();
    if (t === 'Incident') return 'Incident';
    if (t === 'Change Request') return 'Change Request';
    if (t === 'Service Request' || t === 'Request Item') return 'Service Request';
    // Fallback — return as-is so no data is silently lost.
    return t || 'Incident';
  }

  /**
   * Maps a SNOW priority string to a Jira priority label.
   * SNOW format: "1 - Critical", "2 - High", "3 - Moderate", "4 - Low", "5 - Planning".
   * Jira format: "Critical", "High", "Medium", "Low".
   *
   * @param {string} snowPriority - Raw priority value from SNOW CSV.
   * @returns {string} Jira priority label.
   */
  function mapPriority(snowPriority) {
    const p = (snowPriority || '').trim();
    if (p.startsWith('1')) return 'Critical';
    if (p.startsWith('2')) return 'High';
    if (p.startsWith('3')) return 'Medium';
    if (p.startsWith('4')) return 'Low';
    if (p.startsWith('5')) return 'Low';   // "5 - Planning" → Low
    // If already a plain Jira label, return as-is.
    return p || 'Medium';
  }

  /**
   * Maps a SNOW ticket_type to a Jira label string (lowercase, underscore-separated).
   *
   * @param {string} snowType - Raw ticket_type from SNOW CSV.
   * @returns {string} Jira label.
   */
  function mapLabel(snowType) {
    const t = (snowType || '').trim();
    if (t === 'Incident') return 'incident';
    if (t === 'Change Request') return 'change_request';
    if (t === 'Service Request' || t === 'Request Item') return 'service_request';
    return t.toLowerCase().replace(/\s+/g, '_');
  }

  /**
   * Builds a plain-text description block from all SNOW metadata fields.
   * This is the content that will appear in the Jira ticket Description field.
   * Using plain text (not HTML) so the Jira CSV importer renders it cleanly.
   *
   * @param {object} fields - An object with all SNOW field values for this row.
   * @returns {string} Multi-line plain text description.
   */
  function buildDescription(fields) {
    const lines = [];

    // --- Ticket identity ---
    lines.push(`ServiceNow Ticket: ${fields.number}`);
    lines.push(`Ticket Type: ${fields.ticket_type}`);

    // --- Classification ---
    if (fields.category)    lines.push(`Category: ${fields.category}`);
    if (fields.subcategory) lines.push(`Subcategory: ${fields.subcategory}`);
    if (fields.priority)    lines.push(`Priority: ${fields.priority}`);
    if (fields.impact)      lines.push(`Impact: ${fields.impact}`);
    if (fields.urgency)     lines.push(`Urgency: ${fields.urgency}`);
    if (fields.state)       lines.push(`State: ${fields.state}`);

    // --- People ---
    if (fields.assignment_group)    lines.push(`Assignment Group: ${fields.assignment_group}`);
    if (fields.assigned_to)         lines.push(`Assigned To: ${fields.assigned_to}`);
    if (fields.caller_or_opened_by) lines.push(`Reported By: ${fields.caller_or_opened_by}`);
    if (fields.resolved_by)         lines.push(`Resolved By: ${fields.resolved_by}`);

    // --- Dates ---
    if (fields.opened_at)              lines.push(`Opened At: ${fields.opened_at}`);
    if (fields.resolved_or_closed_at)  lines.push(`Resolved/Closed At: ${fields.resolved_or_closed_at}`);

    // --- Problem description ---
    if (fields.description) {
      lines.push('');
      lines.push('Problem Description:');
      lines.push(fields.description);
    }

    // --- Resolution ---
    if (fields.close_notes) {
      lines.push('');
      lines.push('Resolution:');
      lines.push(fields.close_notes);
    }

    return lines.join('\n');
  }

  /**
   * Splits the SNOW comments_and_work_notes field into individual comment strings.
   *
   * SNOW concatenates all comments into a single block, with each comment starting
   * on a new line that matches the pattern: "YYYY-MM-DD HH:MM:SS - Author (Type)"
   * e.g.:
   *   "2024-01-15 09:30:00 - John Smith (Comments)\nHi, I can reproduce this.\n"
   *   "2024-01-15 10:00:00 - Jane Doe (Work notes)\nAssigned to Network team."
   *
   * We use a lookahead regex to split just before each timestamp, preserving the
   * timestamp as part of the comment it introduces.
   *
   * @param {string} commentsField - Raw comments_and_work_notes string from SNOW.
   * @returns {string[]} Array of individual comment strings (trimmed, non-empty).
   */
  function splitComments(commentsField) {
    if (!commentsField || !commentsField.trim()) return [];

    // Split at positions immediately before a datetime stamp (lookahead so the
    // stamp itself is included in the following chunk, not lost).
    const parts = commentsField.split(/(?=\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} - )/);

    return parts
      .map(p => p.trim())
      .filter(p => p.length > 0);
  }

  // --- First pass: transform all rows and detect the max comment count ---

  const jiraRows = dataRows.map(row => {
    // Build a convenient named-field object for this row.
    const fields = {
      ticket_type:           col(row, 'ticket_type'),
      number:                col(row, 'number'),
      short_description:     col(row, 'short_description'),
      description:           col(row, 'description'),
      state:                 col(row, 'state'),
      priority:              col(row, 'priority'),
      impact:                col(row, 'impact'),
      urgency:               col(row, 'urgency'),
      category:              col(row, 'category'),
      subcategory:           col(row, 'subcategory'),
      assignment_group:      col(row, 'assignment_group'),
      assigned_to:           col(row, 'assigned_to'),
      caller_or_opened_by:   col(row, 'caller_or_opened_by'),
      opened_at:             col(row, 'opened_at'),
      resolved_or_closed_at: col(row, 'resolved_or_closed_at'),
      resolved_by:           col(row, 'resolved_by'),
      close_notes:           col(row, 'close_notes'),
      comments_and_work_notes: col(row, 'comments_and_work_notes')
    };

    const summary     = `${fields.number} - ${fields.short_description}`;
    const workType    = mapWorkType(fields.ticket_type);
    const priority    = mapPriority(fields.priority);
    const labels      = mapLabel(fields.ticket_type);
    const description = buildDescription(fields);
    const comments    = splitComments(fields.comments_and_work_notes);

    return { summary, workType, priority, labels, description, comments };
  });

  // Auto-detect the maximum number of comments across all transformed rows.
  const maxComments = jiraRows.reduce((max, row) => Math.max(max, row.comments.length), 0);
  console.log(`Max comments per ticket: ${maxComments}`);

  // ---------------------------------------------------------------------------
  // STEP 9 — Serialise the transformed data as a Jira-compatible CSV string
  //
  // Jira CSV import rules:
  //  - Multiple comments are represented as REPEATED "Comment" column headers.
  //  - All fields must be properly quoted (especially Description and Comments
  //    which can contain commas and newlines).
  //  - Encoding: UTF-8.
  // ---------------------------------------------------------------------------

  /**
   * Escapes a single CSV field value.
   * Wraps the value in double-quotes and escapes any internal double-quotes as "".
   * This is the safe way to handle values that may contain commas, newlines, or quotes.
   *
   * @param {string} value - Raw field value.
   * @returns {string} Properly quoted CSV field.
   */
  function csvField(value) {
    // Always quote every field for safety — simpler and always correct.
    const escaped = (value || '').replace(/"/g, '""');
    return `"${escaped}"`;
  }

  // Build the header row: fixed columns + repeated "Comment" for each slot.
  const fixedHeaders = ['Summary', 'Work Type', 'Priority', 'Labels', 'Description'];
  const commentHeaders = Array(maxComments).fill('Comment');
  const headerRow = [...fixedHeaders, ...commentHeaders].map(csvField).join(',');

  // Build each data row, padding comments array to maxComments with empty strings.
  const dataRowStrings = jiraRows.map(row => {
    const commentCells = Array(maxComments).fill('').map((_, i) => row.comments[i] || '');
    const cells = [
      row.summary,
      row.workType,
      row.priority,
      row.labels,
      row.description,
      ...commentCells
    ];
    return cells.map(csvField).join(',');
  });

  // Combine header + data rows into the final CSV string (Unix line endings).
  const outputCsv = [headerRow, ...dataRowStrings].join('\n');

  console.log(`Generated Jira CSV: ${outputCsv.length} characters, ${jiraRows.length} tickets`);

  // ---------------------------------------------------------------------------
  // STEP 10 — Upload the output CSV as an attachment to the same Confluence page
  //
  // Confluence REST API for attachments:
  //   POST /wiki/rest/api/content/{pageId}/child/attachment
  //
  // If an attachment named "jira_import.csv" already exists, we need to use the
  // update endpoint instead:
  //   POST /wiki/rest/api/content/{pageId}/child/attachment/{attachmentId}/data
  //
  // The request must use multipart/form-data with a "file" part.
  // We also set X-Atlassian-Token: no-check to bypass XSRF protection for
  // attachment uploads (required by the Confluence REST API).
  // ---------------------------------------------------------------------------

  const outputFilename = 'jira_import.csv';

  // Check if jira_import.csv already exists on the page (so we can update vs create).
  let existingAttachmentId = null;
  const existingAttachment = attachments.find(a => a.title === outputFilename);
  if (existingAttachment) {
    existingAttachmentId = existingAttachment.id;
    console.log(`Found existing attachment "${outputFilename}" (id: ${existingAttachmentId}) — will update it.`);
  }

  // Build a multipart/form-data body manually.
  // Forge does not have a FormData global, so we construct the multipart body
  // as a string using a fixed boundary delimiter.
  const boundary = '----ForgeCSVUploadBoundary';
  const csvBytes = outputCsv; // UTF-8 string — Forge's fetch handles encoding.

  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${outputFilename}"\r\n` +
    `Content-Type: text/csv\r\n` +
    `\r\n` +
    `${csvBytes}\r\n` +
    `--${boundary}--`;

  // Choose the correct endpoint depending on whether we're creating or updating.
  // We use route`` with properly interpolated values (not a pre-built string)
  // so that Forge can correctly validate and sign the request path.
  let uploadResponse;
  try {
    uploadResponse = await api.asApp().requestConfluence(
      existingAttachmentId
        ? route`/wiki/rest/api/content/${pageId}/child/attachment/${existingAttachmentId}/data`
        : route`/wiki/rest/api/content/${pageId}/child/attachment`,
      {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          // Confluence requires this header to allow attachment uploads via REST API.
          'X-Atlassian-Token': 'no-check'
        },
        body: multipartBody
      }
    );
  } catch (err) {
    console.error(`Error uploading attachment: ${err.message}`);
    return {
      success: false,
      error: `Transformed ${jiraRows.length} tickets successfully, but failed to upload the result to Confluence: ${err.message}`
    };
  }

  if (!uploadResponse.ok) {
    const errText = await uploadResponse.text();
    console.error(`Confluence upload error ${uploadResponse.status}: ${errText}`);
    return {
      success: false,
      error: `Transformed ${jiraRows.length} tickets successfully, but Confluence returned HTTP ${uploadResponse.status} ` +
        `when uploading "${outputFilename}". Detail: ${errText}`
    };
  }

  const uploadResult = await uploadResponse.json();

  // Extract the download URL of the newly uploaded attachment.
  // The API returns a "results" array (create) or a direct result object (update).
  const uploadedAttachment = Array.isArray(uploadResult.results)
    ? uploadResult.results[0]
    : uploadResult;

  const attachmentDownloadPath = uploadedAttachment && uploadedAttachment._links
    ? uploadedAttachment._links.download
    : null;

  console.log(`Successfully uploaded "${outputFilename}" to page ${pageId}`);

  // Build the full URL to the attachment for the agent to share with the user.
  // We derive the base URL from the page URL provided by the user.
  let attachmentUrl = attachmentDownloadPath || '';
  if (attachmentUrl && rawPageUrl.startsWith('http')) {
    // Extract scheme + host from the page URL (e.g. "https://site.atlassian.net").
    const urlMatch = rawPageUrl.match(/^(https?:\/\/[^/]+)/);
    if (urlMatch) {
      attachmentUrl = urlMatch[1] + attachmentDownloadPath;
    }
  }

  // ---------------------------------------------------------------------------
  // STEP 11 — Return the result summary for the agent to relay to the user
  // ---------------------------------------------------------------------------

  return {
    success: true,
    ticketsConverted: jiraRows.length,
    maxComments,
    outputFilename,
    attachmentUrl,
    sourceFile: targetAttachment.title,
    message: `Successfully converted ${jiraRows.length} SNOW tickets into a Jira-ready CSV ` +
      `(${maxComments} comment columns). The file "${outputFilename}" has been uploaded to the same Confluence page.`
  };
}

export async function createSnowChangeRequest(payload) {
  // --- Step 1: Read and validate Forge environment variables ---
  // These are set at the app level and are not exposed to the frontend.
  const instanceUrl = process.env.SNOW_INSTANCE_URL;
  const username = process.env.SNOW_USERNAME;
  const password = process.env.SNOW_PASSWORD;

  // Check that all required credentials are configured.
  const missingVars = [];
  if (!instanceUrl) missingVars.push('SNOW_INSTANCE_URL');
  if (!username) missingVars.push('SNOW_USERNAME');
  if (!password) missingVars.push('SNOW_PASSWORD');

  if (missingVars.length > 0) {
    // Return a clear error so the agent can relay this to the user.
    return {
      success: false,
      error: `Missing Forge environment variable(s): ${missingVars.join(', ')}. ` +
        `Please ask an administrator to set these using the Forge CLI: ` +
        `forge variables set --environment development ${missingVars[0]} <value>`
    };
  }

  // Normalise the instance URL — strip any trailing slash to avoid double-slash in endpoint.
  const baseUrl = instanceUrl.replace(/\/$/, '');
  const endpoint = `${baseUrl}/api/now/table/change_request`;

  // --- Step 2: Build the SNOW Change Request payload ---
  // Construct short_description and justification from release_name and project_name,
  // which are passed as separate inputs to avoid undefined values.
  const releaseName = payload.release_name || 'Unknown Release';
  const projectName = payload.project_name || 'Unknown Project';
  const shortDescription = `Release ${releaseName} - ${projectName}`;
  const justification = `Scheduled Jira release ${releaseName} in project ${projectName}`;

  // The description is pre-built by the agent combining release description + issues list.
  const fullDescription = payload.description ||
    `Automated change request for Jira release ${releaseName} in project ${projectName}.`;

  // Map human-readable risk/impact labels to ServiceNow numeric values.
  // SNOW risk: 1=Very High, 2=High, 3=Moderate, 4=Low
  // SNOW impact: 1=High, 2=Medium, 3=Low
  const snowRisk = mapRisk(payload.risk);
  const snowImpact = mapImpact(payload.impact);

  // Ensure dates are in YYYY-MM-DD HH:MM:SS format.
  // If only a date (YYYY-MM-DD) was passed, append a default time.
  const formatDate = (date) => {
    if (!date) return null;
    // Already has time component
    if (date.includes(' ') || date.includes('T')) {
      return date.replace('T', ' ').substring(0, 19);
    }
    // Date only — append midnight
    return `${date} 00:00:00`;
  };

  const plannedStartDate = formatDate(payload.start_date);
  const plannedEndDate = formatDate(payload.end_date);

  const changeRequestBody = {
    short_description: shortDescription,
    description: fullDescription,
    type: payload.type,
    risk: snowRisk,
    impact: snowImpact,
    assignment_group: payload.assignment_group,
    // start_date and end_date map to the Planned start/end fields in the Schedule section.
    ...(plannedStartDate && { start_date: plannedStartDate }),
    ...(plannedEndDate && { end_date: plannedEndDate }),
    justification: justification,
    // Parse the additional_sections block into individual SNOW fields.
    // The agent generates a structured block with IMPLEMENTATION_PLAN, RISK_AND_IMPACT, TEST_PLAN sections.
    ...parseAdditionalSections(payload.additional_sections)
  };

  // Log the full raw payload received from the agent for debugging purposes.
  console.log(`Raw payload received from agent: ${JSON.stringify(payload)}`);
  // Log individual key fields explicitly to avoid log truncation.
  console.log(`Payload fields — risk: "${payload.risk}", impact: "${payload.impact}", type: "${payload.type}", assignment_group: "${payload.assignment_group}"`);
  console.log(`Mapped SNOW values — risk: "${snowRisk}", impact: "${snowImpact}", type: "${payload.type}"`);
  console.log(`changeRequestBody.risk = "${changeRequestBody.risk}", changeRequestBody.impact = "${changeRequestBody.impact}"`);
  console.log(`Creating SNOW Change Request: ${JSON.stringify({ endpoint, body: changeRequestBody })}`);

  // --- Step 3: Build the Basic Auth header ---
  // ServiceNow uses HTTP Basic Auth: base64-encoded "username:password".
  const credentials = Buffer.from(`${username}:${password}`).toString('base64');

  // --- Step 4: Call the ServiceNow Table API ---
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
        // Ask SNOW to return JSON (not XML).
        'Accept': 'application/json'
      },
      body: JSON.stringify(changeRequestBody)
    });
  } catch (networkError) {
    // This catches network-level failures (DNS, connection refused, timeout, etc.)
    // Most likely cause: SNOW_INSTANCE_URL is wrong, or the egress rule is not configured.
    console.error(`Network error calling SNOW API: ${networkError.message}`);
    return {
      success: false,
      error: `Could not reach ServiceNow at "${baseUrl}". ` +
        `Network error: ${networkError.message}. ` +
        `Please verify that SNOW_INSTANCE_URL is correct and that the Forge egress rule ` +
        `allows connections to *.service-now.com.`
    };
  }

  // --- Step 5: Parse the SNOW API response ---
  // Read the response body as text first, then try to parse as JSON.
  // This avoids the "body already read" error when we need to fall back to text.
  const responseText = await response.text();
  let responseBody;
  try {
    responseBody = JSON.parse(responseText);
  } catch (parseError) {
    // The response was not valid JSON — likely an HTML login/wake-up page from a
    // hibernated ServiceNow developer instance, or a proxy error.
    console.error(`Failed to parse SNOW API response as JSON: ${parseError.message}`);
    console.error(`Raw SNOW response body (first 500 chars): ${responseText.substring(0, 500)}`);
    const hint = responseText.includes('<html') || responseText.includes('<!DOCTYPE')
      ? ' Hint: ServiceNow returned an HTML page — the instance may be hibernating. ' +
        'Please go to https://developer.servicenow.com and wake up your instance, then try again.'
      : '';
    return {
      success: false,
      error: `ServiceNow returned an unexpected non-JSON response (HTTP ${response.status} ${response.statusText}).${hint} ` +
        `First 200 chars of response: ${responseText.substring(0, 200)}`
    };
  }

  // --- Step 6: Handle API-level errors ---
  // ServiceNow returns error details in a nested "error" object on non-2xx responses.
  if (!response.ok) {
    const snowError = responseBody.error || {};
    const snowMessage = snowError.message || 'No error message provided by ServiceNow';
    const snowDetail = snowError.detail || 'No additional detail provided';

    console.error(`SNOW API error ${response.status}: ${snowMessage} — ${snowDetail}`);

    // Provide specific guidance for common HTTP error codes.
    let hint = '';
    if (response.status === 401) {
      hint = ' Hint: Authentication failed — please verify SNOW_USERNAME and SNOW_PASSWORD in Forge variables.';
    } else if (response.status === 403) {
      hint = ' Hint: The SNOW service account does not have permission to create Change Requests. Contact your SNOW administrator.';
    } else if (response.status === 404) {
      hint = ' Hint: The ServiceNow endpoint was not found — please verify SNOW_INSTANCE_URL is correct (e.g. https://mycompany.service-now.com).';
    } else if (response.status === 400) {
      hint = ' Hint: The request was rejected by ServiceNow — check that all field values are valid (e.g. assignment_group name exists, dates are correctly formatted as YYYY-MM-DD HH:MM:SS).';
    } else if (response.status === 429) {
      hint = ' Hint: ServiceNow rate limit exceeded — please try again in a few moments.';
    }

    return {
      success: false,
      error: `ServiceNow returned an error (HTTP ${response.status}): ${snowMessage}. ` +
        `Detail: ${snowDetail}.${hint}`
    };
  }

  // --- Step 7: Extract and return the created Change Request details ---
  const createdRecord = responseBody.result || {};
  const crNumber = createdRecord.number || 'Unknown';
  const crSysId = createdRecord.sys_id || '';

  // Build a direct link to the Change Request in the SNOW UI.
  const crLink = crSysId
    ? `${baseUrl}/nav_to.do?uri=change_request.do?sys_id=${crSysId}`
    : `${baseUrl}/nav_to.do?uri=change_request.do?number=${crNumber}`;

  // Log key fields from the created record to verify SNOW accepted them correctly.
  console.log(`SNOW Change Request created successfully: ${crNumber} (sys_id: ${crSysId})`);
  console.log(`SNOW returned — risk: "${createdRecord.risk}", impact: "${createdRecord.impact}", type: "${createdRecord.type}"`);

  return {
    success: true,
    crNumber,
    crSysId,
    crLink,
    message: `Change Request ${crNumber} created successfully in ServiceNow.`
  };
}

