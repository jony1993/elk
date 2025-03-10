// @unimport-disable
import type { mastodon } from 'masto'
import type { Node } from 'ultrahtml'
import { DOCUMENT_NODE, ELEMENT_NODE, TEXT_NODE, h, parse, render } from 'ultrahtml'
import { findAndReplaceEmojisInText } from '@iconify/utils'
import { decode } from 'tiny-decode'
import { emojiRegEx, getEmojiAttributes } from '../config/emojis'

export interface ContentParseOptions {
  emojis?: Record<string, mastodon.v1.CustomEmoji>
  mentions?: mastodon.v1.StatusMention[]
  markdown?: boolean
  replaceUnicodeEmoji?: boolean
  astTransforms?: Transform[]
  convertMentionLink?: boolean
}

const sanitizerBasicClasses = filterClasses(/^(h-\S*|p-\S*|u-\S*|dt-\S*|e-\S*|mention|hashtag|ellipsis|invisible)$/u)
const sanitizer = sanitize({
  // Allow basic elements as seen in https://github.com/mastodon/mastodon/blob/17f79082b098e05b68d6f0d38fabb3ac121879a9/lib/sanitize_ext/sanitize_config.rb
  br: {},
  p: {},
  a: {
    href: filterHref(),
    class: sanitizerBasicClasses,
    rel: set('nofollow noopener noreferrer'),
    target: set('_blank'),
  },
  span: {
    class: sanitizerBasicClasses,
  },
  // Allow elements potentially created for Markdown code blocks above
  pre: {},
  code: {
    class: filterClasses(/^language-\w+$/),
  },
})

/**
 * Parse raw HTML form Mastodon server to AST,
 * with interop of custom emojis and inline Markdown syntax
 */
export function parseMastodonHTML(
  html: string,
  options: ContentParseOptions = {},
) {
  const {
    markdown = true,
    replaceUnicodeEmoji = true,
    convertMentionLink = false,
    mentions,
  } = options

  if (markdown) {
    // Handle code blocks
    html = html
      .replace(/>(```|~~~)(\w*)([\s\S]+?)\1/g, (_1, _2, lang: string, raw: string) => {
        const code = htmlToText(raw)
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/`/, '&#96;')
        const classes = lang ? ` class="language-${lang}"` : ''
        return `><pre><code${classes}>${code}</code></pre>`
      })
      .replace(/`([^`\n]*)`/g, (_1, raw) => {
        return raw ? `<code>${htmlToText(raw).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>` : ''
      })
  }

  // Always sanitize the raw HTML data *after* it has been modified
  const transforms: Transform[] = [
    sanitizer,
    ...options.astTransforms || [],
  ]

  if (replaceUnicodeEmoji)
    transforms.push(transformUnicodeEmoji)

  if (markdown)
    transforms.push(transformMarkdown)

  if (mentions?.length)
    transforms.push(createTransformNamedMentions(mentions))

  if (convertMentionLink)
    transforms.push(transformMentionLink)

  transforms.push(replaceCustomEmoji(options.emojis || {}))

  transforms.push(transformParagraphs)

  return transformSync(parse(html), transforms)
}

/**
 * Converts raw HTML form Mastodon server to HTML for Tiptap editor
 */
export function convertMastodonHTML(html: string, customEmojis: Record<string, mastodon.v1.CustomEmoji> = {}) {
  const tree = parseMastodonHTML(html, {
    emojis: customEmojis,
    markdown: true,
    replaceUnicodeEmoji: false,
    convertMentionLink: true,
  })
  return render(tree)
}

export function htmlToText(html: string) {
  try {
    const tree = parse(html)
    return (tree.children as Node[]).map(n => treeToText(n)).join('').trim()
  }
  catch (err) {
    console.error(err)
    return ''
  }
}

export function treeToText(input: Node): string {
  let pre = ''
  let body = ''
  let post = ''

  if (input.type === TEXT_NODE)
    return decode(input.value)

  if (input.name === 'br')
    return '\n'

  if (['p', 'pre'].includes(input.name))
    pre = '\n'

  if (input.name === 'code') {
    if (input.parent?.name === 'pre') {
      const lang = input.attributes.class?.replace('language-', '')

      pre = `\`\`\`${lang || ''}\n`
      post = '\n```'
    }
    else {
      pre = '`'
      post = '`'
    }
  }
  else if (input.name === 'b' || input.name === 'strong') {
    pre = '**'
    post = '**'
  }
  else if (input.name === 'i' || input.name === 'em') {
    pre = '*'
    post = '*'
  }
  else if (input.name === 'del') {
    pre = '~~'
    post = '~~'
  }

  if ('children' in input)
    body = (input.children as Node[]).map(n => treeToText(n)).join('')

  if (input.name === 'img') {
    if (input.attributes.class?.includes('custom-emoji'))
      return `:${input.attributes['data-emoji-id']}:`
    if (input.attributes.class?.includes('iconify-emoji'))
      return input.attributes.alt
  }

  return pre + body + post
}

