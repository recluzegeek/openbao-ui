import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { execFile } from 'node:child_process';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { promisify } from 'node:util';
import { fileURLToPath, URL } from 'node:url';

const execFileAsync = promisify(execFile);

/** Retry transient DNS failures (EAI_AGAIN) so the dev proxy survives a flaky resolver. */
function resilientLookup(hostname: string, options: unknown, callback: (...args: any[]) => void): void {
  let attempt = 0;
  const tryLookup = () => {
    dns.lookup(hostname, options as dns.LookupOptions, (error, address, family) => {
      if (error && (error as NodeJS.ErrnoException).code === 'EAI_AGAIN' && attempt < 4) {
        attempt += 1;
        setTimeout(tryLookup, 150 * attempt);
        return;
      }
      callback(error, address, family);
    });
  };
  tryLookup();
}

const baoTarget = process.env.VITE_BAO_TARGET || 'http://127.0.0.1:8200';
const lookup = resilientLookup as http.AgentOptions['lookup'];
const baoAgent = baoTarget.startsWith('https://')
  ? new https.Agent({ lookup })
  : new http.Agent({ lookup });

interface AuditRow {
  type?: string;
  time?: string;
  request?: { path?: string; operation?: string };
  auth?: {
    display_name?: string;
    policies?: string[];
    policy_results?: { allowed?: boolean };
  };
}

/**
 * Dev-only audit bridge for the local prototype. The host audit volume is not
 * readable from the app user, so read it through the running container and
 * return only the fields the "Recent activity" panel needs. Never expose this
 * endpoint outside a local development server.
 */
function devAuditLog(): Plugin {
  const container = process.env.VITE_BAO_CONTAINER || 'openbao-poc';
  const command = 'tail -n 4000 /openbao/logs/audit.log';

  async function readLog(): Promise<string> {
    const runtimes: Array<[string, string[]]> = [
      ['podman', ['exec', container, 'sh', '-c', command]],
      ['docker', ['exec', container, 'sh', '-c', command]],
    ];
    for (const [binary, args] of runtimes) {
      try {
        const { stdout } = await execFileAsync(binary, args, { maxBuffer: 32 * 1024 * 1024 });
        return stdout;
      } catch {
        // Try the next local container runtime.
      }
    }
    throw new Error('Audit log bridge is not available.');
  }

  return {
    name: 'dev-audit-log',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/audit', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const filter = (url.searchParams.get('path') ?? '').trim();
        const requested = Number.parseInt(url.searchParams.get('limit') ?? '10', 10);
        const limit = Math.min(Number.isFinite(requested) ? Math.max(requested, 1) : 10, 2000);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');

        try {
          const stdout = await readLog();
          const entries = stdout
            .split('\n')
            .flatMap((line): Array<{
              time: string;
              operation?: string;
              path?: string;
              displayName?: string;
              policies?: string[];
              allowed?: boolean;
            }> => {
              if (!line.trim()) return [];
              let row: AuditRow;
              try {
                row = JSON.parse(line) as AuditRow;
              } catch {
                return [];
              }
              if (row.type !== 'request') return [];
              const path = String(row.request?.path ?? '');
              if (filter && !path.includes(filter)) return [];
              return [{
                time: String(row.time ?? ''),
                operation: row.request?.operation ? String(row.request.operation) : undefined,
                path,
                displayName: row.auth?.display_name ? String(row.auth.display_name) : undefined,
                policies: Array.isArray(row.auth?.policies) ? row.auth.policies.map(String) : undefined,
                allowed: typeof row.auth?.policy_results?.allowed === 'boolean' ? row.auth.policy_results.allowed : undefined,
              }];
            })
            .slice(-limit)
            .reverse();
          res.end(JSON.stringify({ available: true, entries }));
        } catch {
          // "No audit provider" is a normal state, not an HTTP failure. Keep
          // container details on the dev server only; never leak them to the UI.
          res.end(JSON.stringify({ available: false, entries: [] }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devAuditLog()],
  define: {
    // Exposed only as a host label for the sidebar chip; requests still go through the proxy.
    __BAO_TARGET__: JSON.stringify(process.env.VITE_BAO_TARGET ?? ''),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // Dev-only proxy: keeps OpenBao requests same-origin so no CORS config is needed.
    proxy: {
      '/v1': {
        target: baoTarget,
        changeOrigin: true,
        agent: baoAgent,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
