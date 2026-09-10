type ApiValue = Record<string, unknown> | unknown[]

const noop = () => {}

const NOW = new Date().toISOString()

const EMPTY_STATE =
  typeof window !== 'undefined' && window.location.search.includes('empty')

const idleProcess = {
  engineType: 'xray',
  running: false,
  ready: false,
  systemProxyEnabled: false,
  tunEnabled: false,
  connectionMode: null,
  pid: null,
  startedAt: null,
  stoppedAt: null,
  localHost: '127.0.0.1',
  localPort: 2080,
  lastExitCode: null,
  lastSignal: null,
  lastError: null,
  logTail: '',
}

function resultFor(path: string): ApiValue {
  const exact: Record<string, ApiValue> = {
    'engine.getInfo': {
      engineType: 'xray',
      installed: true,
      healthy: true,
      path: 'development-preview',
      version: 'preview',
      architecture: 'x64',
      error: null,
    },
    'engine.getProcessStatus': idleProcess,
    'engine.getTraffic': { up: 0, down: 0, connections: 0 },
    'network.getCurrentIp': {
      success: true,
      checkedAt: new Date().toISOString(),
      ip: null,
      durationMs: null,
      service: null,
      error: null,
    },
    // A sample subscription and node so the connection flow, the server list
    // and the progress panel can be previewed without a real backend.
    // Append ?empty to the dev URL to preview the first-run state instead.
    'subscriptions.list': EMPTY_STATE ? [] : [
      { id: 'demo', name: 'Demo subscription', host: 'example.com', createdAt: NOW, updatedAt: NOW },
    ],
    'subscriptions.loadNodes': {
      success: true,
      checkedAt: NOW,
      nodes: [
        { id: 'demo::a', subscriptionId: 'demo', subscriptionName: 'Demo subscription', nodeId: 'a',
          name: 'Frankfurt REALITY', protocol: 'vless', security: 'reality', host: 'de.example.com',
          port: 443, transport: 'tcp', tls: true, valid: true },
        { id: 'demo::b', subscriptionId: 'demo', subscriptionName: 'Demo subscription', nodeId: 'b',
          name: 'Amsterdam WS', protocol: 'vless', security: 'tls', host: 'nl.example.com',
          port: 443, transport: 'ws', tls: true, valid: true },
      ],
      error: null,
    },
    'servers.testLatency': {
      success: true,
      results: [
        { id: 'demo::a', reachable: true, latencyMs: 84, error: null },
        { id: 'demo::b', reachable: true, latencyMs: 132, error: null },
      ],
      error: null,
    },
    'servers.getHiddenNodes': [],
    'killswitch.get': { enabled: false, active: false, available: false },
    'updater.getSettings': {
      enabled: true,
      currentVersion: 'preview',
      state: { phase: 'idle', availableVersion: null, percent: 0, error: null, retryAfterConnection: false, lastCheckedAt: null },
    },
    'history.get': { success: true, entries: [] },
    'startup.getLoginItem': { enabled: false, error: null },
    'startup.getCloseToTray': { enabled: true, error: null },
    'doh.getSettings': {
      standaloneDoHServer: 'off',
      customDnsPrimary: '',
      customDnsSecondary: '',
      preferredDnsServer: 'cloudflare-smart',
      preferredDnsPrimary: '',
      preferredDnsSecondary: '',
      proxyDoHEnabled: false,
      standaloneActive: false,
      activeConfig: null,
      error: null,
    },
    'doh.listProfiles': { success: true, profiles: [] },
    'doh.saveProfiles': { success: true, profiles: [], error: null },
    'system.getPrivilegeStatus': {
      isWindows: true,
      isElevated: false,
      canElevate: true,
      error: null,
    },
    'apps.list': [],
    'tools.getCfAutoScan': {
      settings: { enabled: false, intervalHours: 24 },
      cache: null,
    },
    'tools.getConverterBackends': { backends: [], targets: [] },
    'tools.getUpstreamProxy': {
      success: true,
      settings: { enabled: false, type: 'socks5', host: '127.0.0.1', port: 1080 },
    },
    'tools.getUTlsSettings': {
      success: true,
      settings: { globalFingerprint: 'auto', echEnabled: false, fragmentEnabled: false },
    },
  }
  return exact[path] ?? { success: true, error: null }
}

function apiProxy(path = ''): unknown {
  return new Proxy(noop, {
    get(_target, property) {
      if (property === 'then') return undefined
      const key = path ? `${path}.${String(property)}` : String(property)
      if (key === 'appName') return 'Manfaz VPN'
      if (key === 'platform') return 'win32'
      return apiProxy(key)
    },
    apply() {
      if (path.split('.').pop()?.startsWith('on')) return noop
      return Promise.resolve(resultFor(path))
    },
  })
}

export function installDevelopmentElectronMock() {
  if (!window.hamidsDeutsch) {
    window.hamidsDeutsch = apiProxy() as Window['hamidsDeutsch']
  }
}
