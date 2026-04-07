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

