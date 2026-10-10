// Build lib/ from src/. Committed output: lib/ is checked into git on purpose so the
// plugin installs from a GitHub URL without a build step (see README).
import { rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lib = join(root, 'lib')

await rm(lib, { recursive: true, force: true })

// Transpile with TypeScript's emitter, rewriting ".ts" import specifiers to ".js".
execFileSync(
  process.execPath,
  [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json'],
  { cwd: root, stdio: 'inherit' },
)

// Declarations keep the source ".ts" specifiers, which consumers cannot resolve.
// Rewrite them to ".js" in every .d.ts under lib/.
const { readFile, writeFile, readdir } = await import('node:fs/promises')
async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (entry.name.endsWith('.d.ts')) yield path
  }
}
for await (const file of walk(lib)) {
  const text = await readFile(file, 'utf8')
  const fixed = text.replace(/(from\s+['"])(\.{1,2}\/[^'"]+?)\.ts(['"])/g, '$1$2.js$3')
  if (fixed !== text) await writeFile(file, fixed)
}
