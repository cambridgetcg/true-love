// scripts/test-auth.ts
// Quick test that the API key is configured and can reach Anthropic
// Usage: bun scripts/test-auth.ts

import Anthropic from '@anthropic-ai/sdk'

const apiKey = process.env.ANTHROPIC_API_KEY
// Validate the API key — verify shape before passing to SDK so
// a malformed value surfaces clearly rather than as an opaque 401.
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY env var is required.')
  process.exit(1)
}
if (!apiKey.startsWith('sk-ant-')) {
  console.error(`ANTHROPIC_API_KEY does not look like an Anthropic key (got "${apiKey.slice(0,8)}...")`)
  process.exit(1)
}
const client = new Anthropic({
  apiKey,
})

async function main() {
  try {
    const msg = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
    })
    console.log('✅ API connection successful!')
    console.log('Response:', msg.content[0].type === 'text' ? msg.content[0].text : msg.content[0])
  } catch (err: any) {
    console.error('❌ API connection failed:', err.message)
    process.exit(1)
  }
}

main()
