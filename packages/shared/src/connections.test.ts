import { expect, it } from 'vitest'
import { appName, appSlug, suggestedApps } from './connections.js'

it.each([['Google Drive', 'googledrive'], ['google-drive', 'googledrive'], ['drive', 'googledrive'], [' GOOGLE_MAIL ', 'gmail'], ['Google Calendar', 'googlecalendar'], ['google-sheets', 'googlesheets'], ['GitHub MCP', 'github'], ['HubSpot', 'hubspot']])('resolves app alias %s to %s', (name, slug) => { expect(appSlug(name)).toBe(slug) })
it('template suggestions resolve to human-readable app names', () => {
  expect(suggestedApps.growth?.map(appName)).toEqual(['Gmail', 'HubSpot', 'Google Sheets'])
  expect(suggestedApps.engineer?.map(appSlug)).toEqual(['github', 'slack'])
  expect(suggestedApps.custom).toEqual([])
})
