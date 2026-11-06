'use client'

import { useEffect } from 'react'
import { useLocale } from 'next-intl'
import { useConfigStore } from '@/store/config'

export function CustomEditionNotice() {
  const locale = useLocale()
  const load = useConfigStore((s) => s.load)
  const sourceUrl = useConfigStore((s) => s.customSourceUrl)
  useEffect(() => {
    void load()
  }, [load])
  const safeUrl = /^https?:\/\//.test(sourceUrl) ? sourceUrl : ''

  return (
    <footer
      lang="vi"
      className="border-fl-border text-fl-muted-2 border-t p-3 text-center font-sans text-xs"
    >
      {locale !== 'vi' && (
        <button
          className="mr-3 underline"
          onClick={() => {
            const url = new URL(window.location.href)
            url.searchParams.set('ui_locale', 'vi')
            window.location.assign(url.toString())
          }}
        >
          Chuyển sang tiếng Việt
        </button>
      )}
      Bản tùy biến dành cho người Việt, phát triển dựa trên FreeLingo của Arturo
      Carretero Calvo · AGPL-3.0.{' '}
      {safeUrl ? (
        <a href={safeUrl} className="underline" rel="noopener noreferrer">
          Mã nguồn phiên bản đang triển khai
        </a>
      ) : (
        <span>Liên kết mã nguồn bản tùy biến chưa được cấu hình.</span>
      )}
    </footer>
  )
}