// A tree transform function takes an ultrahtml Node object and returns
// new content that will replace the given node in the tree.
// Returning a null removes the node from the tree.
// Strings get converted to text nodes.
// The input node's children have been transformed before the node itself
// gets transformed.
type Transform = (node: Node) => (Node | string)[] | Node | string | null

// Helpers for transforming (filtering, modifying, ...) a parsed HTML tree
// by running the given chain of transform functions one-by-one.
function transformSync(doc: Node, transforms: Transform[]) {
  function visit(node: Node, transform: Transform, isRoot = false) {
    if (Array.isArray(node.children)) {
      const children = [] as (Node | string)[]
      for (let i = 0; i < node.children.length; i++) {
        const result = visit(node.children[i], transform)
        if (Array.isArray(result))
          children.push(...result)

        else if (result)
          children.push(result)
      }

      node.children = children.map((value) => {
        if (typeof value === 'string')
          return { type: TEXT_NODE, value, parent: node }
        value.parent = node
        return value
      })
    }
    return isRoot ? node : transform(node)
  }

  for (const transform of transforms)
    doc = visit(doc, transform, true) as Node

  return doc
}

// A tree transform for sanitizing elements & their attributes.
type AttrSanitizers = Record<string, (value: string | undefined) => string | undefined>
function sanitize(allowedElements: Record<string, AttrSanitizers>): Transform {
  return (node) => {
    if (node.type !== ELEMENT_NODE)
      return node

    if (!Object.prototype.hasOwnProperty.call(allowedElements, node.name))
      return null

    const attrSanitizers = allowedElements[node.name]
    const attrs = {} as Record<string, string>
    for (const [name, func] of Object.entries(attrSanitizers)) {
      const value = func(node.attributes[name])
      if (value !== undefined)
        attrs[name] = value
    }
    node.attributes = attrs
    return node
  }
}

function filterClasses(allowed: RegExp) {
  return (c: string | undefined) => {
    if (!c)
      return undefined

    return c.split(/\s/g).filter(cls => allowed.test(cls)).join(' ')
  }
}

function set(value: string) {
  return () => value
}

function filterHref() {
  const LINK_PROTOCOLS = new Set([
    'http:',
    'https:',
    'dat:',
    'dweb:',
    'ipfs:',
    'ipns:',
    'ssb:',
    'gopher:',
    'xmpp:',
    'magnet:',
    'gemini:',
  ])

  return (href: string | undefined) => {
    if (href === undefined)
      return undefined

    // Allow relative links
    if (href.startsWith('/') || href.startsWith('.'))
      return href

    let url
    try {
      url = new URL(href)
    }
    catch (err) {
      if (err instanceof TypeError)
        return undefined
      throw err
    }

    if (LINK_PROTOCOLS.has(url.protocol))
      return url.toString()
    return '#'
  }
}

