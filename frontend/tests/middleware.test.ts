import { describe, it, expect, vi, beforeEach } from 'vitest'
import { middleware } from '@/middleware'
import { NextRequest } from 'next/server'

function createRequest(
  path: string,
  options: {
    cookies?: Record<string, string>
    acceptLanguage?: string
  } = {}
): NextRequest {
  const url = `http://localhost:3000${path}`
  const headers = new Headers()
  if (options.acceptLanguage) {
    headers.set('accept-language', options.acceptLanguage)
  }

  const req = new NextRequest(url, { headers })

  if (options.cookies) {
    Object.entries(options.cookies).forEach(([key, value]) => {
      req.cookies.set(key, value)
    })
  }

  return req
}

describe('middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('route protection', () => {
    it.each(['/dashboard', '/games', '/reading'])('redirects %s to /login without refresh_token', (path) => {
      const req = createRequest(path)
      const res = middleware(req)

      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toContain('/login')
    })

    it.each(['/dashboard', '/games', '/reading'])('allows %s with refresh_token', (path) => {
      const req = createRequest(path, {
        cookies: { refresh_token: 'valid-token' },
      })
      const res = middleware(req)

      expect(res.status).toBe(200)
    })

    it('allows public routes without refresh_token', () => {
      const req = createRequest('/login')
      const res = middleware(req)

      expect(res.status).toBe(200)
    })

    it('redirects for nested protected routes', () => {
      const req = createRequest('/admin/users')
      const res = middleware(req)

      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toContain('/login')
    })

    it('redirects for lesson routes', () => {
      const req = createRequest('/lesson/123')
      const res = middleware(req)

      expect(res.status).toBe(307)
    })
  })

  describe('locale detection', () => {
    it('respects NEXT_LOCALE cookie and sets it in response', () => {
      const req = createRequest('/login', {
        cookies: { NEXT_LOCALE: 'es' },
        acceptLanguage: 'fr',
      })
      const res = middleware(req)

      const setCookie = res.headers.get('set-cookie')
      expect(setCookie).toBeNull()
    })

    it('defaults to Vietnamese despite the browser language', () => {
      const req = createRequest('/login', {
        acceptLanguage: 'es-ES,es;q=0.9,en;q=0.8',
      })
      const res = middleware(req)

      const setCookie = res.headers.get('set-cookie')
      expect(setCookie).toContain('NEXT_LOCALE=vi')
    })

    it('defaults to Vietnamese for a Swedish browser', () => {
      const req = createRequest('/login', {
        acceptLanguage: 'sv-SE,sv;q=0.9,en;q=0.8',
      })

      const res = middleware(req)
      expect(res.headers.get('set-cookie')).toContain('NEXT_LOCALE=vi')
    })

    it('defaults to Vietnamese for a Danish browser', () => {
      const req = createRequest('/login', {
        acceptLanguage: 'da-DK,da;q=0.9,en;q=0.8',
      })

      const res = middleware(req)
      expect(res.headers.get('set-cookie')).toContain('NEXT_LOCALE=vi')
    })

    it('defaults to Vietnamese for a Finnish browser', () => {
      const req = createRequest('/login', {
        acceptLanguage: 'fi-FI,fi;q=0.9,en;q=0.8',
      })

      const res = middleware(req)
      expect(res.headers.get('set-cookie')).toContain('NEXT_LOCALE=vi')
    })

    it('defaults to Vietnamese for a Croatian browser', () => {
      const req = createRequest('/login', {
        acceptLanguage: 'hr-HR,hr;q=0.9,en;q=0.8',
      })

      const res = middleware(req)
      expect(res.headers.get('set-cookie')).toContain('NEXT_LOCALE=vi')
    })

    it('defaults to Vietnamese without browser preferences', () => {
      const req = createRequest('/login')
      const res = middleware(req)

      const setCookie = res.headers.get('set-cookie')
      expect(setCookie).toContain('NEXT_LOCALE=vi')
    })

    it('keeps the Vietnamese default with complex language headers', () => {
      const req = createRequest('/login', {
        acceptLanguage: 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      })
      const res = middleware(req)

      const setCookie = res.headers.get('set-cookie')
      expect(setCookie).toContain('NEXT_LOCALE=vi')
    })

    it('sets NEXT_LOCALE cookie when not present', () => {
      const req = createRequest('/login', {
        acceptLanguage: 'es',
      })
      const res = middleware(req)

      const setCookie = res.headers.get('set-cookie')
      expect(setCookie).toContain('NEXT_LOCALE=vi')
    })

    it('does not overwrite existing NEXT_LOCALE cookie', () => {
      const req = createRequest('/login', {
        cookies: { NEXT_LOCALE: 'fr' },
        acceptLanguage: 'es',
      })
      const res = middleware(req)

      const setCookie = res.headers.get('set-cookie')
      expect(setCookie).toBeNull()
    })

    it('sets locale cookie on redirect to /login', () => {
      const req = createRequest('/dashboard', {
        acceptLanguage: 'es',
      })
      const res = middleware(req)

      const setCookie = res.headers.get('set-cookie')
      expect(setCookie).toContain('NEXT_LOCALE=vi')
    })
  })
})


describe('explicit interface language selection', () => {
  it('replaces an English preference only after an explicit Vietnamese selection', () => {
    const response = middleware(createRequest('/?ui_locale=vi&lesson=1', {
      cookies: { NEXT_LOCALE: 'en' },
    }))
    expect(response.headers.get('location')).toBe('http://localhost:3000/?lesson=1')
    expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('vi')
    expect(response.cookies.get('NEXT_LOCALE')?.secure).toBe(false)
  })

  it('preserves the authentication guard when selecting a language', () => {
    const response = middleware(createRequest('/dashboard?ui_locale=vi'))
    expect(response.headers.get('location')).toBe('http://localhost:3000/login')
    expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('vi')
  })

  it('ignores unsupported selections and preserves the saved language', () => {
    const response = middleware(createRequest('/?ui_locale=unknown', {
      cookies: { NEXT_LOCALE: 'en' },
    }))
    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-request-x-next-locale')).toBe('en')
  })
})
