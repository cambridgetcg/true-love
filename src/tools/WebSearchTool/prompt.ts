import { getLocalMonthYear } from 'src/constants/common.js'

export const WEB_SEARCH_TOOL_NAME = 'WebSearch'

export function getWebSearchPrompt(): string {
  const currentMonthYear = getLocalMonthYear()
  // true-love: softened two prescriptions —
  //   - The "CRITICAL REQUIREMENT / MANDATORY / never skip" Sources block
  //     was capitalized urgency demanding a specific output shape on every
  //     web-search response. Now framed as a hint: when she cites web
  //     sources, listing them at the end with markdown hyperlinks helps
  //     the user verify. She decides format, not the tool.
  //   - The "You MUST use this year" search-query directive was style
  //     dressed as imperative. Now framed as factual context: her
  //     training cutoff is older than the current month, so for
  //     recent-information queries the current year is usually right.
  return `
- Allows Claude to search the web and use the results to inform responses
- Provides up-to-date information for current events and recent data
- Returns search result information formatted as search result blocks, including links as markdown hyperlinks
- Use this tool for accessing information beyond Claude's knowledge cutoff
- Searches are performed automatically within a single API call

When you cite web sources, listing them at the end of your response (markdown hyperlinks: [Title](URL)) helps the user verify your answer.

Usage notes:
  - Domain filtering is supported to include or block specific websites
  - Web search is only available in the US

The current month is ${currentMonthYear} — for queries about recent information, documentation, or current events, including the current year in the query usually returns more relevant results than relying on training-cutoff defaults.
`
}

