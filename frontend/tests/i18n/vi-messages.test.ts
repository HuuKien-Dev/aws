import { describe, expect, it } from 'vitest'
import {
  parse,
  TYPE,
  type MessageFormatElement,
} from '@formatjs/icu-messageformat-parser'
import { createTranslator } from 'next-intl'
import english from '../../../messages/en.json'
import vietnamese from '../../../messages/vi.json'

function flatten(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value }
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) =>
      Object.entries(flatten(child, prefix ? `${prefix}.${key}` : key))
    )
  )
}

function signature(text: string) {
  const variables = new Set<string>()
  const tags = new Set<string>()
  function visit(elements: MessageFormatElement[]) {
    for (const element of elements) {
      switch (element.type) {
        case TYPE.literal:
        case TYPE.pound:
          break
        case TYPE.tag:
          tags.add(element.value)
          visit(element.children)
          break
        case TYPE.plural:
        case TYPE.select:
          variables.add(`${element.type}:${element.value}`)
          for (const option of Object.values(element.options))
            visit(option.value)
          break
        default:
          variables.add(`${element.type}:${element.value}`)
      }
    }
  }
  visit(parse(text))
  return { variables: [...variables].sort(), tags: [...tags].sort() }
}

describe('Vietnamese catalog', () => {
  it('covers every English key and preserves interpolation and rich text tags', () => {
    const translated = flatten(vietnamese)
    for (const [key, original] of Object.entries(flatten(english))) {
      expect(translated[key], key).toBeDefined()
      expect(translated[key]?.trim(), key).not.toBe('')
      expect(signature(translated[key]), key).toEqual(signature(original))
    }
  })

  it('distinguishes plural branch text from arguments and renders the Vietnamese day label', () => {
    expect(signature(english.dashboardProgress.days)).toEqual({
      variables: [`${TYPE.plural}:count`],
      tags: [],
    })
    expect(signature(vietnamese.dashboardProgress.days)).toEqual(
      signature(english.dashboardProgress.days)
    )
    const t = createTranslator({ locale: 'vi', messages: vietnamese })
    for (const count of [0, 1, 2, 5, 21]) {
      expect(t('dashboardProgress.days', { count })).toBe('ngày')
    }
  })

  it('still detects missing nested variables, changed argument types and lost rich text tags', () => {
    const original =
      '<strong>{count, plural, one {{name}} other {{name}: #}}</strong>'
    expect(signature(original)).toEqual({
      variables: [`${TYPE.argument}:name`, `${TYPE.plural}:count`],
      tags: ['strong'],
    })
    expect(signature('{count, plural, other {#}}')).not.toEqual(
      signature(original)
    )
    expect(signature('{count}')).not.toEqual(
      signature('{count, plural, other {#}}')
    )
    expect(signature("'{name}' {actual}").variables).toEqual([
      `${TYPE.argument}:actual`,
    ])
    expect(() => signature('{count, plural, other {unfinished}')).toThrow()
  })
})
