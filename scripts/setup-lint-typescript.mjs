// typescript-eslint (pulled in by eslint-config-next) refuses to run against the
// TypeScript 7 compiler API, so lint tooling needs a side-by-side TypeScript 6 copy.
// The project itself keeps TypeScript 7 at node_modules/typescript.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const LINT_TS_VERSION = '6.0.3';
const LINT_TS_RANGE = '>=4.8.4 <6.1.0';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromRoot = createRequire(join(root, 'package.json'));

function installedVersion(entry) {
  try {
    return JSON.parse(readFileSync(join(root, entry, 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
}

// GNU tar on Windows misreads "C:\..." as a remote host, so dependencies are fetched via
// npm into a throwaway prefix and copied out of there instead of extracting tarballs.
function fetchPackageTree(packageSpec) {
  const stagingDir = mkdtempSync(join(tmpdir(), 'sfd-pkgtree-'));
  execFileSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['install', '--no-save', '--no-audit', '--no-fund', '--ignore-scripts', packageSpec],
    { cwd: stagingDir, stdio: 'inherit', shell: true }
  );
  const packageName = packageSpec.startsWith('@')
    ? `@${packageSpec.slice(1).split('@')[0]}`
    : packageSpec.split('@')[0];
  return join(stagingDir, 'node_modules', ...packageName.split('/'));
}

if (!existsSync(join(root, 'node_modules', 'eslint-config-next'))) {
  console.log('[lint-ts] eslint-config-next tidak terpasang, lewati.');
  process.exit(0);
}

const nestedDir = join(root, 'node_modules', 'eslint-config-next', 'node_modules');
const nestedTsDir = join(nestedDir, 'typescript');

if (
  installedVersion(join('node_modules', 'eslint-config-next', 'node_modules', 'typescript')) ===
  LINT_TS_VERSION
) {
  console.log(`[lint-ts] TypeScript ${LINT_TS_VERSION} sudah tersedia untuk lint tooling.`);
  process.exit(0);
}

console.log(`[lint-ts] Menyiapkan TypeScript ${LINT_TS_VERSION} untuk typescript-eslint...`);

try {
  const tsSource = fetchPackageTree(`typescript@${LINT_TS_VERSION}`);
  mkdirSync(nestedDir, { recursive: true });
  if (existsSync(nestedTsDir)) rmSync(nestedTsDir, { recursive: true, force: true });
  cpSync(tsSource, nestedTsDir, { recursive: true });

  // ts-api-utils resolves TypeScript from its own ancestry; without a nested copy it
  // reaches the root TypeScript 7 and crashes on the removed 6.x internal API shape.
  // Resolve to the package root rather than the entry file: require.resolve returns the
  // CJS entry (lib/index.cjs), and the package root is what needs to be mirrored.
  const tsApiUtilsEntry = requireFromRoot.resolve('ts-api-utils');
  const tsApiUtilsDir = existsSync(join(root, 'node_modules', 'ts-api-utils'))
    ? join(root, 'node_modules', 'ts-api-utils')
    : dirname(tsApiUtilsEntry);
  const nestedTsApiUtilsDir = join(nestedDir, 'ts-api-utils');
  if (dirname(dirname(tsApiUtilsDir)) !== nestedDir) {
    if (existsSync(nestedTsApiUtilsDir)) rmSync(nestedTsApiUtilsDir, { recursive: true, force: true });
    cpSync(fetchPackageTree('ts-api-utils@2.5.0'), nestedTsApiUtilsDir, { recursive: true });
  }

  const resolved = requireFromRoot.resolve('typescript/package.json', {
    paths: [join(root, 'node_modules', 'eslint-config-next', 'node_modules', 'typescript-eslint')],
  });
  const resolvedVersion = JSON.parse(readFileSync(resolved, 'utf8')).version;

  if (resolvedVersion !== LINT_TS_VERSION) {
    throw new Error(
      `typescript-eslint memakai TypeScript ${resolvedVersion}, diharapkan ${LINT_TS_VERSION}.`
    );
  }
  console.log(`[lint-ts] OK: typescript-eslint memakai TypeScript ${resolvedVersion}.`);
  console.log(`[lint-ts] Catatan: rentang peer ${LINT_TS_RANGE} diabaikan hanya untuk pohon eslint-config-next.`);
} finally {
  rmSync(join(nestedDir, '.sfd-staging'), { recursive: true, force: true });
}
