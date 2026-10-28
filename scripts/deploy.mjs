// Builds, then deploys dist/ to Cloudflare Pages with Wrangler.
// Needs `npx wrangler login` once. Project name comes from CF_PAGES_PROJECT
// in .env (default: planning-poker).
import { spawnSync } from 'node:child_process';
import { build } from './build.mjs';

const { env, dist } = build();
const project = env.CF_PAGES_PROJECT || 'planning-poker';
const args = ['wrangler', 'pages', 'deploy', dist, '--project-name', project, '--branch', 'main', '--commit-dirty=true'];
console.log('\nDeploying to Cloudflare Pages project "' + project + '"…');
const r = spawnSync('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(r.status ?? 1);
