#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const root = process.cwd()
const styleDir = path.join(root, 'src', 'styles')
const distAssets = path.join(root, 'dist', 'assets')

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

function fmt(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`
}

function table(files, title) {
  console.log(`\n${title}`)
  files
    .map((file) => ({ file, size: fs.statSync(file).size }))
    .sort((a, b) => b.size - a.size)
    .forEach(({ file, size }) => {
      const rel = path.relative(root, file)
      console.log(`${fmt(size).padStart(9)}  ${rel}`)
    })
}

const sourceCss = walk(styleDir).filter((file) => file.endsWith('.css'))
table(sourceCss, 'Source CSS')

if (fs.existsSync(distAssets)) {
  const builtCss = walk(distAssets).filter((file) => file.endsWith('.css'))
  table(builtCss, 'Built CSS')
  const total = builtCss.reduce((sum, file) => sum + fs.statSync(file).size, 0)
  const gzip = builtCss.reduce((sum, file) => sum + zlib.gzipSync(fs.readFileSync(file)).length, 0)
  console.log(`\nBuilt CSS total: ${fmt(total)} raw / ${fmt(gzip)} gzip`)
}
