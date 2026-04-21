const { chromium } = require("@playwright/test")

const APP_URL = "http://127.0.0.1:3010"
const PROJECT_NAME = "leadqual"
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

const checks = [
  { label: "dashboard", path: "/" },
  { label: "other-project-page", path: "/projects/rbc/overview" },
  { label: "project-chat", path: "/projects/leadqual/chat" },
  { label: "global-chat", path: "/chat" },
]

async function triggerThreadEvent(threadId) {
  const response = await fetch(`${APP_URL}/api/chat/thread`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectName: PROJECT_NAME,
      threadId,
      messages: [
        {
          id: `${threadId}-user`,
          role: "user",
          content: "Phase 8 realtime verification",
          source: "chat",
        },
        {
          id: `${threadId}-assistant`,
          role: "assistant",
          content: "Phase 8 realtime verification reply",
          source: "chat",
        },
      ],
    }),
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Thread trigger failed (${response.status}): ${text}`)
  }

  return text
}

async function verifySurface(browser, check, index) {
  const page = await browser.newPage()
  const threadId = `phase8-ui-${check.label}-${Date.now()}-${index}`
  const expectedNotice = `${PROJECT_NAME}: Chat thread updated`

  await page.goto(`${APP_URL}${check.path}`, { waitUntil: "domcontentloaded", timeout: 45000 })
  await page.waitForTimeout(1000)

  const before = await page.evaluate(() => document.body.innerText)
  const reply = await triggerThreadEvent(threadId)

  await page.waitForFunction(
    ({ expected, previous }) => {
      const body = document.body.innerText
      return body.includes(expected) && body !== previous
    },
    { expected: expectedNotice, previous: before },
    { timeout: 15000 },
  )

  const after = await page.evaluate(() => document.body.innerText)
  const hasNotice = after.includes(expectedNotice)

  await page.close()

  return {
    label: check.label,
    path: check.path,
    threadId,
    expectedNotice,
    hasNotice,
    replyPreview: reply.slice(0, 140),
  }
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
  })

  try {
    const results = []
    for (const [index, check] of checks.entries()) {
      results.push(await verifySurface(browser, check, index))
    }
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
