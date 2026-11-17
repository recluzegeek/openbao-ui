import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, URL } from 'node:url';

const execFileAsync = promisify(execFile);

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
    throw new Error(`Cannot read the audit log from container ${container}.`);
  }

  return {
    name: 'dev-audit-log',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/audit', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const filter = (url.searchParams.get('path') ?? '').trim();
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
            .slice(-10)
            .reverse();
          res.end(JSON.stringify({ available: true, entries }));
        } catch (error) {
          res.statusCode = 503;
          res.end(JSON.stringify({
            available: false,
            entries: [],
            error: error instanceof Error ? error.message : 'Audit log unavailable',
          }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devAuditLog()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // Dev-only proxy: keeps OpenBao requests same-origin so no CORS config is needed.
    proxy: {
      '/v1': {
        target: process.env.VITE_BAO_TARGET || 'http://127.0.0.1:8200',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
