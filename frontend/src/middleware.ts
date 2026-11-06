import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { SUPPORTED_LOCALES, type Locale } from '@/lib/locales'

// Routes that require authentication — anything else passes through so unknown
// URLs reach Next.js's 404 handler instead of being redirected to /login.
const PROTECTED_ROUTES = [
  '/admin',
  '/assessment',
  '/billing',
  '/chat',
  '/conversation',
  '/dashboard',
  '/faq',
  '/feedback',
  '/flashcards',
  '/games',
  '/grammar',
  '/lesson',
  '/listening',
  '/onboarding',
  '/phrasebook',
  '/plan',
  '/progress',
  '/reading',
  '/settings',
  '/vocabulary',
]

function detectLocale(req: NextRequest): Locale {
  // 1. Cookie already set — respect user choice
  const cookie = req.cookies.get('NEXT_LOCALE')?.value
  if (cookie && (SUPPORTED_LOCALES as readonly string[]).includes(cookie)) {
    return cookie as Locale
  }

  // New visitors use Vietnamese; an existing choice always takes precedence.
  return 'vi'
}

export function middleware(req: NextRequest) {
  // A deliberate language switch takes precedence over a saved preference.
  const requestedLocale = req.nextUrl.searchParams.get('ui_locale')
  if (
    requestedLocale &&
    (SUPPORTED_LOCALES as readonly string[]).includes(requestedLocale)
  ) {
    const destination = req.nextUrl.clone()
    destination.searchParams.delete('ui_locale')
    if (
      !req.cookies.has('refresh_token') &&
      PROTECTED_ROUTES.some((route) => destination.pathname.startsWith(route))
    ) {
      destination.pathname = '/login'
    }
    const response = NextResponse.redirect(destination)
    response.cookies.set('NEXT_LOCALE', requestedLocale, {
      path: '/',
      sameSite: 'lax',
      secure: req.nextUrl.protocol === 'https:',
      maxAge: 60 * 60 * 24 * 365,
    })
    return response
  }

  // Detect locale first so we can forward it as a request header.
  // This is needed because request.ts reads incoming request headers/cookies;
  // a cookie set only on the response is not visible on that same request cycle.
  const locale = detectLocale(req)

  const hasRefreshToken = req.cookies.has('refresh_token')
  const isProtected = PROTECTED_ROUTES.some((r) =>
    req.nextUrl.pathname.startsWith(r)
  )

  if (!hasRefreshToken && isProtected) {
    const response = NextResponse.redirect(new URL('/login', req.url))
    if (!req.cookies.has('NEXT_LOCALE')) {
      response.cookies.set('NEXT_LOCALE', locale, {
        path: '/',
        sameSite: 'lax',
        secure: req.nextUrl.protocol === 'https:',
        maxAge: 60 * 60 * 24 * 365,
      })
    }
    return response
  }

  // Inject locale as a request header so request.ts picks it up immediately
  // (even on the very first visit when no NEXT_LOCALE cookie exists yet)
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-next-locale', locale)

  const response = NextResponse.next({ request: { headers: requestHeaders } })

  // Persist as cookie for subsequent requests
  if (!req.cookies.has('NEXT_LOCALE')) {
    response.cookies.set('NEXT_LOCALE', locale, {
      path: '/',
      sameSite: 'lax',
      secure: req.nextUrl.protocol === 'https:',
      maxAge: 60 * 60 * 24 * 365,
    })
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next|favicon\.ico|api|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
