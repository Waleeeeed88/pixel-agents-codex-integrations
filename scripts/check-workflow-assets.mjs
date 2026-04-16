import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function readRequired(relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    fail(`Missing required workflow asset: ${relativePath}`);
    return '';
  }
  return fs.readFileSync(filePath, 'utf-8');
}

const workflowDoc = readRequired('docs/default-workflow.md');
const readme = readRequired('README.md');
const packageJsonRaw = readRequired('package.json');
const workflowBootstrap = readRequired('src/workflowBootstrap.ts');

if (!workflowDoc.includes('Graphify') || !workflowDoc.includes('Serena')) {
  fail('docs/default-workflow.md must describe the Graphify and Serena workflow.');
}

if (!readme.includes('Graphify') || !readme.includes('Serena')) {
  fail('README.md must mention the default Graphify and Serena workflow.');
}

if (!workflowBootstrap.includes('prepareWorkspaceWorkflow')) {
  fail('src/workflowBootstrap.ts must export prepareWorkspaceWorkflow.');
}

const packageJson = JSON.parse(packageJsonRaw);
if (
  !packageJson.scripts ||
  packageJson.scripts['workflow:check'] !== 'node scripts/check-workflow-assets.mjs'
) {
  fail('package.json must expose the workflow:check script.');
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('Workflow assets check passed.');
