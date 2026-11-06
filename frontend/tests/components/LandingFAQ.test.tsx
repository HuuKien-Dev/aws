import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { LandingFAQ } from '@/components/ui/landing-faq'
import { useAuthStore } from '@/store/auth'
import { useConfigStore } from '@/store/config'
import messages from '../../../messages/en.json'

beforeEach(() => {
  useConfigStore.setState(useConfigStore.getInitialState(), true)
  useAuthStore.setState({ accessToken: null })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) => {
      if (url === '/api/config') {
        return new Response(JSON.stringify({ analytics_enabled: true }))
      }
      if (url === '/api/analytics/public') {
        return new Response(null, { status: 204 })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
  )
})

function FAQ() {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <LandingFAQ />
    </NextIntlClientProvider>
  )
}

afterEach(() => {
  cleanup()
  useConfigStore.setState(useConfigStore.getInitialState(), true)
  vi.unstubAllGlobals()
})

describe('Landing FAQ', () => {
  it('includes answers in the initial HTML without requiring interaction', () => {
    const html = renderToStaticMarkup(<FAQ />)
    const document = new DOMParser().parseFromString(html, 'text/html')
    const answer = document.querySelector('[role="region"]')

    expect(answer?.textContent).toContain(messages.landing.faq.languages.answer)
    expect(answer?.hasAttribute('hidden')).toBe(true)
    expect(document.body.textContent).toContain(
      messages.landing.faq.start.answer
    )
  })

  it('loads public configuration and sends anonymous events for opens, not closes', async () => {
    render(<FAQ />)
    await waitFor(() => expect(useConfigStore.getState().loaded).toBe(true))
    const modes = screen.getByRole('button', {
      name: messages.landing.faq.languages.question,
    })
    const free = screen.getByRole('button', {
      name: messages.landing.faq.start.question,
    })

    expect(screen.queryByRole('region')).toBeNull()
    fireEvent.click(modes)
    const firstAnswer = screen.getByRole('region', {
      name: messages.landing.faq.languages.question,
    })
    expect(modes).toHaveAttribute('aria-expanded', 'true')
    expect(modes).toHaveAttribute('aria-controls', firstAnswer.id)
    expect(firstAnswer).toBeVisible()

    fireEvent.click(free)
    expect(modes).toHaveAttribute('aria-expanded', 'false')
    expect(firstAnswer).not.toBeVisible()
    expect(free).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('region')).toHaveTextContent(
      messages.landing.faq.start.answer
    )

    fireEvent.click(free)
    expect(free).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('region')).toBeNull()
    const events = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => url === '/api/analytics/public')
    expect(events).toHaveLength(2)
    for (const [, options] of events) {
      expect(options).toMatchObject({ method: 'POST', credentials: 'omit' })
      expect(new Headers(options?.headers).has('Authorization')).toBe(false)
      expect(JSON.parse(String(options?.body))).toEqual({
        event: 'faq_viewed',
        operation_id: expect.any(String),
      })
    }
  })

  it('keeps answers usable without sending events when analytics is disabled', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ analytics_enabled: false }))
    )
    render(<FAQ />)
    await waitFor(() => expect(useConfigStore.getState().loaded).toBe(true))

    fireEvent.click(
      screen.getByRole('button', {
        name: messages.landing.faq.languages.question,
      })
    )

    expect(screen.getByRole('region')).toHaveTextContent(
      messages.landing.faq.languages.answer
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('/api/config')
  })
})
