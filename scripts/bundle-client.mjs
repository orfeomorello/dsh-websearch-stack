// Bundle the browser half to lib/client.js in the loader format DSH's web
// client executes: `window.__ModuleLoader__.load({ id, factory })` with a
// CommonJS-ish module object inside, exactly like the reference plugin
// dsh-client-ui-settings-web-search ships. No bundler dependency: the card is
// one module plus two imports (react, ui primitives), so a tiny esbuild-free
// ESM-to-loader wrap suffices IF those imports resolve at runtime in the
// client's module registry — they do, because dsh.client.inject declares the
// plugin's client dependencies and the loader `require`s from the registry.
//
// Emitting raw ESM inside the wrapper would require() nothing; instead we
// transpile src/client/card.ts to CommonJS-ish JS with tsc (module: commonjs)
// and wrap it. Top-level `import` becomes `require`, which the factory's
// `require` argument resolves against the client module registry.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, '.tmp-client-build')
const bundle = join(root, 'lib', 'client.js')

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

// Transpile the card to CommonJS. tsc rewrites the `.ts` extension imports to
// extensionless CommonJS specifiers, and resolves node_modules bare imports
// (react, @deepseek-ai/dsh-client-ui-primitives) as plain require calls.
execFileSync(
  process.execPath,
  [
    join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    'src/client/card.ts',
    '--module', 'commonjs',
    '--moduleResolution', 'node',
    '--target', 'ES2022',
    '--jsx', 'react-jsx',
    '--esModuleInterop',
    '--skipLibCheck',
    '--declaration',
    '--outDir', '.tmp-client-build',
  ],
  { cwd: root, stdio: 'inherit' },
)

const compiled = readFileSync(join(outDir, 'card.js'), 'utf8')

// Ship the card's declarations beside the bundle's types export.
mkdirSync(join(root, 'lib', 'client'), { recursive: true })
writeFileSync(join(root, 'lib', 'client', 'card.d.ts'), readFileSync(join(outDir, 'card.d.ts'), 'utf8'))
rmSync(outDir, { recursive: true, force: true })

const PLUGIN_ID = '@deepseek-ai/dsh-websearch-stack'
const loader = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(PLUGIN_ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/client/card.ts
${compiled.trimEnd()}
//#endregion
\t\treturn module.exports;
\t}
});
`

mkdirSync(join(root, 'lib'), { recursive: true })
writeFileSync(bundle, loader)
console.log(`client bundle written: ${bundle} (${loader.length} bytes)`)