function transformUnicodeEmoji(node: Node) {
  if (node.type !== TEXT_NODE)
    return node

  let start = 0

  const matches = [] as (string | Node)[]
  findAndReplaceEmojisInText(emojiRegEx, node.value, (match, result) => {
    const attrs = getEmojiAttributes(match)
    matches.push(result.slice(start))
    matches.push(h('img', { src: attrs.src, alt: attrs.alt, class: attrs.class }))
    start = result.length + match.match.length
    return undefined
  })
  if (matches.length === 0)
    return node

  matches.push(node.value.slice(start))
  return matches.filter(Boolean)
}

function replaceCustomEmoji(customEmojis: Record<string, mastodon.v1.CustomEmoji>): Transform {
  return (node) => {
    if (node.type !== TEXT_NODE)
      return node

    const split = node.value.split(/:([\w-]+?):/g)
    if (split.length === 1)
      return node

    return split.map((name, i) => {
      if (i % 2 === 0)
        return name

      const emoji = customEmojis[name]
      if (!emoji)
        return `:${name}:`

      return h('img', { 'src': emoji.url, 'alt': `:${name}:`, 'class': 'custom-emoji', 'data-emoji-id': name })
    }).filter(Boolean)
  }
}

const _markdownReplacements: [RegExp, (c: (string | Node)[]) => Node][] = [
  [/\*\*\*(.*?)\*\*\*/g, c => h('b', null, [h('em', null, c)])],
  [/\*\*(.*?)\*\*/g, c => h('b', null, c)],
  [/\*(.*?)\*/g, c => h('em', null, c)],
  [/~~(.*?)~~/g, c => h('del', null, c)],
  [/`([^`]+?)`/g, c => h('code', null, c)],
  // transform @username@twitter.com as links
  [/\B@([a-zA-Z0-9_]+)@twitter\.com\b/gi, c => h('a', { href: `https://twitter.com/${c}`, target: '_blank', rel: 'nofollow noopener noreferrer', class: 'mention external' }, `@${c}@twitter.com`)],
]

function _markdownProcess(value: string) {
  const results = [] as (string | Node)[]

  let start = 0
  while (true) {
    let found: { match: RegExpMatchArray; replacer: (c: (string | Node)[]) => Node } | undefined

    for (const [re, replacer] of _markdownReplacements) {
      re.lastIndex = start

      const match = re.exec(value)
      if (match) {
        if (!found || match.index < found.match.index!)
          found = { match, replacer }
      }
    }

    if (!found)
      break

    results.push(value.slice(start, found.match.index))
    results.push(found.replacer(_markdownProcess(found.match[1])))
    start = found.match.index! + found.match[0].length
  }

  results.push(value.slice(start))
  return results.filter(Boolean)
}

function transformMarkdown(node: Node) {
  if (node.type !== TEXT_NODE)
    return node
  return _markdownProcess(node.value)
}

function transformParagraphs(node: Node): Node | Node[] {
  // For top level paragraphs, inject an empty <p> to preserve status paragraphs in our editor (except for the last one)
  if (node.parent?.type === DOCUMENT_NODE && node.name === 'p' && node.parent.children.at(-1) !== node)
    return [node, h('p')]
  return node
}

function transformMentionLink(node: Node): string | Node | (string | Node)[] | null {
  if (node.name === 'a' && node.attributes.class?.includes('mention')) {
    const href = node.attributes.href
    if (href) {
      const matchUser = href.match(UserLinkRE)
      if (matchUser) {
        const [, server, username] = matchUser
        const handle = `${username}@${server.replace(/(.+\.)(.+\..+)/, '$2')}`
        // convert to TipTap mention node
        return h('span', { 'data-type': 'mention', 'data-id': handle }, handle)
      }
    }
  }
  return node
}

function createTransformNamedMentions(mentions: mastodon.v1.StatusMention[]) {
  return (node: Node): string | Node | (string | Node)[] | null => {
    if (node.name === 'a' && node.attributes.class?.includes('mention')) {
      const href = node.attributes.href
      const mention = href && mentions.find(m => m.url === href)
      if (mention) {
        node.attributes.href = `/${currentServer.value}/@${mention.acct}`
        node.children = [h('span', { 'data-type': 'mention', 'data-id': mention.acct }, `@${mention.username}`)]
        return node
      }
    }
    return node
  }
}
