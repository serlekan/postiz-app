# Serlekan X + LinkedIn automation — draft-first

## What is implemented

A standalone Node.js 22+ importer at scripts/serlekan/draft-import.mjs validates an editorial JSON file, checks connected Postiz accounts and optionally creates **drafts only** through Postiz's existing public API. It does not publish, schedule, change statuses, modify credentials, or alter Temporal workflows.

Editorial flow: research same-day trends → verify sources → write X and LinkedIn versions → preview locally → create Postiz drafts → human reviews and schedules in Postiz → Postiz publishes → review analytics.

LinkedIn builder research and connection recommendations remain paused. LinkedIn content publishing is a separate activity.

## Production setup

1. Use official Postiz self-host documentation to deploy the existing Postgres, Redis, Temporal, backend, frontend and media infrastructure. Do not use the sample docker-compose file unchanged: it contains placeholder credentials. Use HTTPS, secure backups, worker monitoring, restricted registration and a secret store.
2. Set required environment values for the running version: DATABASE_URL, REDIS_URL, JWT_SECRET, FRONTEND_URL, NEXT_PUBLIC_BACKEND_URL, BACKEND_INTERNAL_URL and TEMPORAL_ADDRESS. Follow official migration and storage guidance.
3. Configure an X developer app with posting permissions, OAuth callback and adequate usage balance. X now has pay-per-use API pricing; evaluate costs before enabling automatic publication.
4. Configure the LinkedIn developer app with Share on LinkedIn and w_member_social for personal posts. Posting to an organization page needs separate permissions.
5. Connect the *correct* X and LinkedIn profiles in the Postiz dashboard via official OAuth and generate a Postiz API key. Never store credentials in Git. Avoid unofficial scraping/cookie automation.

Official sources: https://docs.postiz.com/ ; https://developer.x.com/ ; https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin

## Editorial JSON file

Create a local file named todays-story.json with this shape. This example is evergreen test copy, not an up-to-date story:

~~~json
{
  "status": "ready_for_review",
  "category": "evergreen",
  "date": "2030-11-06T18:30:00+01:00",
  "sources": [],
  "entries": [
    { "network": "x", "content": ["AI makes software easier to generate.", "Reliable delivery still needs review and recovery."] },
    { "network": "linkedin", "content": "AI-assisted development has shifted the bottleneck. Teams still need verification, clear permissions and predictable recovery." }
  ]
}
~~~

- Non-evergreen categories (news, story, industry, security) require HTTPS sources. This checks source *presence*, not truth or editorial quality; source URLs remain in the local file.
- Each X thread segment must fit the conservative 280-Unicode-codepoint guard; Postiz's platform validation is authoritative.
- The LinkedIn version is a single, independently adapted text. Do not automatically cross-post unedited X threads.
- The date must be future-dated with explicit timezone offset. For WAT, use +01:00. It is a proposed time, not automatic publishing authorization.
- Media is uploaded and checked through Postiz's existing media library and editor after draft creation. The importer does not attach or create images.

## Local preview

~~~bash
node --test scripts/serlekan/draft-import.test.mjs
node scripts/serlekan/draft-import.mjs --file todays-story.json
~~~

The second command displays the payload offline; it never contacts Postiz.

## Draft import

After your Postiz server and social channels are connected, set these **private** environment variables in your local shell or secret store:

~~~bash
export POSTIZ_BASE_URL='https://your-postiz-backend.example.com'
export POSTIZ_API_KEY='secret-from-your-own-account'
# Only when there is more than one connected account of a provider:
export POSTIZ_X_INTEGRATION_ID='x-channel-id'
export POSTIZ_LINKEDIN_INTEGRATION_ID='linkedin-channel-id'
node scripts/serlekan/draft-import.mjs --file todays-story.json --apply
~~~

The importer GETs /public/v1/integrations and POSTs /public/v1/posts with type=draft. It does not call now, schedule or the status-change endpoint. If the server reports an error, check the Postiz calendar before retrying: network timeouts can occur *after* a draft was created, and the importer has no server-side idempotency key.

Only the owner approves and schedules the content in Postiz. No OAuth credentials, server deployment or actual posts are provisioned by this branch.

## Initial cadence and review

- X: retain the separate daily posting routine and draft researched stories on Tuesday, Thursday, Saturday based on that day's real news, not an advance queue of speculative topics.
- Suggested initial X story windows: Tuesday/Thursday 18:00–20:00 WAT; Saturday 12:00–15:00 WAT. Reassess with account analytics rather than claiming a universal optimal time.
- LinkedIn: continue daily professional authority posts with platform-specific edits; LinkedIn builder research remains paused.
- Measure post reach, meaningful replies, profile visits, follower gain and qualified profile clicks after four weeks.
- Never automatically post unverified claims, third-party private data, replies, connection invitations or DMs.

## Go-live verification

1. [ ] Production Postiz stack is healthy, backed up, migrated and reachable only over HTTPS.
2. [ ] OAuth integrations show the exact authorized X and LinkedIn profiles.
3. [ ] Imported items remain DRAFT and cannot publish without later manual scheduling.
4. [ ] Timezone, images and platform preview are correct.
5. [ ] A separately approved sample post publishes on time and has a verifiable public URL.
6. [ ] Worker, credential refresh, errors and analytics are monitored.
