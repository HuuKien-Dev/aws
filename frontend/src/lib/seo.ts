import type { Metadata } from 'next'

export const SITE_URL = 'https://freelingo.app'

// Only canonical, public content belongs here. Account and app pages inherit noindex.
export const INDEXABLE_PATHS = ['/', '/privacy', '/terms'] as const

// Open Graph requires language_TERRITORY; these describe the UI catalogs,
// independently of the language a user is learning.
const OPEN_GRAPH_LOCALES: Record<string, string> = {
  vi: 'vi_VN',
  en: 'en_GB',
  es: 'es_ES',
  fr: 'fr_FR',
  pt: 'pt_BR',
  de: 'de_DE',
  it: 'it_IT',
  pl: 'pl_PL',
  nl: 'nl_NL',
  ro: 'ro_RO',
  ru: 'ru_RU',
  tr: 'tr_TR',
  sv: 'sv_SE',
  da: 'da_DK',
  fi: 'fi_FI',
  hr: 'hr_HR',
}

export function createPublicMetadata({
  path,
  title,
  description,
  locale,
}: {
  path: (typeof INDEXABLE_PATHS)[number]
  title: string
  description: string
  locale: string
}): Metadata {
  const url = new URL(path, SITE_URL).href
  const image = {
    url: new URL('/og-image-v2.png', SITE_URL).href,
    width: 1200,
    height: 630,
    alt: 'FreeLingo',
  }

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'website',
      siteName: 'FreeLingo',
      locale: OPEN_GRAPH_LOCALES[locale],
      url,
      title,
      description,
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [{ url: image.url, alt: image.alt }],
    },
  }
}
