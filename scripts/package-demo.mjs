import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
let html = readFileSync(resolve(dist, 'index.html'), 'utf8')
html = html.replace(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g, (_, path) => {
  const script = readFileSync(resolve(dist, path), 'utf8').replace(/<\/script/gi, '<\\/script')
  return `<script type="module">${script}</script>`
})
html = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, path) => {
  const css = readFileSync(resolve(dist, path), 'utf8').replace(/<\/style/gi, '<\\/style')
  return `<style>${css}</style>`
})
const output = resolve(root, '..', '一餐-交互演示.html')
writeFileSync(output, html, 'utf8')
console.log(`Created ${output} (${Buffer.byteLength(html)} bytes)`)
