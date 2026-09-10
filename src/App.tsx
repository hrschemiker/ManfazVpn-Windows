import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { type Lang, LangCtx, TR, useT } from './i18n'
import { useDirectDomains } from './domain/use-direct-domains'
import { useEngineInfo } from './engine/use-engine-info'
import { useEngineProcess } from './engine/use-engine-process'
import { useSubscriptions } from './subscriptions/use-subscriptions'
import {
  useServerNodes,
  type SafeServerNode,
} from './servers/use-server-nodes'
import { useSelectedServer } from './servers/use-selected-server'
import { useServerLatency } from './servers/use-server-latency'
import { useServerConfigCheck } from './servers/use-server-config-check'
import { useIpVerification } from './network/use-ip-verification'
import { useWindowsPrivilege } from './system/use-windows-privilege'
import { useWindowsElevation } from './system/use-windows-elevation'
import { useRescueSettings } from './rescue/use-rescue-settings'
import { useConnectionSettings } from './settings/use-connection-settings'
import { useConnectionDiagnostics } from './diagnostics/use-connection-diagnostics'
import { BrandIcon, type BrandIconName } from './components/BrandIcon'
import './App.css'

type DnsProfile = {
  id: string
  name: string
  primary: string
  secondary: string
  custom: boolean
  server: 'cloudflare-smart' | 'cloudflare' | 'cloudflare-family' | 'google' | 'adguard' | 'shecan' | 'radar' | 'electro' | 'custom'
}

const BUILTIN_DNS_PROFILES: DnsProfile[] = [
  { id: 'cloudflare-smart', name: 'Cloudflare Smart', primary: 'Auto', secondary: '1.1.1.1', custom: false, server: 'cloudflare-smart' },
  { id: 'cloudflare', name: 'Cloudflare', primary: '1.1.1.1', secondary: '1.0.0.1', custom: false, server: 'cloudflare' },
  { id: 'cloudflare-family', name: 'Cloudflare Family', primary: '1.1.1.3', secondary: '1.0.0.3', custom: false, server: 'cloudflare-family' },
  { id: 'google', name: 'Google', primary: '8.8.8.8', secondary: '8.8.4.4', custom: false, server: 'google' },
  { id: 'adguard', name: 'AdGuard', primary: '94.140.14.14', secondary: '94.140.15.15', custom: false, server: 'adguard' },
  { id: 'shecan', name: 'شکن', primary: '178.22.122.100', secondary: '185.51.200.2', custom: false, server: 'shecan' },
  { id: 'radar', name: 'رادار گیم', primary: '10.202.10.10', secondary: '10.202.10.11', custom: false, server: 'radar' },
  { id: 'electro', name: 'الکترو', primary: '78.157.42.100', secondary: '78.157.42.101', custom: false, server: 'electro' },
]

function loadCustomDnsProfiles(): DnsProfile[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('manfaz:dns-profiles') ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item) => item && typeof item.name === 'string' && typeof item.primary === 'string')
      .slice(0, 20)
      .map((item) => ({
        id: String(item.id || `custom-${crypto.randomUUID()}`),
        name: String(item.name).trim().slice(0, 40),
        primary: String(item.primary).trim(),
        secondary: String(item.secondary ?? '').trim(),
        custom: true,
        server: 'custom' as const,
      }))
  } catch {
    return []
  }
}

type AppUpdateState = {
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'
  availableVersion: string | null
  percent: number
  error: string | null
  retryAfterConnection: boolean
  lastCheckedAt: string | null
}

const EMPTY_UPDATE_STATE: AppUpdateState = {
  phase: 'idle',
  availableVersion: null,
  percent: 0,
  error: null,
  retryAfterConnection: false,
  lastCheckedAt: null,
}

function normalizeUpdateState(value: unknown): AppUpdateState {
  if (!value || typeof value !== 'object') return EMPTY_UPDATE_STATE
  const state = value as Partial<AppUpdateState>
  const phases: AppUpdateState['phase'][] = ['idle', 'checking', 'available', 'downloading', 'ready', 'error']
  return {
    phase: phases.includes(state.phase as AppUpdateState['phase']) ? state.phase as AppUpdateState['phase'] : 'idle',
    availableVersion: typeof state.availableVersion === 'string' ? state.availableVersion : null,
    percent: typeof state.percent === 'number' && Number.isFinite(state.percent)
      ? Math.max(0, Math.min(100, state.percent))
      : 0,
    error: typeof state.error === 'string' ? state.error : null,
    retryAfterConnection: state.retryAfterConnection === true,
    lastCheckedAt: typeof state.lastCheckedAt === 'string' ? state.lastCheckedAt : null,
  }
}

// Formatting helpers below are plain functions, so they read the language from
// the document instead of context. App keeps <html lang> in sync.
function activeLocale(): string {
  if (typeof document === 'undefined') return 'en-US'
  return document.documentElement.lang === 'fa' ? 'fa-IR' : 'en-US'
}

// ── Theme ────────────────────────────────────────────────────────────────────

type Theme = 'dark' | 'light'

const ThemeCtx = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({
  theme: 'dark',
  setTheme: () => {},
})

// ── ConfirmDialog ─────────────────────────────────────────────────────────────

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useT()
  const confirmRef = useRef<HTMLButtonElement>(null)
  const okLabel = confirmLabel ?? t('btn.confirm')
  const noLabel = cancelLabel ?? t('btn.cancel')

  useEffect(() => {
    confirmRef.current?.focus()
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onCancel])

  return (
    <div className="confirm-overlay" onClick={onCancel} role="presentation">
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="confirm-title" id="confirm-dialog-title">{title}</p>
        <p className="confirm-message" id="confirm-dialog-message">{message}</p>
        <div className="confirm-actions">
          <button className="confirm-cancel-btn" type="button" onClick={onCancel}>{noLabel}</button>
          <button ref={confirmRef} className="confirm-ok-btn" type="button" onClick={onConfirm}>{okLabel}</button>
        </div>
      </div>
    </div>
  )
}

// ── InfoButton — hides description by default, shown on click ────────────────

function InfoButton({ fa, en }: { fa: string; en: string }) {
  const { lang } = useContext(LangCtx)
  const [open, setOpen] = useState(false)
  const text = lang === 'fa' ? fa : en
  return (
    <span className="info-btn-wrap">
      <button
        className="info-btn"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={lang === 'fa' ? 'توضیحات' : 'Info'}
      >
        <BrandIcon name="info" size={16} />
      </button>
      {open && (
        <>
          <span className="info-panel-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <span className="info-panel" role="note">
            <span>{text}</span>
            <button type="button" className="info-panel-close" onClick={() => setOpen(false)} aria-label={lang === 'fa' ? 'بستن' : 'Close'}>
              <BrandIcon name="close" size={16} />
            </button>
          </span>
        </>
      )}
    </span>
  )
}

// ── Page / navigation types ───────────────────────────────────────────────────

type PageId =
  | 'home'
  | 'servers'
  | 'subscriptions'
  | 'direct-sites'
  | 'rescue'
  | 'activity'
  | 'settings'
  | 'tools'

type NavigationItem = {
  id: PageId
  label: string
  icon: BrandIconName
}

type PublicServer = {
  id: string
  nodeId: string
  subscriptionId: string
  subscriptionName: string
  name: string
  protocol: string
  host: string | null
  port: number | null
  transport: string | null
  tls: boolean
}

type LatencyItem = {
  id: string
  reachable: boolean
  latencyMs: number | null
  error: string | null
}


function App() {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem('hd-theme') as Theme) || 'dark',
  )
  const [lang, setLangState] = useState<Lang>(
    () => {
      const saved = localStorage.getItem('hd-lang') as Lang | null
      return (saved === 'fa' || saved === 'en') ? saved : 'fa'
    },
  )

  function setTheme(t: Theme) {
    setThemeState(t)
    localStorage.setItem('hd-theme', t)
  }

  function setLang(l: Lang) {
    setLangState(l)
    localStorage.setItem('hd-lang', l)
  }

  // Mirror language and theme onto <html>: the root element paints the page
  // background, the native scrollbars and the form controls, and it is outside
  // the shell div that carries dir/data-theme for the app's own styles.
  useEffect(() => {
    document.documentElement.lang = lang === 'fa' ? 'fa' : 'en'
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr'
  }, [lang])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const t = (key: string, fallback?: string): string =>
    TR[lang]?.[key] ?? fallback ?? TR['en']?.[key] ?? TR['fa'][key] ?? key

  const navigationItems: NavigationItem[] = [
    { id: 'home', label: t('nav.home'), icon: 'home' },
    { id: 'servers', label: t('nav.servers'), icon: 'servers' },
    { id: 'direct-sites', label: t('nav.directSites'), icon: 'route' },
    { id: 'activity', label: t('nav.activity'), icon: 'chart' },
    { id: 'settings', label: t('nav.settings'), icon: 'settings' },
  ]

  const pageTitles: Record<PageId, string> = {
    home: t('page.home'),
    servers: t('page.servers'),
    subscriptions: t('page.subscriptions'),
    'direct-sites': t('page.directSites'),
    rescue: t('page.rescue'),
    activity: t('page.activity'),
    settings: t('page.settings'),
    tools: t('page.tools'),
  }

  const [activePage, setActivePage] = useState<PageId>('home')
  const [connectionActionError, setConnectionActionError] =
    useState<string | null>(null)

  const [automaticConnectionRunning, setAutomaticConnectionRunning] =
    useState(false)

  const [connectionWatchdogMessage, setConnectionWatchdogMessage] =
    useState<string | null>(null)

  const [tunBaselineIp, setTunBaselineIp] =
    useState<string | null>(null)

  const [tunCurrentIp, setTunCurrentIp] =
    useState<string | null>(null)

  const [tunVerified, setTunVerified] =
    useState(false)

  const connectionWatchdogBusyRef = useRef(false)
  const automaticConnectionBusyRef = useRef(false)
  // Consecutive failed health probes; reset by any successful check.
  const healthFailuresRef = useRef(0)


  const [pendingConfirmation, setPendingConfirmation] = useState<{
    title: string
    message: string
  } | null>(null)
  const pendingConfirmationResolver = useRef<((accepted: boolean) => void) | null>(null)

  function requestConfirmation(title: string, message: string): Promise<boolean> {
    pendingConfirmationResolver.current?.(false)
    setPendingConfirmation({ title, message })
    return new Promise((resolve) => {
      pendingConfirmationResolver.current = resolve
    })
  }

  function resolvePendingConfirmation(accepted: boolean) {
    pendingConfirmationResolver.current?.(accepted)
    pendingConfirmationResolver.current = null
    setPendingConfirmation(null)
  }

  // Engine update notification
  const [engineUpdateAvailable, setEngineUpdateAvailable] = useState(false)

  // Speed test
  const [speedTestResult, setSpeedTestResult] = useState<{ mbps: number | null; running: boolean; error: string | null } | null>(null)

  // Subscription server connection progress (shown inline in servers list)
  const [subConnectingNodeId, setSubConnectingNodeId] = useState<string | null>(null)
  const [subConnectingStep, setSubConnectingStep] = useState<string | null>(null)
  // Live progress for the whole connection attempt. `engineProcess.busy` only
  // covers the start/stop calls, so it went quiet during the config check and
  // the IP probe and the screen looked frozen for ten seconds at a time.
  const [connectProgress, setConnectProgress] = useState<{
    step: number
    total: number
    label: string | null
    serverName: string | null
    attempt: number
  } | null>(null)

  // WARP connection state
  // Home-screen connect/stop tracking for BPB (separate process) and Zeus.

  // Bandwidth monitor
  const [_traffic, setTraffic] = useState<{ up: number; down: number } | null>(null)
  const trafficIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [trafficSpeed, setTrafficSpeed] = useState<{ upSpeed: number; downSpeed: number } | null>(null)

  // QR code modal
  const [qrUri, setQrUri] = useState<string | null>(null)

  // Last connection for one-tap reconnect
  const [lastConnectionType, setLastConnectionType] = useState<'subscription' | null>(null)
  const [showReconnectBar, setShowReconnectBar] = useState(false)

  // Ctrl+Enter keyboard shortcut toggle (UX #9)
  const [ctrlEnterEnabled, setCtrlEnterEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem('hamidsdeutsch:ctrl-enter') !== 'false' } catch { return true }
  })
  const [closeToTray, setCloseToTray] = useState(true)
  const [killSwitch, setKillSwitch] = useState(false)
  const [killSwitchActive, setKillSwitchActive] = useState(false)
  const [killSwitchAvailable, setKillSwitchAvailable] = useState(false)
  const [killSwitchError, setKillSwitchError] = useState<string | null>(null)
  const [killSwitchReleasing, setKillSwitchReleasing] = useState(false)
  useEffect(() => {
    void window.hamidsDeutsch.startup.getCloseToTray().then((r) => { setCloseToTray(r.enabled) }).catch(() => {})
  }, [])

  type DnsServer = 'off' | 'cloudflare-smart' | 'cloudflare' | 'cloudflare-family' | 'google' | 'adguard' | 'shecan' | 'radar' | 'electro' | 'custom'
  const [standaloneDoH, setStandaloneDoH] = useState<DnsServer>('off')
  const [standaloneDoHLoading, setStandaloneDoHLoading] = useState(false)
  const [customDnsPrimary, setCustomDnsPrimary] = useState('')
  const [customDnsSecondary, setCustomDnsSecondary] = useState('')
  const [preferredDnsServer, setPreferredDnsServer] = useState<DnsServer>('cloudflare-smart')
  const [preferredDnsPrimary, setPreferredDnsPrimary] = useState('')
  const [preferredDnsSecondary, setPreferredDnsSecondary] = useState('')
  const [dnsApplyError, setDnsApplyError] = useState<string | null>(null)
  const [proxyDoH, setProxyDoH] = useState(false)

  // Advanced TLS lives in its own store. Mirror it here so the guided setup can
  // both report and change it without reaching into that component.
  const [utlsSettings, setUtlsSettings] = useState<UTlsSettings>({
    globalFingerprint: 'auto',
    echEnabled: false,
    fragmentEnabled: false,
  })

  const utlsHardened =
    utlsSettings.globalFingerprint !== 'auto' &&
    utlsSettings.echEnabled &&
    utlsSettings.fragmentEnabled === true

  useEffect(() => {
    void window.hamidsDeutsch.tools.getUTlsSettings()
      .then((r) => { if (r.success) setUtlsSettings(r.settings) })
      .catch(() => {})
  }, [])

  // Chrome is the safest fingerprint to blend into: it is the majority of real
  // TLS traffic. ECH hides the destination name, fragmentation splits the
  // handshake so a filter cannot match it in one pass.
  async function hardenTlsSettings(): Promise<boolean> {
    const next: UTlsSettings = {
      globalFingerprint: 'chrome',
      echEnabled: true,
      fragmentEnabled: true,
    }
    const result = await window.hamidsDeutsch.tools
      .setUTlsSettings(next)
      .catch(() => ({ success: false }))
    if (result.success) setUtlsSettings(next)
    return result.success === true
  }
  const [smartCloudflareIp, setSmartCloudflareIp] = useState('1.1.1.1')
  const [customDnsProfiles, setCustomDnsProfiles] = useState<DnsProfile[]>(loadCustomDnsProfiles)
  const [selectedDnsProfileId, setSelectedDnsProfileId] = useState(() => {
    const custom = loadCustomDnsProfiles()
    return custom[0]?.id ?? 'cloudflare'
  })
  const allDnsProfiles = useMemo(
    () => [...customDnsProfiles, ...BUILTIN_DNS_PROFILES.map((profile) =>
      profile.id === 'cloudflare-smart' ? { ...profile, primary: smartCloudflareIp } : profile,
    )],
    [customDnsProfiles, smartCloudflareIp],
  )
  const activeDnsProfile = useMemo(() => {
    if (standaloneDoH === 'off') return null
    if (standaloneDoH === 'custom') {
      return customDnsProfiles.find(
        (profile) => profile.primary === customDnsPrimary && profile.secondary === customDnsSecondary,
      ) ?? {
        id: 'active-custom',
        name: 'DNS دستی',
        primary: customDnsPrimary,
        secondary: customDnsSecondary,
        custom: true,
        server: 'custom' as const,
      }
    }
    const builtIn = BUILTIN_DNS_PROFILES.find((profile) => profile.server === standaloneDoH) ?? null
    return builtIn?.id === 'cloudflare-smart' ? { ...builtIn, primary: smartCloudflareIp } : builtIn
  }, [customDnsPrimary, customDnsProfiles, customDnsSecondary, standaloneDoH, smartCloudflareIp])

  function saveDnsProfiles(next: DnsProfile[]) {
    setCustomDnsProfiles(next)
    try { localStorage.setItem('manfaz:dns-profiles', JSON.stringify(next)) } catch {}
    void window.hamidsDeutsch.doh.saveProfiles(next.map(({ id, name, primary, secondary }) => ({ id, name, primary, secondary })))
    if (!next.some((profile) => profile.id === selectedDnsProfileId)) {
      setSelectedDnsProfileId(next[0]?.id ?? 'cloudflare')
    }
  }

  async function applyDnsProfile(profile: DnsProfile) {
    setStandaloneDoHLoading(true)
    setDnsApplyError(null)
    try {
      const result = await window.hamidsDeutsch.doh.setStandalone(
        profile.custom
          ? { server: 'custom', primary: profile.primary, secondary: profile.secondary }
          : profile.server,
      )
      if (!result.success) {
        setDnsApplyError(result.error)
        return false
      }
      setStandaloneDoH(profile.server)
      setCustomDnsPrimary(result.customDnsPrimary ?? profile.primary)
      setCustomDnsSecondary(result.customDnsSecondary ?? profile.secondary)
      setSelectedDnsProfileId(profile.id)
      return true
    } finally {
      setStandaloneDoHLoading(false)
    }
  }

  async function restoreSystemDns() {
    setStandaloneDoHLoading(true)
    setDnsApplyError(null)
    try {
      const result = await window.hamidsDeutsch.doh.setStandalone('off')
      if (!result.success) {
        setDnsApplyError(result.error)
        return false
      }
      setStandaloneDoH('off')
      return true
    } finally {
      setStandaloneDoHLoading(false)
    }
  }
  useEffect(() => {
    void window.hamidsDeutsch.doh.listProfiles().then((result) => {
      const diskProfiles = result.profiles.map((profile) => ({ ...profile, custom: true, server: 'custom' as const }))
      const localProfiles = loadCustomDnsProfiles()
      const merged: DnsProfile[] = [...diskProfiles]
      for (const profile of localProfiles) {
        if (!merged.some((item) => item.primary === profile.primary && item.secondary === profile.secondary)) merged.push(profile)
      }
      if (merged.length) {
        setCustomDnsProfiles(merged)
        try { localStorage.setItem('manfaz:dns-profiles', JSON.stringify(merged)) } catch {}
        void window.hamidsDeutsch.doh.saveProfiles(merged.map(({ id, name, primary, secondary }) => ({ id, name, primary, secondary })))
      }
    }).catch(() => {})
    void window.hamidsDeutsch.doh.getSettings().then((r) => {
      setStandaloneDoH(r.standaloneDoHServer)
      setCustomDnsPrimary(r.customDnsPrimary)
      setCustomDnsSecondary(r.customDnsSecondary)
      setPreferredDnsServer(r.preferredDnsServer ?? 'cloudflare-smart')
      setPreferredDnsPrimary(r.preferredDnsPrimary ?? '')
      setPreferredDnsSecondary(r.preferredDnsSecondary ?? '')
      setProxyDoH(r.proxyDoHEnabled)
      setSmartCloudflareIp(r.smartCloudflare?.primary ?? '1.1.1.1')
      if (r.standaloneDoHServer !== 'off' && r.standaloneDoHServer !== 'custom') {
        setSelectedDnsProfileId(r.standaloneDoHServer)
      }
    }).catch(() => {})
  }, [])

  // For smart hero-button priority: know if BPB/codespace are configured

  const directDomains = useDirectDomains()
  const engine = useEngineInfo()
  const refreshEngineInfo = engine.refresh
  const engineProcess = useEngineProcess()
  const subscriptions = useSubscriptions()

  const serverNodes = useServerNodes(
    subscriptions.subscriptions.map(
      (subscription) => ({
        id: subscription.id,
        name: subscription.name,
      }),
    ),
    subscriptions.loading,
  )

  const selectedServer = useSelectedServer()
  const latency = useServerLatency(serverNodes.nodes)
  const configCheck = useServerConfigCheck()
  const ipVerification = useIpVerification()
  const windowsPrivilege = useWindowsPrivilege()
  const windowsElevation = useWindowsElevation()
  const rescueSettings = useRescueSettings()
  const connectionSettings = useConnectionSettings()
  const diagnostics = useConnectionDiagnostics()

  useEffect(() => {
    void window.hamidsDeutsch.engine
      .setPreference(connectionSettings.settings.engine)
      .then(() => refreshEngineInfo())
  }, [connectionSettings.settings.engine, refreshEngineInfo])

  const [hiddenNodeIds, setHiddenNodeIds] = useState<string[]>([])

  useEffect(() => {
    window.hamidsDeutsch.servers.getHiddenNodes().then(setHiddenNodeIds).catch(() => {})
  }, [])

  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true)
  const [updateState, setUpdateState] = useState<AppUpdateState>(EMPTY_UPDATE_STATE)
  // Read from the running app, never a hand-maintained string: a stale version
  // in the header is worse than none at all when a user reports a bug.
  const [appVersion, setAppVersion] = useState<string | null>(null)

  useEffect(() => {
    if (!window.hamidsDeutsch.updater) return
    void window.hamidsDeutsch.updater.getSettings().then((result) => {
      setAutoUpdateEnabled(result?.enabled !== false)
      setUpdateState(normalizeUpdateState(result?.state))
      if (typeof result?.currentVersion === 'string') setAppVersion(result.currentVersion)
    }).catch(() => {})
    return window.hamidsDeutsch.updater.onState((state) => setUpdateState(normalizeUpdateState(state)))
  }, [])

  const connectionVerified =
    engineProcess.status.connectionMode === 'tun'
      ? tunVerified &&
        engineProcess.status.tunEnabled
      : ipVerification.connected &&
        engineProcess.status.systemProxyEnabled

  // ── Toast on disconnect ───────────────────────────────────────────────────
  const appHeroConnected = connectionVerified
  const [toastMessage, setToastMessage] = useState<{ text: string; tone: 'info' | 'error' } | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevHeroConnectedRef = useRef(false)
  const hasConnectedRef = useRef(false)
  const connectionStartRef = useRef<{ at: string; mode: string; serverName: string | null; protocol: string | null; latencyMs: number | null } | null>(null)
  const intentionalDisconnectRef = useRef(false)

  // Tone matters: a failure shown with a green success tick reads as "done".
  function showToast(message: string, durationMs = 3200, tone: 'info' | 'error' = 'info') {
    setToastMessage({ text: message, tone })
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToastMessage(null), durationMs)
  }

  useEffect(() => {
    if (appHeroConnected) {
      hasConnectedRef.current = true
      if (!prevHeroConnectedRef.current) {
        setLastConnectionType('subscription')
        setShowReconnectBar(false)
        connectionStartRef.current = {
          at: new Date().toISOString(),
          mode: 'subscription',
          serverName: selectedServer.selectedServer?.name ?? null,
          protocol: selectedServer.selectedServer?.protocol ?? null,
          latencyMs: null,
        }
        // Auto speed test: run after connect
        setSpeedTestResult({ mbps: null, running: true, error: null })
        setTimeout(() => {
          void window.hamidsDeutsch.speedtest.run().then((r) => {
            setSpeedTestResult({ mbps: r.mbps, running: false, error: r.error })
          }).catch(() => {
            setSpeedTestResult({ mbps: null, running: false, error: t('speedtest.failed') })
          })
        }, 2000)
      }
      prevHeroConnectedRef.current = true
    } else if (prevHeroConnectedRef.current && hasConnectedRef.current) {
      prevHeroConnectedRef.current = false
      const startEntry = connectionStartRef.current
      connectionStartRef.current = null
      setSpeedTestResult(null)
      if (!intentionalDisconnectRef.current) setShowReconnectBar(true)
      intentionalDisconnectRef.current = false
      showToast(t('toast.disconnected'))
      if (startEntry) {
        const now = new Date().toISOString()
        const durationMs = Date.now() - new Date(startEntry.at).getTime()
        void window.hamidsDeutsch.history.append({
          connectedAt: startEntry.at,
          disconnectedAt: now,
          durationMs,
          mode: startEntry.mode,
          serverName: startEntry.serverName,
          protocol: startEntry.protocol,
          latencyMs: startEntry.latencyMs,
        })
      }
    }
  }, [appHeroConnected]) // eslint-disable-line react-hooks/exhaustive-deps

  // Bandwidth monitor: poll Clash API while connected
  useEffect(() => {
    if (appHeroConnected) {
      trafficIntervalRef.current = setInterval(async () => {
        try {
          const r = await window.hamidsDeutsch.engine.getTraffic()
          setTrafficSpeed({ upSpeed: Math.max(0, r.up), downSpeed: Math.max(0, r.down) })
          setTraffic({ up: r.up, down: r.down })
        } catch {}
      }, 1000)
    } else {
      if (trafficIntervalRef.current) {
        clearInterval(trafficIntervalRef.current)
        trafficIntervalRef.current = null
      }
      setTraffic(null)
      setTrafficSpeed(null)
    }
    return () => {
      if (trafficIntervalRef.current) {
        clearInterval(trafficIntervalRef.current)
        trafficIntervalRef.current = null
      }
    }
  }, [appHeroConnected])

  useEffect(() => {
    void window.hamidsDeutsch.system.setVirtualLocationConnected(appHeroConnected)
  }, [appHeroConnected])

  useEffect(() => {
    void window.hamidsDeutsch.system.setDirectDomains(directDomains.domains)
  }, [directDomains.domains])

  // Check for engine update once on startup (30s delay to not block init)
  useEffect(() => {
    const timer = setTimeout(() => {
      void window.hamidsDeutsch.engine.checkForUpdate().then((r) => {
        if (r.updateAvailable) setEngineUpdateAvailable(true)
      }).catch(() => {})
    }, 30000)
    return () => clearTimeout(timer)
  }, [])

  // Lift the firewall block. Never hide the overlay on a failed release —
  // that would tell the user their internet is back while it is still cut off.
  async function releaseKillSwitch(reconnect: boolean) {
    setKillSwitchReleasing(true)
    try {
      const result = await window.hamidsDeutsch.killswitch
        .deactivate()
        .catch((error: unknown) => ({
          success: false,
          active: true,
          error: error instanceof Error ? error.message : null,
        }))
      if (!result.success) {
        setKillSwitchError(result.error ?? t('killswitch.releaseFailed'))
        return
      }
      setKillSwitchError(null)
      setKillSwitchActive(false)
      if (reconnect) void smartHeroConnect()
    } finally {
      setKillSwitchReleasing(false)
    }
  }

  // Kill switch: load setting + react to activation/deactivation events.
  useEffect(() => {
    void window.hamidsDeutsch.killswitch.get().then((s) => {
      setKillSwitch(s.enabled)
      setKillSwitchActive(s.active)
      setKillSwitchAvailable(s.available)
    }).catch(() => {})
    const offA = window.hamidsDeutsch.killswitch.onActivated(() => {
      setKillSwitchActive(true)
      setKillSwitchError(null)
    })
    const offD = window.hamidsDeutsch.killswitch.onDeactivated(() => setKillSwitchActive(false))
    // The tunnel dropped but the firewall rule could not be written. Say so
    // loudly instead of leaving the user believing they are still protected.
    const offF = window.hamidsDeutsch.killswitch.onFailed((payload) => {
      setKillSwitchActive(false)
      setKillSwitchError(payload?.error ?? t('killswitch.failed'))
      showToast(t('killswitch.failed'), 6000, 'error')
    })
    return () => { offA(); offD(); offF() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-update subscriptions once the first tunnel is up (their URLs are often
  // only reachable through the connection). On-open refresh is already handled
  // by useServerNodes.loadAll(); this covers the offline-at-launch case.
  const didPostConnectSubRefreshRef = useRef(false)
  useEffect(() => {
    if (!connectionVerified || didPostConnectSubRefreshRef.current) return
    didPostConnectSubRefreshRef.current = true
    // Wait for the tunnel/proxy to settle before refreshing (avoids
    // ERR_NETWORK_CHANGED wiping the list mid-switch).
    const timer = setTimeout(() => { void serverNodes.loadAll().catch(() => {}) }, 4000)
    return () => clearTimeout(timer)
  }, [connectionVerified, serverNodes])

  const automaticLatencyTestKey = useRef<string | null>(null)

  const fastestServer = useMemo(() => {
    // REALITY nodes get priority: if any REALITY node is reachable and within
    // 2× of the absolute fastest latency, prefer the fastest REALITY node.
    const reachableNodes = serverNodes.nodes
      .map((node) => ({ node, lat: latency.results[node.id] }))
      .filter((x) => x.lat?.reachable && x.lat.latencyMs != null)
    if (reachableNodes.length === 0) return null

    const absoluteFastest = reachableNodes.reduce((a, b) =>
      (a.lat.latencyMs ?? Infinity) <= (b.lat.latencyMs ?? Infinity) ? a : b,
    )
    const absoluteMs = absoluteFastest.lat.latencyMs ?? Infinity

    const REALITY_PROTOCOLS = new Set(['vless', 'vmess', 'trojan'])
    const realityNodes = reachableNodes.filter((x) => {
      const sec = (x.node.security ?? '').toLowerCase()
      return REALITY_PROTOCOLS.has(x.node.protocol) && sec === 'reality'
    })

    if (realityNodes.length > 0) {
      const fastestReality = realityNodes.reduce((a, b) =>
        (a.lat.latencyMs ?? Infinity) <= (b.lat.latencyMs ?? Infinity) ? a : b,
      )
      const realityMs = fastestReality.lat.latencyMs ?? Infinity
      if (realityMs <= absoluteMs * 2) {
        return fastestReality.node
      }
    }

    return absoluteFastest.node
  }, [latency.results, serverNodes.nodes])

  const selectedNode = useMemo(
    () =>
      selectedServer.selectedServer
        ? serverNodes.nodes.find(
            (node) =>
              node.id === selectedServer.selectedServer?.id,
          ) ?? null
        : null,
    [selectedServer.selectedServer, serverNodes.nodes],
  )

  const selectedServerLatency = selectedServer.selectedServer
    ? latency.results[selectedServer.selectedServer.id] ?? null
    : null

  useEffect(() => {
    if (
      serverNodes.loading ||
      serverNodes.nodes.length === 0 ||
      latency.testing
    ) {
      return
    }

    const testKey = [
      serverNodes.checkedAt ?? 'unknown',
      serverNodes.nodes.length,
      subscriptions.subscriptions.length,
    ].join('|')

    if (automaticLatencyTestKey.current === testKey) {
      return
    }

    automaticLatencyTestKey.current = testKey
    void latency.testAll()
  }, [
    latency,
    serverNodes.checkedAt,
    serverNodes.loading,
    serverNodes.nodes.length,
    subscriptions.subscriptions.length,
  ])

  // Auto-select fastest server after latency test completes
  const prevLatencyTesting = useRef(false)
  useEffect(() => {
    if (prevLatencyTesting.current && !latency.testing && fastestServer && !selectedServer.selectedServer) {
      selectedServer.selectServer(toPublicServer(fastestServer))
    }
    prevLatencyTesting.current = latency.testing
  }, [latency.testing, fastestServer, selectedServer])

  // Ctrl+Enter global keyboard shortcut (UX #9)
  useEffect(() => {
    if (!ctrlEnterEnabled) return
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        e.preventDefault()
        void smartHeroConnect()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [ctrlEnterEnabled]) // eslint-disable-line react-hooks/exhaustive-deps

  // Background latency refresh: re-test every 10 minutes when not connected
  useEffect(() => {
    const REFRESH_INTERVAL_MS = 10 * 60 * 1000
    const id = setInterval(() => {
      if (!appHeroConnected && serverNodes.nodes.length > 0 && !latency.testing) {
        void latency.testAll()
      }
    }, REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [appHeroConnected, latency, serverNodes.nodes.length])

  // Poll the exit IP until it differs from the pre-tunnel baseline. TUN routes
  // are installed asynchronously by Windows, so the first probe after start
  // often still reports the direct IP even on a perfectly healthy tunnel.
  async function verifyTunExitIp(
    baselineIp: string | null,
    attempts = 8,
    delayMs = 1500,
  ): Promise<string | null> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }

      // The engine died while we were waiting — no point polling further.
      const status = await engineProcess.refreshStatus()
      if (status && !status.running) return null

      const currentIp = await window.hamidsDeutsch.network
        .getCurrentIp()
        .catch(() => null)

      if (currentIp?.success && currentIp.ip && currentIp.ip !== baselineIp) {
        return currentIp.ip
      }
    }
    return null
  }

  // Ordered so the UI can show "step N of M" without the caller counting.
  const CONNECT_STEPS = [
    'connect.step.checkConfig',
    'connect.step.startProxy',
    'connect.step.verifyIp',
    'connect.step.systemProxy',
  ] as const

  function reportStep(
    key: string,
    node: SafeServerNode,
    onStep?: (step: string) => void,
  ) {
    const label = t(key)
    onStep?.(label)
    const index = CONNECT_STEPS.indexOf(key as (typeof CONNECT_STEPS)[number])
    setConnectProgress((current) => ({
      step: index >= 0 ? index + 1 : (current?.step ?? 1),
      total: CONNECT_STEPS.length,
      label,
      serverName: node.name,
      attempt: current?.attempt ?? 1,
    }))
  }

  async function attemptServerConnection(
    node: SafeServerNode,
    onStep?: (step: string) => void,
  ) {
    if (
      !node.subscriptionId ||
      !node.nodeId
    ) {
      return {
        success: false as const,
        fatal: true as const,
        error: t('connect.error.noSubscription'),
      }
    }

    ipVerification.reset()
    setTunVerified(false)
    setTunBaselineIp(null)
    setTunCurrentIp(null)

    reportStep('connect.step.checkConfig', node, onStep)
    let requestedEngine = connectionSettings.settings.engine
    const xrayProtocols = new Set(['vless', 'vmess', 'trojan', 'ss', 'shadowsocks'])
    const needsSingBox = requestedEngine === 'xray' && !xrayProtocols.has(node.protocol.toLowerCase())
    const tunNeedsSingBox = requestedEngine === 'xray' && connectionSettings.settings.mode === 'tun'
    if (needsSingBox || tunNeedsSingBox) {
      const reason = tunNeedsSingBox
        ? t('connect.engine.tunNeedsSingBox')
        : `${t('connect.engine.protocolUnsupported')} (${node.protocol})`
      // In-app dialog, not window.confirm(): a native modal freezes the whole
      // renderer and looks nothing like the rest of the app.
      const accepted = await requestConfirmation(
        t('connect.engine.switchTitle'),
        `${reason} ${t('connect.engine.switchQuestion')}`,
      )
      if (!accepted) {
        return { success: false as const, fatal: true as const, error: `${reason} ${t('connect.error.cancelled')}` }
      }
      requestedEngine = 'sing-box'
      connectionSettings.update({ engine: 'sing-box' })
      await window.hamidsDeutsch.engine.setPreference('sing-box')
    } else {
      await window.hamidsDeutsch.engine.setPreference(requestedEngine)
    }
    const checkResult = await configCheck.checkConfig({
      subscriptionId:
        node.subscriptionId,
      nodeId:
        node.nodeId,
      resultKey:
        node.id,
      directDomains:
        directDomains.domains,
      rescueOptions:
        rescueSettings.settings,
      enginePreference: requestedEngine,
    })

    if (!checkResult.success) {
      return {
        success: false as const,
        fatal: false as const,
        error:
          checkResult.error ??
          t('connect.error.configRejected'),
      }
    }

    reportStep('connect.step.startProxy', node, onStep)
    const startResult = await engineProcess.start()

    if (!startResult.success) {
      return {
        success: false as const,
        fatal: false as const,
        error: startResult.error,
      }
    }

    reportStep('connect.step.verifyIp', node, onStep)
    let localVerification =
      await ipVerification.verify()

    if (!localVerification.success) {
      // Auto DPI bypass retry: only when we confirmed IPs are the same (not when check services are blocked)
      const ipCheckFailed = !localVerification.directIp
      if (
        !ipCheckFailed &&
        rescueSettings.settings.dpiBypassAuto &&
        node.subscriptionId
      ) {
        await engineProcess.stop()
        ipVerification.reset()

        const dpiCheckResult = await configCheck.checkConfig({
          subscriptionId: node.subscriptionId,
          nodeId: node.nodeId,
          resultKey: node.id,
          directDomains: directDomains.domains,
          rescueOptions: {
            ...rescueSettings.settings,
            enabled: true,
            recordFragment: true,
            dpiBypass: true,
          },
          enginePreference: requestedEngine,
        })

        if (dpiCheckResult.success) {
          const dpiStartResult = await engineProcess.start()
          if (dpiStartResult.success) {
            localVerification = await ipVerification.verify()
          }
        }
      }

      if (!localVerification.success) {
        await engineProcess.stop()
        ipVerification.reset()

        return {
          success: false as const,
          fatal: false as const,
          error:
            localVerification.error ??
            t('connect.error.noRealTraffic'),
        }
      }
    }

    const baselineIp =
      localVerification.directIp

    const wantsTun = requestedEngine === 'sing-box' &&
      connectionSettings.settings.mode !==
      'system-proxy'

    const requiresTun =
      connectionSettings.settings.mode ===
      'tun'

    const canUseTun =
      windowsPrivilege.status.supported &&
      windowsPrivilege.status.isAdministrator

    if (
      requiresTun &&
      !canUseTun
    ) {
      await engineProcess.stop()
      ipVerification.reset()

      return {
        success: false as const,
        fatal: true as const,
        error: t('connect.error.tunNeedsAdmin'),
      }
    }

    if (
      wantsTun &&
      canUseTun
    ) {
      reportStep('connect.step.tun', node, onStep)
      const tunCheck =
        await window.hamidsDeutsch
          .servers
          .checkTunConfig({
            subscriptionId:
              node.subscriptionId,
            nodeId:
              node.nodeId,
            directDomains:
              directDomains.domains,
            rescueOptions:
              rescueSettings.settings,
          })

      let tunError: string | null = tunCheck.success ? null : (tunCheck.error ?? null)

      if (tunCheck.success) {
        await engineProcess.stop()
        ipVerification.reset()

        const tunStart =
          await engineProcess.startTun()

        if (!tunStart.success) {
          tunError = tunStart.error ?? null
        } else {
          // Windows needs a moment to install the TUN routes and flush the old
          // ones. Probing the exit IP once, immediately, reads the pre-tunnel
          // route and tears down a TUN that was actually about to work — so
          // poll until the IP really changes.
          const verifiedIp = await verifyTunExitIp(baselineIp)

          if (verifiedIp) {
            setTunBaselineIp(
              baselineIp,
            )
            setTunCurrentIp(
              verifiedIp,
            )
            setTunVerified(true)

            selectedServer.selectServer(
              toPublicServer(node),
            )

            return {
              success: true as const,
              fatal: false as const,
              mode: 'tun' as const,
              exitIp:
                verifiedIp,
              error: null,
            }
          }

          tunError = t('connect.error.tunNoTraffic')
          await engineProcess.stop()
        }
      }

      if (
        requiresTun ||
        !connectionSettings.settings.allowFallback
      ) {
        await engineProcess.stop()
        ipVerification.reset()

        return {
          success: false as const,
          fatal: false as const,
          error: tunError
            ? `${t('connect.error.tunFailed')} ${tunError}`
            : t('connect.error.tunFailed'),
        }
      }

      reportStep('connect.step.tunFallback', node, onStep)

      const restartLocal =
        await engineProcess.start()

      if (!restartLocal.success) {
        return {
          success: false as const,
          fatal: false as const,
          error:
            restartLocal.error ??
            t('connect.error.tunFallbackFailed'),
        }
      }

      const fallbackVerification =
        await ipVerification.verify()

      if (!fallbackVerification.success) {
        await engineProcess.stop()
        ipVerification.reset()

        return {
          success: false as const,
          fatal: false as const,
          error:
            fallbackVerification.error ??
            t('connect.error.fallbackUnverified'),
        }
      }
    }

    reportStep('connect.step.systemProxy', node, onStep)
    const systemProxyResult =
      await engineProcess.enableSystemProxy()

    if (!systemProxyResult.success) {
      await engineProcess.stop()
      ipVerification.reset()

      return {
        success: false as const,
        fatal: true as const,
        error:
          systemProxyResult.error ??
          t('connect.error.systemProxyFailed'),
      }
    }

    ipVerification.reset()

    const finalVerification =
      await ipVerification.verify()

    if (!finalVerification.success) {
      await engineProcess.disableSystemProxy(false)
      ipVerification.reset()

      return {
        success: false as const,
        fatal: false as const,
        error:
          finalVerification.error ??
          t('connect.error.finalIpUnverified'),
      }
    }

    selectedServer.selectServer(
      toPublicServer(node),
    )

    return {
      success: true as const,
      fatal: false as const,
      mode:
        'system-proxy' as const,
      exitIp:
        finalVerification.proxyIp ??
        null,
      error: null,
    }
  }

  function recordAttempt(
    node: SafeServerNode,
  ) {
    diagnostics.addEvent({
      level: 'info',
      type:
        'connection-attempt',
      message:
        t('diag.attemptStarted'),
      serverName:
        node.name,
      subscriptionName:
        node.subscriptionName,
      mode: null,
      latencyMs:
        latency.results[node.id]
          ?.latencyMs ??
        null,
    })
  }

  function recordResult(
    node: SafeServerNode,
    result:
      | {
          success: true
          mode:
            | 'tun'
            | 'system-proxy'
          exitIp:
            | string
            | null
        }
      | {
          success: false
          error:
            | string
            | null
        },
  ) {
    const latencyMs =
      latency.results[node.id]
        ?.latencyMs ??
      null

    if (result.success) {
      diagnostics.beginSession({
        serverName:
          node.name,
        subscriptionName:
          node.subscriptionName,
        mode:
          result.mode,
        latencyMs,
        exitIp:
          result.exitIp,
      })

      return
    }

    diagnostics.addEvent({
      level: 'error',
      type:
        'connection-failure',
      message:
        result.error ??
        t('connect.error.notEstablished'),
      serverName:
        node.name,
      subscriptionName:
        node.subscriptionName,
      mode: null,
      latencyMs,
    })
  }

  async function prepareAndStart(
    node: SafeServerNode,
  ) {
    if (standaloneDoH !== 'off' && !(await restoreSystemDns())) return
    setConnectionActionError(null)
    setSubConnectingNodeId(node.id)
    setSubConnectingStep(t('connect.step.stopPrevious'))
    setConnectProgress({
      step: 0,
      total: 4,
      label: t('connect.step.stopPrevious'),
      serverName: node.name,
      attempt: 1,
    })
    setLastConnectionType('subscription')

    if (engineProcess.status.running) {
      await engineProcess.stop()
    }

    recordAttempt(node)

    const result =
      await attemptServerConnection(node, (step) => {
        setSubConnectingStep(step)
      })

    recordResult(
      node,
      result,
    )

    setSubConnectingNodeId(null)
    setSubConnectingStep(null)
    setConnectProgress(null)

    if (!result.success) {
      setConnectionActionError(
        result.error,
      )
    }
  }

  async function connectToFirstHealthyServer(
    excludedNodeId: string | null = null,
  ) {
    if (
      automaticConnectionRunning ||
      automaticConnectionBusyRef.current
    ) {
      return
    }

    automaticConnectionBusyRef.current = true
    setAutomaticConnectionRunning(true)
    setConnectionActionError(null)
    setConnectionWatchdogMessage(null)
    setConnectProgress({
      step: 0,
      total: 4,
      label: t('connect.step.findingServer'),
      serverName: null,
      attempt: 1,
    })
    ipVerification.reset()

    try {
      if (engineProcess.status.running) {
        await engineProcess.stop()
      }

      const validNodes =
        serverNodes.nodes.filter(
          (node) => node.valid,
        )

      const preferredNodes =
        validNodes.filter(
          (node) =>
            node.id !== excludedNodeId,
        )

      const previouslyFailedNode =
        excludedNodeId
          ? validNodes.find(
              (node) =>
                node.id === excludedNodeId,
            ) ?? null
          : null

      const candidates =
        [...preferredNodes].sort(
          (firstNode, secondNode) => {
            const first =
              latency.results[
                firstNode.id
              ]

            const second =
              latency.results[
                secondNode.id
              ]

            const firstRank =
              first?.reachable &&
              typeof first.latencyMs ===
                'number'
                ? first.latencyMs
                : Number.MAX_SAFE_INTEGER

            const secondRank =
              second?.reachable &&
              typeof second.latencyMs ===
                'number'
                ? second.latencyMs
                : Number.MAX_SAFE_INTEGER

            return (
              firstRank -
              secondRank
            )
          },
        )

      if (previouslyFailedNode) {
        candidates.push(
          previouslyFailedNode,
        )
      }

      if (candidates.length === 0) {
        setConnectionActionError(
          t('connect.error.noValidServer'),
        )
        return
      }

      // Race-dial: re-test top 3 latency-sorted candidates in parallel, connect to fastest
      let orderedCandidates = candidates
      if (candidates.length >= 2) {
        const top3 = candidates.slice(0, 3)
        try {
          const freshLatencies = await Promise.all(
            top3.map(async (node) => {
              try {
                const inputs = node.host && node.port
                  ? [{ id: node.id, host: node.host, port: node.port }]
                  : []
                if (inputs.length === 0) return { node, ms: Number.MAX_SAFE_INTEGER }
                const r = await window.hamidsDeutsch.servers.testLatency(inputs)
                const item = r.results.find((x) => x.id === node.id)
                const ms = item?.reachable ? (item.latencyMs ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
                return { node, ms }
              } catch {
                return { node, ms: Number.MAX_SAFE_INTEGER }
              }
            })
          )
          freshLatencies.sort((a, b) => a.ms - b.ms)
          orderedCandidates = [
            ...freshLatencies.map((x) => x.node),
            ...candidates.slice(3),
          ]
        } catch {
          // Keep original order on error
        }
      }

      let lastError =
        t('connect.error.allServersFailed')

      let attemptIndex = 0
      for (const node of orderedCandidates) {
        attemptIndex += 1
        const currentAttempt = attemptIndex
        recordAttempt(node)

        const result =
          await attemptServerConnection(
            node,
            (step) => {
              setConnectProgress((current) => ({
                step: current?.step ?? 1,
                total: current?.total ?? 4,
                label: step,
                serverName: node.name,
                attempt: currentAttempt,
              }))
            },
          )

        recordResult(
          node,
          result,
        )

        if (result.success) {
          return
        }

        lastError =
          result.error ?? lastError

        if (result.fatal) {
          setConnectionActionError(
            lastError,
          )
          return
        }
      }

      setConnectionActionError(
        lastError,
      )
    } finally {
      automaticConnectionBusyRef.current = false
      setAutomaticConnectionRunning(
        false,
      )
      setConnectProgress(null)
    }
  }

  // Hero-button connect: pick the fastest healthy subscription server. Without a
  // subscription there is nothing to connect to, so say so instead of failing
  // silently.
  async function smartHeroConnect() {
    if (serverNodes.nodes.some((n) => n.valid)) {
      void connectToFirstHealthyServer()
      return
    }
    setConnectionActionError(t('home.noSubscription'))
  }

  async function quickReconnect() {
    if (appHeroConnected) return
    if (lastConnectionType === 'subscription') {
      // Reconnect to the last used subscription server directly, falling back to fastest
      const node = selectedServer.selectedServer
        ? serverNodes.nodes.find((n) => n.id === selectedServer.selectedServer?.id) ?? fastestServer
        : fastestServer
      if (node) {
        void prepareAndStart(node)
      } else {
        void smartHeroConnect()
      }
    } else {
      void smartHeroConnect()
    }
    setShowReconnectBar(false)
  }

  async function recoverConnection(
    failedNodeId: string | null,
  ) {
    if (
      connectionWatchdogBusyRef.current ||
      automaticConnectionBusyRef.current
    ) {
      return
    }

    connectionWatchdogBusyRef.current = true
    setConnectionWatchdogMessage(
      t('connect.watchdog.recovering'),
    )

    diagnostics.endSession(
      'connection-lost',
    )

    try {
      const stopResult =
        engineProcess.status.systemProxyEnabled
          ? await engineProcess.disableSystemProxy(false)
          : await engineProcess.stop()

      ipVerification.reset()

      if (!stopResult.success) {
        setConnectionActionError(
          stopResult.error ??
          t('connect.error.proxyReleaseFailed'),
        )
        return
      }

      await connectToFirstHealthyServer(
        failedNodeId,
      )
    } finally {
      connectionWatchdogBusyRef.current = false
    }
  }

  async function verifyCurrentIp() {
    setConnectionActionError(null)

    const verificationResult = await ipVerification.verify()

    if (!verificationResult.success) {
      setConnectionActionError(
        verificationResult.error ?? t('connect.error.ipCheckFailed'),
      )
      return
    }

    // Only a genuinely identical address is worth reporting. When the direct
    // probe never answered there is nothing to compare against.
    if (!verificationResult.changed && verificationResult.directIp) {
      setConnectionActionError(
        t('connect.error.sameIp'),
      )
    }
  }

  async function stopLocalProxy() {
    intentionalDisconnectRef.current = true
    setConnectionActionError(null)
    setConnectionWatchdogMessage(null)

    const result =
      engineProcess.status.systemProxyEnabled
        ? await engineProcess.disableSystemProxy(false)
        : await engineProcess.stop()

    if (!result.success) {
      setConnectionActionError(result.error)
      return
    }

    diagnostics.endSession(
      'manual',
    )

    if (standaloneDoH !== 'off') {
      await restoreSystemDns()
    }

    ipVerification.reset()
    setTunVerified(false)
    setTunBaselineIp(null)
    setTunCurrentIp(null)
  }

  useEffect(() => {
    if (!connectionVerified) {
      return
    }

    let disposed = false

    // A probe that fails once means almost nothing: the address-echo services
    // are frequently unreachable for a few seconds at a time. Only a run of
    // consecutive failures justifies tearing a working tunnel down.
    const FAILURES_BEFORE_RECOVERY = 3

    async function checkHealth() {
      if (
        disposed ||
        connectionWatchdogBusyRef.current ||
        automaticConnectionBusyRef.current ||
        engineProcess.busy ||
        ipVerification.checking
      ) {
        return
      }

      connectionWatchdogBusyRef.current = true

      // `hard` marks the failures we can be certain about (the engine is gone,
      // the system proxy was switched off underneath us). Those recover at once.
      async function fail(hard: boolean) {
        healthFailuresRef.current = hard
          ? FAILURES_BEFORE_RECOVERY
          : healthFailuresRef.current + 1

        if (healthFailuresRef.current < FAILURES_BEFORE_RECOVERY) {
          connectionWatchdogBusyRef.current = false
          return
        }

        healthFailuresRef.current = 0
        connectionWatchdogBusyRef.current = false
        await recoverConnection(
          selectedServer.selectedServer?.id ?? null,
        )
      }

      try {
        const currentStatus =
          await engineProcess.refreshStatus()

        if (
          !currentStatus?.running ||
          !currentStatus.ready
        ) {
          await fail(true)
          return
        }

        if (
          currentStatus.connectionMode === 'tun'
        ) {
          const currentIp =
            await window.hamidsDeutsch
              .network
              .getCurrentIp()

          // No answer at all is a soft failure: the probe itself may be blocked.
          // An answer that matches the pre-tunnel address is a real leak.
          if (!currentIp.success || !currentIp.ip) {
            await fail(false)
            return
          }

          if (tunBaselineIp && currentIp.ip === tunBaselineIp) {
            await fail(true)
            return
          }

          setTunCurrentIp(
            currentIp.ip,
          )
          setTunVerified(true)
        } else {
          if (
            !currentStatus.systemProxyEnabled
          ) {
            await fail(true)
            return
          }

          const health =
            await ipVerification.verify()

          // `success` is already true when the tunnel carried traffic but the
          // direct probe was unreachable, so this only trips on a real problem.
          if (!health.success) {
            await fail(false)
            return
          }
        }

        healthFailuresRef.current = 0
        setConnectionWatchdogMessage(null)
      } finally {
        connectionWatchdogBusyRef.current = false
      }
    }

    const initialTimer =
      window.setTimeout(() => {
        void checkHealth()
      }, 15000)

    const intervalId =
      window.setInterval(() => {
        void checkHealth()
      }, 30000)

    return () => {
      disposed = true
      window.clearTimeout(initialTimer)
      window.clearInterval(intervalId)
    }

  // Method-level dependencies are intentionally stable; the containing hook
  // objects are recreated and would restart this watchdog every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    connectionVerified,
    engineProcess.busy,
    engineProcess.refreshStatus,
    ipVerification.checking,
    ipVerification.verify,
    selectedServer.selectedServer?.id,
    tunBaselineIp,
  ])

  return (
    <ThemeCtx.Provider value={{ theme, setTheme }}>
      <LangCtx.Provider value={{ lang, setLang }}>
    <div className="application-shell application-shell-top" data-theme={theme} dir={lang === 'fa' ? 'rtl' : 'ltr'}>
      <header className="topnav">
        <div className="brand">
          <div className="brand-mark"><img src="logo.png" alt="Manfaz VPN" className="brand-logo-img" /></div>
          <div className="brand-text">
            <strong>Manfaz</strong>
            <span>VPN</span>
          </div>
        </div>

        <nav className="navigation navigation-top" aria-label={lang === 'fa' ? 'ناوبری اصلی' : 'Main navigation'}>
          {navigationItems.map((item) => (
            <button
              className={
                activePage === item.id
                  ? 'navigation-item navigation-item-active'
                  : 'navigation-item'
              }
              key={item.id}
              type="button"
              title={item.label}
              onClick={() => setActivePage(item.id)}
            >
              <span className="navigation-icon"><BrandIcon name={item.icon} size={19} /></span>
              <span className="navigation-label">{item.label}</span>
              {item.id === 'settings' && engineUpdateAvailable && (
                <span className="nav-update-dot" title={t('nav.updateAvailable')} />
              )}
            </button>
          ))}
        </nav>

        <div className="topnav-meta">
          <span
            className={
              connectionVerified
                ? 'engine-status-dot engine-status-dot-ready'
                : 'engine-status-dot'
            }
            title={connectionVerified
              ? `${t('status.connected')} · ${ipVerification.result.proxyIp ?? 'IP'}`
              : engine.info?.healthy
                ? `${engine.info.engineType === 'xray' ? 'Xray' : 'sing-box'} ${engine.info.version}`
                : t('home.core.unavailable')}
          />
          {appVersion && (
            <span className="topnav-version" dir="ltr">
              {`${t('version.label')} ${appVersion}`}
            </span>
          )}
        </div>
      </header>

      <section className="main-area">
        <header className="topbar">
          <div>
            <p className="topbar-eyebrow">Manfaz VPN</p>
            <h1>{pageTitles[activePage]}</h1>
          </div>

          <div className="topbar-controls">
            {/* Day/Night slider toggle */}
            <button
              className={`theme-slider-toggle${theme === 'light' ? ' theme-slider-day' : ' theme-slider-night'}`}
              type="button"
              title={theme === 'dark' ? t('toggle.themeToLight') : t('toggle.themeToDark')}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label={theme === 'dark' ? t('toggle.themeToLight') : t('toggle.themeToDark')}
            >
              <span className="theme-slider-track">
                <span className="theme-slider-scene" />
                <span className="theme-slider-knob" />
              </span>
            </button>

            {/* Language toggle: FA ↔ EN */}
            <button
              className="lang-slider-toggle"
              type="button"
              title={t('toggle.lang')}
              onClick={() => setLang(lang === 'fa' ? 'en' : 'fa')}
              aria-label={t('toggle.lang')}
              data-lang={lang}
            >
              <span className="lang-slider-label lang-slider-label-left">
                {lang === 'fa' ? 'EN' : 'FA'}
              </span>
              <span className="lang-slider-track">
                <span className="lang-slider-flag" />
                <span className="lang-slider-knob" />
              </span>
              <span className="lang-slider-label lang-slider-label-right">
                {lang === 'fa' ? 'FA' : 'EN'}
              </span>
            </button>
          </div>

          <div
            className={
              connectionVerified
                ? 'connection-pill connection-pill-online'
                : 'connection-pill'
            }
          >
            <span className="connection-pill-dot" />
            <span>
              {connectionWatchdogMessage
                ? t('status.recovering')
                : automaticConnectionRunning
                  ? t('status.findingServer')
                  : engineProcess.starting
                  ? t('status.connecting')
                : engineProcess.stopping
                  ? t('status.stopping')
                  : ipVerification.checking
                    ? t('status.checkingIp')
                    : connectionVerified
                      ? engineProcess.status.connectionMode === 'tun'
                        ? t('status.tunConnected')
                        : t('status.connected')
                      : engineProcess.status.systemProxyEnabled
                        ? t('status.verifying')
                        : engineProcess.status.ready
                          ? t('status.proxyReady')
                        : engineProcess.status.running
                          ? t('status.running')
                          : t('status.disconnected')}
            </span>
          </div>
        </header>

        <main className="content">
          {activePage === 'home' && (
            <HomePage
              directDomains={directDomains.domains}
              engineInfo={engine.info}
              processStatus={engineProcess.status}
              tunBaselineIp={tunBaselineIp}
              tunCurrentIp={tunCurrentIp}
              administratorAvailable={
                windowsPrivilege.status.isAdministrator
              }
              elevationRequesting={
                windowsElevation.requesting
              }
              elevationError={
                windowsElevation.error
              }
              onRelaunchAsAdministrator={() => {
                void windowsElevation.relaunch()
              }}
              processBusy={
                engineProcess.busy ||
                automaticConnectionRunning
              }
              processError={
                connectionActionError ??
                connectionWatchdogMessage ??
                engineProcess.error
              }
              ipVerificationResult={ipVerification.result}
              ipVerificationChecking={ipVerification.checking}
              isConnected={connectionVerified}
              dnsProfiles={allDnsProfiles}
              selectedDnsProfileId={selectedDnsProfileId}
              dnsActive={standaloneDoH !== 'off'}
              activeDnsProfile={activeDnsProfile}
              dnsBusy={standaloneDoHLoading}
              dnsError={dnsApplyError}
              onDnsSelection={setSelectedDnsProfileId}
              onDnsConnect={() => {
                const profile = allDnsProfiles.find((item) => item.id === selectedDnsProfileId)
                  ?? customDnsProfiles[0]
                  ?? BUILTIN_DNS_PROFILES[0]
                void applyDnsProfile(profile)
              }}
              onDnsDisconnect={() => void restoreSystemDns()}
              selectedServer={
                selectedNode
                  ? toPublicServer(
                      selectedNode,
                    )
                  : null
              }
              selectedServerLatency={selectedServerLatency}
              fastestServer={fastestServer}
              fastestLatencyMs={latency.fastestLatencyMs}
              latencyTesting={latency.testing}
              latencyError={latency.error}
              onMainAction={() => {
                if (engineProcess.status.running) {
                  void stopLocalProxy()
                } else {
                  void smartHeroConnect()
                }
              }}
              onStartFastest={() => {
                void connectToFirstHealthyServer()
              }}
              onStartPrevious={() => {
                if (selectedNode) {
                  void prepareAndStart(selectedNode)
                }
              }}
              onStop={() => void stopLocalProxy()}
              onVerifyIp={() => void verifyCurrentIp()}
              onRetestLatency={() => void latency.testAll()}
              onOpenServers={() => setActivePage('servers')}
              onOpenDirectSites={() => setActivePage('direct-sites')}
              onOpenRescue={() => setActivePage('settings')}
              onOpenSettings={() => setActivePage('settings')}
              connectProgress={connectProgress}
              speedTest={speedTestResult}
              showReconnectBar={showReconnectBar}
              onQuickReconnect={() => void quickReconnect()}
              hasSubscription={subscriptions.subscriptions.length > 0 || serverNodes.nodes.length > 0}
              dataLoading={serverNodes.loading || subscriptions.loading}
              trafficSpeed={trafficSpeed}
              onNavigateToTools={() => setActivePage('settings')}
              onShowQr={async (compositeId: string) => {
                const parts = compositeId.split('::')
                const subscriptionId = parts[0]
                const nodeId = parts.slice(1).join('::')
                if (!subscriptionId || !nodeId) return
                const r = await window.hamidsDeutsch.servers.getNodeUri({ subscriptionId, nodeId })
                if (r.uri) setQrUri(r.uri)
              }}
              topSubServers={(() => {
                return serverNodes.nodes
                  .filter((n) => n.valid && latency.results[n.id]?.reachable)
                  .sort((a, b) => (latency.results[a.id]?.latencyMs ?? 9999) - (latency.results[b.id]?.latencyMs ?? 9999))
                  .slice(0, 5)
                  .map((n) => ({ id: n.id, name: n.name, protocol: n.protocol, latencyMs: latency.results[n.id]?.latencyMs ?? null }))
              })()}
              onConnectSubServer={(id) => {
                const node = serverNodes.nodes.find((n) => n.id === id)
                if (node) void prepareAndStart(node)
              }}
            />
          )}

          {activePage === 'servers' && (
            <>
            <SubscriptionsPage
              loading={subscriptions.loading}
              subscriptions={subscriptions.subscriptions}
              loadError={subscriptions.error}
              onAddSubscription={subscriptions.addSubscription}
              onAddManualNodeFromSub={async (uri) => {
                const result = await window.hamidsDeutsch.servers.addManualNode(uri)
                if (result.success) {
                  await subscriptions.refresh()
                }
                return result
              }}
              onRemoveSubscription={async (subscriptionId) => {
                const result = await subscriptions.removeSubscription(subscriptionId)
                if (result.success) void serverNodes.loadAll().catch(() => {})
                return result
              }}
              onInspectSubscription={subscriptions.inspectSubscription}
              onLoadServers={async (subscriptionId) => {
                const result = await serverNodes.loadFromSubscription(subscriptionId)
                if (result.success) {
                  automaticLatencyTestKey.current = null
                  return { success: true as const, error: null }
                }
                return { success: false as const, error: result.error ?? t('servers.loadFailed') }
              }}
              loadingServerSubscriptionId={serverNodes.refreshingSubscriptionId}
              subscriptionInfoMap={serverNodes.subscriptionInfoMap}
            />
            <ServersPage
              loading={serverNodes.loading}
              nodes={serverNodes.nodes}
              error={serverNodes.error}
              selectedServerId={selectedServer.selectedServer?.id ?? null}
              latencyTesting={latency.testing}
              latencyResults={latency.results}
              latencyError={latency.error}
              fastestServerId={latency.fastestServerId}
              directDomains={directDomains.domains}
              configCheckingNodeId={configCheck.checkingNodeId}
              configCheckResults={configCheck.results}
              onCheckConfig={(node) => {
                void configCheck.checkConfig({
                  subscriptionId:
                    node.subscriptionId,
                  nodeId:
                    node.nodeId,
                  resultKey:
                    node.id,
                  directDomains:
                    directDomains.domains,
                  rescueOptions:
                    rescueSettings.settings,
                  enginePreference: connectionSettings.settings.engine,
                })
              }}
              processRunning={engineProcess.status.running}
              onTestLatency={() => void latency.testAll()}
              onSelectServer={selectedServer.selectServer}
              onClearSelectedServer={selectedServer.clearSelectedServer}
              onOpenSubscriptions={() => setActivePage('servers')}
              onConnectSubNode={(node) => void prepareAndStart(node)}
              onStopConnection={() => void stopLocalProxy()}
              subConnectingNodeId={subConnectingNodeId}
              subConnectingStep={subConnectingStep}
              onAddManualNode={async (uri) => {
                const result = await window.hamidsDeutsch.servers.addManualNode(uri)
                if (result.success) {
                  await subscriptions.refresh()
                }
                return result
              }}
              onRemoveManualNode={async (nodeId) => {
                const result = await window.hamidsDeutsch.servers.removeManualNode(nodeId)
                if (result.success) {
                  await subscriptions.refresh()
                  void serverNodes.loadAll().catch(() => {})
                }
                return result
              }}
              hiddenNodeIds={hiddenNodeIds}
              onHideNode={async (compositeId) => {
                await window.hamidsDeutsch.servers.hideNode(compositeId)
                setHiddenNodeIds((prev) => [...prev, compositeId])
              }}
            />
            </>
          )}

          {activePage === 'direct-sites' && (
            <DirectSitesPage
              domains={directDomains.domains}
              onAddDomain={directDomains.addDomain}
              onAddDomains={directDomains.addDomains}
              onRemoveDomain={directDomains.removeDomain}
              onResetDomains={directDomains.resetDomains}
            />
          )}

          {activePage === 'activity' && (
            <ActivityPage
              summary={diagnostics.summary}
              sessions={diagnostics.sessions}
              events={diagnostics.events}
              onClear={diagnostics.clear}
              onCopyReport={async () => {
                await navigator.clipboard.writeText(
                  diagnostics.exportReport(),
                )
              }}
            />
          )}
          {activePage === 'settings' && (
            <>
            <SettingsPage
              settings={
                connectionSettings.settings
              }
              onUpdate={
                connectionSettings.update
              }
              onReset={
                connectionSettings.reset
              }
              directDomainCount={
                directDomains.domains.length
              }
              administratorAvailable={
                windowsPrivilege.status.isAdministrator
              }
              connected={
                connectionVerified
              }
              onOpenDirectSites={() =>
                setActivePage(
                  'direct-sites',
                )
              }
              onOpenVirtualLocationExtension={() =>
                window.hamidsDeutsch.system.openVirtualLocationExtension()
              }
              onDownloadExtensionZip={() =>
                window.hamidsDeutsch.system.downloadExtensionZip()
              }
              currentEngineVersion={
                engine.info?.version ??
                null
              }
              onCheckEngineUpdate={() =>
                window.hamidsDeutsch
                  .engine
                  .checkForUpdate()
              }
              onInstallEngineUpdate={async () => {
                const r = await window.hamidsDeutsch.engine.updateToLatest()
                if (r.updated) setEngineUpdateAvailable(false)
                return r
              }}
              ctrlEnterEnabled={ctrlEnterEnabled}
              onCtrlEnterToggle={(v) => {
                setCtrlEnterEnabled(v)
                try { localStorage.setItem('hamidsdeutsch:ctrl-enter', v ? 'true' : 'false') } catch {}
              }}
              closeToTray={closeToTray}
              onCloseToTrayToggle={async (v) => {
                setCloseToTray(v)
                await window.hamidsDeutsch.startup.setCloseToTray(v)
              }}
              killSwitch={killSwitch}
              killSwitchAvailable={killSwitchAvailable}
              onKillSwitchToggle={async (v) => {
                const previous = killSwitch
                setKillSwitch(v)
                const result = await window.hamidsDeutsch.killswitch.set(v)
                if (result.error || result.enabled !== v) {
                  setKillSwitch(previous)
                  showToast(
                    result.reason === 'needs-admin'
                      ? t('settings.killSwitch.needsAdmin')
                      : result.error ?? t('killswitch.saveFailed'),
                    4200,
                    'error',
                  )
                  return
                }
                // Re-read privilege state: it can only be gained by relaunching
                // elevated, and the switch is useless without it.
                void window.hamidsDeutsch.killswitch.get()
                  .then((state) => setKillSwitchAvailable(state.available))
                  .catch(() => {})
              }}
              autoUpdateEnabled={autoUpdateEnabled}
              updateState={updateState}
              onAutoUpdateToggle={async (v) => {
                const result = await window.hamidsDeutsch.updater.setEnabled(v)
                if (result.success) setAutoUpdateEnabled(result.enabled)
              }}
              onCheckAppUpdate={() => window.hamidsDeutsch.updater.checkForUpdate()}
              onDownloadAppUpdate={() => window.hamidsDeutsch.updater.downloadUpdate()}
              onInstallAppUpdate={() => window.hamidsDeutsch.updater.installUpdate()}
              standaloneDoH={preferredDnsServer}
              standaloneDoHLoading={standaloneDoHLoading}
              customDnsPrimary={preferredDnsServer === 'custom' ? preferredDnsPrimary : customDnsPrimary}
              customDnsSecondary={preferredDnsServer === 'custom' ? preferredDnsSecondary : customDnsSecondary}
              dnsApplyError={dnsApplyError}
              customDnsProfiles={customDnsProfiles}
              onSaveDnsProfile={(profile) => {
                const next: DnsProfile = {
                  id: `custom-${crypto.randomUUID()}`,
                  name: profile.name.trim() || `DNS ${profile.primary.trim()}`,
                  primary: profile.primary.trim(),
                  secondary: profile.secondary.trim(),
                  custom: true,
                  server: 'custom',
                }
                saveDnsProfiles([next, ...customDnsProfiles])
                setSelectedDnsProfileId(next.id)
              }}
              onRemoveDnsProfile={(id) => saveDnsProfiles(customDnsProfiles.filter((profile) => profile.id !== id))}
              onCustomDnsChange={(primary, secondary) => {
                setCustomDnsPrimary(primary)
                setCustomDnsSecondary(secondary)
              }}
              onStandaloneDoHChange={async (server, primary, secondary) => {
                setStandaloneDoHLoading(true)
                setDnsApplyError(null)
                const r = await window.hamidsDeutsch.doh.setPreferred(
                  server === 'custom' ? { server, primary, secondary } : server,
                )
                if (r.success) {
                  setPreferredDnsServer(server)
                  setPreferredDnsPrimary(r.preferredDnsPrimary ?? primary ?? '')
                  setPreferredDnsSecondary(r.preferredDnsSecondary ?? secondary ?? '')
                } else {
                  setDnsApplyError(r.error)
                }
                setStandaloneDoHLoading(false)
              }}
              proxyDoH={proxyDoH}
              onProxyDoHToggle={async (v) => {
                setProxyDoH(v)
                await window.hamidsDeutsch.doh.setProxyDoH(v)
              }}
              utlsHardened={utlsHardened}
              onHardenTls={hardenTlsSettings}
            />
            {/* Merged: Rescue Center + Tools now live under the Settings tab */}
            <RescuePage
              settings={rescueSettings.settings}
              onUpdate={rescueSettings.update}
              onReset={rescueSettings.reset}
              connected={connectionVerified}
            />
            <ToolsPage
              directDomains={directDomains.domains}
              onNavigateToSubscriptions={() => setActivePage('servers')}
            />
            </>
          )}
        </main>
        <footer className="app-footer">
          <span>Made with <span className="app-footer-heart">♥</span> by{' '}
            <a href="https://github.com/hrschemiker/ManfazVpn-Windows" target="_blank" rel="noopener noreferrer" className="app-footer-link">Hamidreza</a>
          </span>
        </footer>
      </section>
      {toastMessage && (
        <div
          className={toastMessage.tone === 'error' ? 'toast toast-error' : 'toast'}
          role={toastMessage.tone === 'error' ? 'alert' : 'status'}
          aria-live={toastMessage.tone === 'error' ? 'assertive' : 'polite'}
        >
          <span className="toast-icon">
            <BrandIcon name={toastMessage.tone === 'error' ? 'shield' : 'check'} size={18} />
          </span>
          <span>{toastMessage.text}</span>
        </div>
      )}
      {updateState.availableVersion && ['available', 'downloading', 'ready'].includes(updateState.phase) && (
        <div className="update-banner" role="status">
          {updateState.phase === 'ready' ? (
            <>
              <span>{t('update.readyToInstall')} — {updateState.availableVersion}</span>
              <button
                type="button"
                className="update-banner-btn"
                onClick={() => window.hamidsDeutsch.updater.installUpdate()}
              >
                {t('update.installRestart')}
              </button>
              <button type="button" className="update-banner-dismiss" onClick={() => setUpdateState((s) => ({ ...s, availableVersion: null }))} aria-label={t('btn.close')}>×</button>
            </>
          ) : updateState.phase === 'available' ? (
            <>
              <span>{t('update.released')} — {updateState.availableVersion}</span>
              <button type="button" className="update-banner-btn" onClick={() => void window.hamidsDeutsch.updater.downloadUpdate()}>
                {t('update.download')}
              </button>
              <button type="button" className="update-banner-dismiss" onClick={() => setUpdateState((s) => ({ ...s, availableVersion: null }))} aria-label={t('btn.close')}>×</button>
            </>
          ) : (
            <span>{t('update.downloading')} {updateState.availableVersion} · {updateState.percent}%</span>
          )}
        </div>
      )}
    </div>
      {qrUri && <QrModal uri={qrUri} onClose={() => setQrUri(null)} />}
      {pendingConfirmation && (
        <ConfirmDialog
          title={pendingConfirmation.title}
          message={pendingConfirmation.message}
          onConfirm={() => resolvePendingConfirmation(true)}
          onCancel={() => resolvePendingConfirmation(false)}
        />
      )}
      {killSwitchActive && (
        <div className="killswitch-overlay" role="alertdialog" aria-modal="true" aria-labelledby="killswitch-title">
          <div className="killswitch-dialog">
            <div className="killswitch-icon"><BrandIcon name="lock" size={34} /></div>
            <h2 id="killswitch-title">{t('killswitch.blocked.title')}</h2>
            <p>{t('killswitch.blocked.desc')}</p>
            {killSwitchError && <p className="killswitch-error" role="alert">{killSwitchError}</p>}
            <div className="killswitch-actions">
              <button className="primary-button" type="button" disabled={killSwitchReleasing} onClick={() => void releaseKillSwitch(true)}>
                {killSwitchReleasing ? t('btn.processing') : t('killswitch.reconnect')}
              </button>
              <button className="killswitch-restore-btn" type="button" disabled={killSwitchReleasing} onClick={() => void releaseKillSwitch(false)}>
                <strong>{t('killswitch.restore')}</strong>
                <small>{t('killswitch.restore.hint')}</small>
              </button>
            </div>
            <p className="killswitch-tray-hint">{t('killswitch.trayHint')}</p>
          </div>
        </div>
      )}
      </LangCtx.Provider>
    </ThemeCtx.Provider>
  )
}

function toPublicServer(
  node: SafeServerNode,
): PublicServer {
  return {
    id: node.id,
    nodeId:
      node.nodeId,
    subscriptionId:
      node.subscriptionId,
    subscriptionName:
      node.subscriptionName,
    name: node.name,
    protocol: node.protocol,
    host: node.host,
    port: node.port,
    transport: node.transport,
    tls: node.tls,
  }
}

type HomePageProps = {
  directDomains: string[]
  engineInfo: {
    installed: boolean
    healthy: boolean
    path: string
    version: string | null
    architecture: string | null
    error: string | null
  } | null
  tunBaselineIp: string | null
  tunCurrentIp: string | null
  administratorAvailable: boolean
  elevationRequesting: boolean
  elevationError: string | null
  onRelaunchAsAdministrator: () => void
  processStatus: {
    engineType?: 'xray' | 'sing-box'
    running: boolean
    ready: boolean
    systemProxyEnabled: boolean
    tunEnabled: boolean
    connectionMode:
      | 'local-proxy'
      | 'system-proxy'
      | 'tun'
      | null
    pid: number | null
    startedAt: string | null
    stoppedAt: string | null
    localHost: string
    localPort: number
    lastExitCode: number | null
    lastSignal: string | null
    lastError: string | null
    logTail: string
  }
  processBusy: boolean
  processError: string | null
  ipVerificationResult: {
    success: boolean
    checkedAt: string
    directIp: string | null
    proxyIp: string | null
    changed: boolean
    directDurationMs: number | null
    proxyDurationMs: number | null
    service: string
    error: string | null
  }
  ipVerificationChecking: boolean
  isConnected: boolean
  dnsProfiles: DnsProfile[]
  selectedDnsProfileId: string
  dnsActive: boolean
  activeDnsProfile: DnsProfile | null
  dnsBusy: boolean
  dnsError: string | null
  onDnsSelection: (id: string) => void
  onDnsConnect: () => void
  onDnsDisconnect: () => void
  selectedServer: PublicServer | null
  selectedServerLatency: LatencyItem | null
  fastestServer: SafeServerNode | null
  fastestLatencyMs: number | null
  latencyTesting: boolean
  latencyError: string | null
  onMainAction: () => void
  onStartFastest: () => void
  onStartPrevious: () => void
  onStop: () => void
  onVerifyIp: () => void
  onRetestLatency: () => void
  onOpenServers: () => void
  onOpenDirectSites: () => void
  onOpenRescue: () => void
  onOpenSettings: () => void
  topSubServers: Array<{ id: string; name: string; protocol: string; latencyMs: number | null }>
  onConnectSubServer: (id: string) => void
  connectProgress: {
    step: number
    total: number
    label: string | null
    serverName: string | null
    attempt: number
  } | null
  speedTest: { mbps: number | null; running: boolean; error: string | null } | null
  showReconnectBar: boolean
  onQuickReconnect: () => void
  hasSubscription: boolean
  dataLoading: boolean
  trafficSpeed: { upSpeed: number; downSpeed: number } | null
  onShowQr: (compositeId: string) => void
  onNavigateToTools: () => void
}

function HomePage({
  directDomains: _directDomains,
  engineInfo: _engineInfo,
  tunBaselineIp: _tunBaselineIp,
  tunCurrentIp,
  administratorAvailable,
  elevationRequesting,
  elevationError,
  onRelaunchAsAdministrator,
  processStatus,
  processBusy,
  processError,
  ipVerificationResult,
  ipVerificationChecking,
  isConnected,
  dnsProfiles,
  selectedDnsProfileId,
  dnsActive,
  activeDnsProfile,
  dnsBusy,
  dnsError,
  onDnsSelection,
  onDnsConnect,
  onDnsDisconnect,
  selectedServer,
  selectedServerLatency,
  fastestServer,
  fastestLatencyMs,
  latencyTesting,
  latencyError,
  onMainAction,
  onStartFastest,
  onStartPrevious,
  onStop,
  onVerifyIp: _onVerifyIp,
  onRetestLatency,
  onOpenServers,
  onOpenDirectSites: _onOpenDirectSites,
  onOpenRescue: _onOpenRescue,
  connectProgress,
  speedTest,
  showReconnectBar,
  onQuickReconnect,
  hasSubscription,
  dataLoading,
  topSubServers,
  onConnectSubServer,
  trafficSpeed,
  onShowQr,
  onNavigateToTools: _onNavigateToTools,
}: HomePageProps) {
  const t = useT()
  const { lang } = useContext(LangCtx)

  // ── Local reconnect dismiss ───────────────────────────────────────────────
  const [reconnectDismissed, setReconnectDismissed] = useState(false)
  useEffect(() => { if (showReconnectBar) setReconnectDismissed(false) }, [showReconnectBar])
  function setShowReconnectBarLocal(v: boolean) { if (!v) setReconnectDismissed(true) }
  const showReconnect = showReconnectBar && !reconnectDismissed

  // ── Error banner (top of hero, auto-dismisses after 10s or on connection) ──
  const heroConnectedLocal = isConnected || dnsActive
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  const errorBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dismissErrorBanner = () => {
    if (errorBannerTimerRef.current) clearTimeout(errorBannerTimerRef.current)
    setErrorBanner(null)
  }
  // Collect errors into banner
  const activeError = processError ? processError
        : (latencyError && !heroConnectedLocal) ? latencyError
    : null
  useEffect(() => {
    if (!activeError) return
    setErrorBanner(activeError)
    if (errorBannerTimerRef.current) clearTimeout(errorBannerTimerRef.current)
    errorBannerTimerRef.current = setTimeout(() => setErrorBanner(null), 10000)
    return () => { if (errorBannerTimerRef.current) clearTimeout(errorBannerTimerRef.current) }
  }, [activeError])
  // Dismiss on successful connection
  useEffect(() => { if (heroConnectedLocal) dismissErrorBanner() }, [heroConnectedLocal])
  const [sessionStart, setSessionStart] = useState<number | null>(null)
  const [elapsedSecs, setElapsedSecs] = useState(0)

  useEffect(() => {
    if (heroConnectedLocal) {
      setSessionStart((s) => s ?? Date.now())
    } else {
      setSessionStart(null)
      setElapsedSecs(0)
    }
  }, [heroConnectedLocal])

  useEffect(() => {
    if (sessionStart == null) return
    const id = window.setInterval(() => {
      setElapsedSecs(Math.floor((Date.now() - sessionStart) / 1000))
    }, 1000)
    return () => window.clearInterval(id)
  }, [sessionStart])

  function formatElapsed(s: number) {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    const pad = (n: number) => String(n).padStart(2, '0')
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
  }

  function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  const [switchConfirm, setSwitchConfirm] = useState<{
    title: string
    message: string
    onConfirm: () => void
  } | null>(null)

  function requireSwitch(title: string, message: string, onConfirm: () => void) {
    setSwitchConfirm({ title, message, onConfirm })
  }

  const vpnConnectionActive = isConnected
  const heroConnected = heroConnectedLocal
  const activeMethod: 'subscription' | 'dns' | null =
    processStatus.running ? 'subscription' : dnsActive ? 'dns' : null

  const isConnecting = (processBusy || connectProgress !== null) && !heroConnected
  const orbitClass = [
    'connection-orbit',
    heroConnected ? 'connection-orbit-online' :
      isConnecting ? 'connection-orbit-connecting' : '',
  ].filter(Boolean).join(' ')

  // A ticking number is the cheapest proof that the app is still working on it.
  const [connectElapsed, setConnectElapsed] = useState(0)
  useEffect(() => {
    if (!connectProgress) { setConnectElapsed(0); return }
    setConnectElapsed(0)
    const id = window.setInterval(() => setConnectElapsed((value) => value + 1), 1000)
    return () => window.clearInterval(id)
  }, [connectProgress !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  const [adminBannerDismissed, setAdminBannerDismissed] = useState(false)

  const isSubConnecting = processBusy && !isConnected

  function handleSubscriptionConnect() {
    // During connecting or when connected: always stop/cancel
    if (isSubConnecting || activeMethod === 'subscription') {
      void onStop()
    } else if (activeMethod) {
      requireSwitch(
        t('confirm.switchMethod.title'),
        t('confirm.switchMethod.toSubscription'),
        () => { setSwitchConfirm(null); void onStartFastest() },
      )
    } else {
      void onStartFastest()
    }
  }

  function handleHeroVisualClick() {
    if (activeMethod === 'dns') onDnsDisconnect()
    else if (activeMethod === 'subscription') {
      requireSwitch(t('btn.disconnect'), t('confirm.disconnect'), () => { setSwitchConfirm(null); onMainAction() })
    }
  }

  // ── Connection stages ──────────────────────────────────────────────────────
  type StageStatus = 'idle' | 'active' | 'done' | 'error'
  function getSubStages(): { icon: string; label: string; status: StageStatus }[] {
    if (isConnecting || activeMethod === 'subscription') {
      return [
        { icon: '◌', label: `${t('stage.startEngine')} ${processStatus.engineType === 'xray' ? 'Xray' : 'sing-box'}`, status: processBusy && !processStatus.ready ? 'active' : (processStatus.ready || isConnected) ? 'done' : 'idle' },
        { icon: '⇄', label: t('stage.localProxy'), status: processStatus.ready && !isConnected ? 'active' : isConnected ? 'done' : 'idle' },
        { icon: '✓', label: t('stage.verifyIp'), status: ipVerificationChecking ? 'active' : isConnected ? 'done' : 'idle' },
      ]
    }
    return []
  }

  const subStages = getSubStages()
  const showStages = subStages.length > 0 && (isConnecting ||
    (heroConnected && subStages.some(s => s.status !== 'idle')))

  return (
    <div className="home-layout">
      {errorBanner && (
        <div className="error-banner" role="alert">
          <span className="error-banner-text">{friendlyError(errorBanner)}</span>
          <button className="error-banner-close" type="button" onClick={dismissErrorBanner} aria-label={t('btn.close')}><BrandIcon name="close" size={16} /></button>
        </div>
      )}
      {!administratorAvailable && !processStatus.running && !adminBannerDismissed && (
        <div className="admin-banner">
          <div>
            <strong>{t('hero.adminRequired')}</strong>
            <span>{t('hero.adminDesc')}</span>
          </div>
          <button
            className="admin-banner-relaunch"
            type="button"
            disabled={elevationRequesting}
            onClick={onRelaunchAsAdministrator}
          >
            {elevationRequesting ? t('hero.requestingAccess') : t('hero.relaunchAdmin')}
          </button>
          <button
            className="admin-banner-close"
            type="button"
            onClick={() => setAdminBannerDismissed(true)}
            aria-label={t('btn.close')}
          >✕</button>
        </div>
      )}

      <section className="hero-card">
        <div className="hero-content">
          <div className="hero-status-block" role="status" aria-live="polite">
            <div className="status-label">
            <span
              className={
                heroConnected
                  ? 'status-label-dot status-label-dot-online'
                  : 'status-label-dot'
              }
            />
            {activeMethod === 'dns'
                  ? `DNS · ${activeDnsProfile?.name ?? 'Custom'} · ${activeDnsProfile?.primary ?? ''}`
                : isConnected
                  ? processStatus.connectionMode === 'tun'
                    ? `TUN · IP ${tunCurrentIp ?? t('stats.confirmed')}`
                    : `System Proxy · IP ${ipVerificationResult.proxyIp ?? t('stats.confirmed')}`
                  : ipVerificationChecking
                    ? t('status.checkingIp')
                    : processStatus.ready
                      ? t('home.proxy.title.ready')
                      : processStatus.running
                        ? t('home.proxy.title.running')
                        : t('status.disconnected')}
            </div>
            {heroConnected && (
              <div className="hero-live-stats" dir="ltr">
                {elapsedSecs >= 0 && (
                  <span className="hero-meter-pill"><BrandIcon name="clock" size={14} /> {formatElapsed(elapsedSecs)}</span>
                )}
                <span className="hero-meter-pill bw-up" title={t('stats.uploadSpeed')}>
                  <BrandIcon name="upload" size={14} /> {formatBytes(trafficSpeed?.upSpeed ?? 0)}/s
                </span>
                <span className="hero-meter-pill bw-down" title={t('stats.downloadSpeed')}>
                  <BrandIcon name="download" size={14} /> {formatBytes(trafficSpeed?.downSpeed ?? 0)}/s
                </span>
                {speedTest?.running ? (
                  <span className="hero-meter-pill bw-speed"><BrandIcon name="bolt" size={14} /> …</span>
                ) : speedTest?.mbps != null ? (
                  <span className="hero-meter-pill bw-speed"><BrandIcon name="bolt" size={14} /> {speedTest.mbps} Mbps</span>
                ) : null}
              </div>
            )}
          </div>

          {elevationError && (
            <div className="inline-error">
              {elevationError}
            </div>
          )}

          <div className="connect-method-buttons">
            {/* ── Personal Subscription — Black ── */}
            <button
              className={`method-btn method-btn-black${(activeMethod === 'subscription' || isSubConnecting) ? ' method-btn-active' : ''}`}
              type="button"
              onClick={handleSubscriptionConnect}
            >
              <span className="method-btn-icon">
                {isSubConnecting || (activeMethod === 'subscription' && processBusy)
                  ? <span className="connection-stage-spinner" aria-hidden="true" />
                  : <BrandIcon name={activeMethod === 'subscription' ? 'stop' : 'play'} size={20} />}
              </span>
              <span className="method-btn-label">
                <strong>{isSubConnecting ? `■ ${t('btn.stop')}` : activeMethod === 'subscription' ? t('btn.disconnect') : t('hero.connectFastest')}</strong>
                <small>
                  {/* Name the server this actually concerns. While an attempt
                      is running that is the node being dialled, and at rest it
                      is the one the user picked, not whichever happens to be
                      fastest right now. */}
                  {activeMethod === 'subscription' && isConnected
                    ? (processStatus.connectionMode === 'tun' ? `TUN · ${tunCurrentIp ?? '—'}` : `IP ${ipVerificationResult.proxyIp ?? '—'}`)
                    : connectProgress?.serverName
                      ?? selectedServer?.name
                      ?? fastestServer?.name
                      ?? t('home.fastest.unknown')}
                </small>
              </span>
            </button>

          </div>

          {connectProgress && !heroConnected && (
            <div
              className="connect-progress"
              role="status"
              aria-live="polite"
              aria-busy="true"
            >
              <div className="connect-progress-head">
                <span className="connect-progress-spinner" aria-hidden="true" />
                <span className="connect-progress-label">
                  {connectProgress.label ?? t('status.connecting')}
                </span>
                <span className="connect-progress-count" dir="ltr">
                  {Math.max(1, connectProgress.step)}/{connectProgress.total}
                </span>
              </div>

              <div className="connect-progress-track">
                <span
                  className="connect-progress-fill"
                  style={{
                    width: `${Math.round(
                      (Math.max(0, connectProgress.step) / connectProgress.total) * 100,
                    )}%`,
                  }}
                />
              </div>

              <div className="connect-progress-meta">
                {connectProgress.serverName && (
                  <span className="connect-progress-server">{connectProgress.serverName}</span>
                )}
                {connectProgress.attempt > 1 && (
                  <span className="connect-progress-attempt">
                    {t('connect.attempt')} {connectProgress.attempt}
                  </span>
                )}
                <span className="connect-progress-elapsed" dir="ltr">{connectElapsed}s</span>
              </div>
            </div>
          )}

          {showStages && !connectProgress && (
            <div className="connection-stages">
              {subStages.map((stage, i) => (
                <div
                  key={i}
                  className={`connection-stage${
                    stage.status === 'active' ? ' connection-stage-active' :
                    stage.status === 'done' ? ' connection-stage-done' :
                    stage.status === 'error' ? ' connection-stage-error' : ''
                  }`}
                >
                  <span className="connection-stage-icon">
                    {stage.status === 'active' ? <span className="connection-stage-spinner" aria-hidden="true" /> : stage.icon}
                  </span>
                  <span className="connection-stage-label">{stage.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          className={`hero-visual${heroConnected ? ' hero-visual-clickable' : ''}`}
          role={heroConnected ? 'button' : undefined}
          tabIndex={heroConnected ? 0 : undefined}
          aria-label={heroConnected ? t('btn.disconnect') : undefined}
          onClick={heroConnected ? handleHeroVisualClick : undefined}
          onKeyDown={heroConnected ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleHeroVisualClick() }
          } : undefined}
        >
          <div className={orbitClass}>
            <div className="connection-orbit-middle">
              <div className="connection-orbit-core">
                <img
                  src="logo.png"
                  className={`orbit-logo${heroConnected ? ' orbit-logo-online' : ''}${isConnecting ? ' orbit-logo-connecting' : ''}`}
                  alt=""
                />
              </div>
            </div>
          </div>
          {heroConnected && (
            <span className="orbit-disconnect-hint" aria-hidden="true">{t('hero.clickToDisconnect')}</span>
          )}
          {heroConnected && (
            <button type="button" className="hero-disconnect-button" onClick={handleHeroVisualClick}>
              <BrandIcon name="power" size={16} />
              <span>{t('btn.disconnect')}</span>
            </button>
          )}
        </div>
      </section>

      {showReconnect && !heroConnected && (
        <div className="reconnect-bar">
          <span className="reconnect-bar-label">
            {t('reconnect.label')} {t('reconnect.subscription')}
          </span>
          <button className="primary-button reconnect-bar-btn" type="button" onClick={onQuickReconnect}>
            {t('reconnect.button')}
          </button>
          <button className="text-button" type="button" onClick={() => setShowReconnectBarLocal(false)} aria-label={t('btn.close')}>✕</button>
        </div>
      )}

      {/* ── Quick stats strip (shown only when connected) ── */}
      {heroConnected && (
      <section className="quick-statistics stats-connected">
        <article className="statistic-card" style={{ animationDelay: '0ms' }}>
          <span className="statistic-icon"><BrandIcon name="pulse" size={22} /></span>
          <div>
            <span className="statistic-label">{t('stats.outputIp')}</span>
            <div className="statistic-value-row">
              <strong dir="ltr">
                {ipVerificationResult.proxyIp
                  ? ipVerificationResult.proxyIp
                  : heroConnected
                    ? t('stats.confirmed')
                    : '—'}
              </strong>
              {ipVerificationResult.proxyIp && (
                <CopyButton text={ipVerificationResult.proxyIp} />
              )}
            </div>
          </div>
        </article>
        <article className="statistic-card" style={{ animationDelay: '80ms' }}>
          <span className="statistic-icon"><BrandIcon name="servers" size={22} /></span>
          <div>
            <span className="statistic-label">{t('stats.currentServer')}</span>
            <strong>
              {selectedServer?.name ?? '—'}
            </strong>
          </div>
        </article>
        <article className="statistic-card" style={{ animationDelay: '160ms' }}>
          <span className="statistic-icon"><BrandIcon name="clock" size={22} /></span>
          <div>
            <span className="statistic-label">{t('stats.latency')}</span>
            <strong dir="ltr">
              {activeMethod === 'subscription' && selectedServerLatency?.latencyMs != null
                ? `${selectedServerLatency.latencyMs} ms`
                : '—'}
            </strong>
          </div>
        </article>
      </section>
      )}

      {/* Nothing to connect to yet. Rather than a list of instructions the user
          has to carry to another tab, hand them the action itself. */}
      {!hasSubscription && !dataLoading && (
        <section className="subscription-invite">
          <div className="subscription-invite-glow" aria-hidden="true" />

          <div className="subscription-invite-icon">
            <BrandIcon name="globe" size={26} />
          </div>

          <div className="subscription-invite-copy">
            <span className="panel-kicker">{t('home.invite.kicker')}</span>
            <h3>{t('home.invite.title')}</h3>
            <p>{t('home.invite.desc')}</p>
          </div>

          <button
            className="subscription-invite-action"
            type="button"
            onClick={onOpenServers}
          >
            <span>{t('home.invite.action')}</span>
            <BrandIcon name="servers" size={16} />
          </button>
        </section>
      )}

      {hasSubscription && !heroConnected && !fastestServer && !selectedServer && !latencyTesting && !dataLoading && (
        <div className="home-empty-state">
          <div className="home-empty-icon"><BrandIcon name="pulse" size={30} /></div>
          <p className="home-empty-title">{t('home.empty.title')}</p>
          <ol className="home-empty-steps">
            <li>{t('home.empty.step1')}</li>
            <li>{t('home.empty.step2')}</li>
            <li>{t('home.empty.step3')}</li>
          </ol>
        </div>
      )}

      <section className="connection-choice-grid">
        <ConnectionChoiceCard
          title={t('home.fastest.title')}
          kicker={t('home.fastest.kicker')}
          serverName={
            fastestServer?.name ??
            (latencyTesting ? t('home.fastest.testing') : t('home.fastest.unknown'))
          }
          protocol={
            fastestServer
              ? formatProtocolNameForUi(fastestServer.protocol)
              : '—'
          }
          latencyMs={fastestLatencyMs}
          available={Boolean(fastestServer) && !processBusy}
          testing={latencyTesting}
          actionLabel={t('home.fastest.connect')}
          onAction={onStartFastest}
          secondaryActionLabel={t('home.fastest.viewServers')}
          onSecondaryAction={onOpenServers}
          realityBadge={(fastestServer?.security ?? '').toLowerCase() === 'reality'}
        />

        <ConnectionChoiceCard
          title={t('home.prev.title')}
          kicker={t('home.prev.kicker')}
          serverName={selectedServer?.name ?? t('home.prev.none')}
          protocol={
            selectedServer
              ? formatProtocolNameForUi(selectedServer.protocol)
              : '—'
          }
          latencyMs={selectedServerLatency?.latencyMs ?? null}
          available={Boolean(selectedServer) && !processBusy}
          testing={latencyTesting}
          actionLabel={t('home.prev.connect')}
          onAction={onStartPrevious}
          secondaryActionLabel={t('home.prev.retest')}
          onSecondaryAction={onRetestLatency}
        />

        <article className={`connection-choice-card dns-choice-card${dnsActive ? ' dns-choice-active' : ''}${vpnConnectionActive ? ' dns-choice-vpn-muted' : ''}`}>
          <div className="connection-choice-heading">
            <div>
              <span className="panel-kicker">{lang === 'fa' ? 'اتصال مستقل' : 'Standalone connection'}</span>
              <h3>{lang === 'fa' ? 'اتصال فقط با DNS' : 'DNS-only connection'}</h3>
            </div>
            <InfoButton
              fa="این اتصال فقط DNS آداپترهای فعال ویندوز را تغییر می‌دهد و VPN را روشن نمی‌کند. هنگام قطع اتصال، تنظیمات DNS قبلی هر آداپتر دقیقاً بازیابی می‌شود."
              en="Changes DNS on active Windows adapters without starting the VPN. Disconnecting restores each adapter's previous DNS configuration."
            />
          </div>
          <label className="dns-card-select">
            <span>{lang === 'fa' ? 'سرویس DNS' : 'DNS service'}</span>
            <select
              value={selectedDnsProfileId}
              disabled={dnsBusy || vpnConnectionActive}
              onChange={(event) => onDnsSelection(event.target.value)}
            >
              {dnsProfiles.filter((profile) => profile.custom).length > 0 && (
                <optgroup label={lang === 'fa' ? 'DNSهای من' : 'My DNS profiles'}>
                  {dnsProfiles.filter((profile) => profile.custom).map((profile) => (
                    <option key={profile.id} value={profile.id}>{profile.name} · {profile.primary}</option>
                  ))}
                </optgroup>
              )}
              <optgroup label={lang === 'fa' ? 'DNSهای برنامه' : 'Built-in DNS'}>
                {dnsProfiles.filter((profile) => !profile.custom).map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.name} · {profile.primary}</option>
                ))}
              </optgroup>
            </select>
          </label>
          <div className="connection-choice-server">
            <strong>{dnsActive ? activeDnsProfile?.name : dnsProfiles.find((profile) => profile.id === selectedDnsProfileId)?.name}</strong>
            <span dir="ltr">{dnsActive ? activeDnsProfile?.primary : dnsProfiles.find((profile) => profile.id === selectedDnsProfileId)?.primary}</span>
          </div>
          {dnsError && <div className="inline-error">{dnsError}</div>}
          <div className="connection-choice-actions">
            <button
              className={dnsActive ? 'danger-button' : 'primary-button'}
              type="button"
              disabled={dnsBusy || vpnConnectionActive}
              onClick={dnsActive ? onDnsDisconnect : onDnsConnect}
            >
              {vpnConnectionActive
                ? (lang === 'fa' ? 'DNS از داخل VPN اعمال می‌شود' : 'DNS is applied inside VPN')
                : dnsBusy
                ? (lang === 'fa' ? 'در حال اعمال…' : 'Applying…')
                : dnsActive
                  ? t('btn.disconnect')
                  : t('dns.connect')}
            </button>
          </div>
        </article>
      </section>

      {switchConfirm && (
        <ConfirmDialog
          title={switchConfirm.title}
          message={switchConfirm.message}
          confirmLabel={t('confirm.switchServer.ok')}
          onConfirm={switchConfirm.onConfirm}
          onCancel={() => setSwitchConfirm(null)}
        />
      )}

      {/* ── Top-5 subscription server mini-list ── */}
      <section className="connection-choice-grid top-servers-grid">
        <article className="top-server-card">
          <div className="top-server-card-header">
            <span className="panel-kicker">{t('home.topSub.kicker')}</span>
            <button className="text-button" type="button" onClick={onOpenServers}>{t('home.fastest.viewServers')}</button>
          </div>
          {topSubServers.length === 0 ? (
            <p className="top-server-empty">{latencyTesting ? t('home.fastest.testing') : t('home.topSub.empty')}</p>
          ) : (
            <ul className="top-server-list">
              {topSubServers.map((s) => (
                <li key={s.id} className="top-server-row">
                  <span className="top-server-name">{s.name}</span>
                  <span className="top-server-latency" dir="ltr">{s.latencyMs != null ? `${s.latencyMs} ms` : '—'}</span>
                  <button
                    className="top-server-qr-btn"
                    type="button"
                    title="QR Code"
                    aria-label="QR Code"
                    onClick={() => onShowQr(s.id)}
                  >⬡</button>
                  <button
                    className="top-server-connect-btn"
                    type="button"
                    disabled={processBusy}
                    title={t('btn.connect')}
                    aria-label={`${t('btn.connect')} — ${s.name}`}
                    onClick={() => onConnectSubServer(s.id)}
                  >▶</button>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="manfaz-promo-card">
          <img src="manfaz-service-banner-v1.png" alt="" loading="lazy" />
          <div className="manfaz-promo-shade" />
          <div className="manfaz-promo-copy">
            <span>{lang === 'fa' ? 'MANFAZ PREMIUM' : 'MANFAZ PREMIUM'}</span>
            <strong>{lang === 'fa' ? 'اتصال مطمئن، برای هر روز' : 'Reliable connectivity, every day'}</strong>
            <p>{lang === 'fa' ? 'سرویس اختصاصی با سرعت پایدار و پشتیبانی واقعی' : 'Private service with consistent speed and real support'}</p>
            <a href="https://t.me/ManfazVpnBot" target="_blank" rel="noopener noreferrer">
              {lang === 'fa' ? 'مشاهده سرویس‌ها' : 'View services'}
            </a>
          </div>
        </article>
      </section>
    </div>
  )
}

function ConnectionChoiceCard({
  title,
  kicker,
  serverName,
  protocol,
  latencyMs,
  available,
  testing,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  realityBadge = false,
}: {
  title: string
  kicker: string
  serverName: string
  protocol: string
  latencyMs: number | null
  available: boolean
  testing: boolean
  actionLabel: string
  onAction: () => void
  secondaryActionLabel: string
  onSecondaryAction: () => void
  realityBadge?: boolean
}) {
  return (
    <article className="connection-choice-card">
      <div className="connection-choice-heading">
        <div>
          <span className="panel-kicker">
            {kicker}
          </span>
          <h3>{title}</h3>
        </div>

        <div className="connection-choice-badges">
          {realityBadge && (
            <span className="reality-chip">🔐 REALITY</span>
          )}
          <LatencyBadge
            latencyMs={latencyMs}
            testing={testing}
          />
        </div>
      </div>

      <div className="connection-choice-server">
        <strong>{serverName}</strong>
        <span>{protocol}</span>
      </div>

      <div className="connection-choice-actions">
        <button
          className="primary-button"
          type="button"
          disabled={!available}
          onClick={onAction}
        >
          {actionLabel}
        </button>

        <button
          className="secondary-button"
          type="button"
          onClick={onSecondaryAction}
        >
          {secondaryActionLabel}
        </button>
      </div>
    </article>
  )
}

// ── ProtocolBadge ─────────────────────────────────────────────────────────────

const PROTOCOL_COLORS: Record<string, string> = {
  vmess: '#e8b84b',
  vless: '#a78bfa',
  trojan: '#f87171',
  ss: '#60a5fa',
  shadowsocks: '#60a5fa',
  hysteria: '#34d399',
  hysteria2: '#10b981',
  hy2: '#10b981',
  tuic: '#fb923c',
  wireguard: '#818cf8',
  anytls: '#f472b6',
}

function ProtocolBadge({ protocol, security }: { protocol: string; security?: string | null }) {
  const key = protocol.toLowerCase().replace('://', '')
  const color = PROTOCOL_COLORS[key] ?? '#94a3b8'
  const label = protocol.toUpperCase().replace('://', '')
  const icon = getProtocolIcon(key, security)
  return (
    <span className="protocol-badge" style={{ '--pb-color': color } as React.CSSProperties}>
      <span className="pb-icon" aria-hidden="true"><BrandIcon name={icon} size={13} /></span>{label}
    </span>
  )
}

// ── Latency helpers ───────────────────────────────────────────────────────────

function getLatencyColor(ms: number | null): string {
  if (ms === null) return 'var(--text-secondary)'
  if (ms <= 100) return '#10b981'
  if (ms <= 250) return '#f59e0b'
  if (ms <= 400) return '#f97316'
  return '#ef4444'
}

function getQualityLabel(ms: number | null, t: (k: string) => string): string {
  if (ms === null) return '—'
  if (ms <= 100) return t('quality.excellent')
  if (ms <= 250) return t('quality.good')
  if (ms <= 400) return t('quality.fair')
  return t('quality.weak')
}

// ── Protocol icons ────────────────────────────────────────────────────────────

const PROTOCOL_ICONS: Record<string, BrandIconName> = {
  vless: 'lock',
  vmess: 'lock',
  trojan: 'lock',
  hysteria2: 'bolt',
  hy2: 'bolt',
  hysteria: 'bolt',
  tuic: 'bolt',
  wireguard: 'shield',
  anytls: 'shield',
  ss: 'pulse',
  shadowsocks: 'pulse',
}

function getProtocolIcon(protocol: string, security?: string | null): BrandIconName {
  const key = protocol.toLowerCase().replace('://', '')
  if ((key === 'vless' || key === 'vmess' || key === 'trojan') && (security ?? '').toLowerCase() === 'reality') {
    return 'shield'
  }
  return PROTOCOL_ICONS[key] ?? 'pulse'
}

// ── Error message mapper ───────────────────────────────────────────────────────

function friendlyError(raw: string | null | undefined): string {
  if (!raw) return 'خطای ناشناخته'
  const msg = raw.toLowerCase()
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('تایم')) return 'سرور پاسخ نداد (timeout)'
  if (msg.includes('refused') || msg.includes('econnrefused')) return 'پورت بسته است (connection refused)'
  if (msg.includes('network') || msg.includes('شبکه')) return 'خطای شبکه — اتصال اینترنت را بررسی کن'
  if (msg.includes('protocol') || msg.includes('پروتکل')) return 'پروتکل پشتیبانی نمی‌شود'
  if (msg.includes('config') || msg.includes('کانفیگ')) return 'ساختار کانفیگ نامعتبر است'
  if (msg.includes('uuid') || msg.includes('password') || msg.includes('auth')) return 'رمز یا UUID نادرست است'
  if (msg.includes('ip') || msg.includes('تغییر')) return 'IP تغییر نکرد — تانل برقرار نشد'
  if (msg.includes('sing-box') || msg.includes('engine')) return 'موتور sing-box خطا داد'
  return raw
}

// ── CopyButton ────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const { lang } = useContext(LangCtx)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current)
  }, [])

  if (!text) return null
  return (
    <button
      className={`copy-btn${copied ? ' copy-btn-done' : ''}`}
      type="button"
      aria-label={copyFailed
        ? (lang === 'fa' ? 'کپی ناموفق بود' : 'Copy failed')
        : copied
          ? (lang === 'fa' ? 'کپی شد' : 'Copied')
          : (lang === 'fa' ? 'کپی' : 'Copy')}
      title={copyFailed
        ? (lang === 'fa' ? 'کپی ناموفق بود' : 'Copy failed')
        : (lang === 'fa' ? 'کپی' : 'Copy')}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setCopyFailed(false)
        } catch {
          setCopied(false)
          setCopyFailed(true)
        }
        if (resetTimer.current) clearTimeout(resetTimer.current)
        resetTimer.current = setTimeout(() => {
          setCopied(false)
          setCopyFailed(false)
        }, 1800)
      }}
    >
      {copyFailed ? '!' : copied ? '✓' : '⎘'}
    </button>
  )
}

// ── LatencyBadge ──────────────────────────────────────────────────────────────

function LatencyBadge({
  latencyMs,
  testing = false,
}: {
  latencyMs: number | null
  testing?: boolean
}) {
  const t = useT()
  if (testing) {
    return (
      <span className="latency-badge latency-badge-testing">
        {t('servers.testing')}
      </span>
    )
  }

  if (latencyMs === null) {
    return (
      <span className="latency-badge latency-badge-unavailable">
        {t('servers.noResult')}
      </span>
    )
  }

  const color = getLatencyColor(latencyMs)
  const qualityLabel = getQualityLabel(latencyMs, t)

  return (
    <span
      className="latency-badge latency-badge-colored"
      dir="ltr"
      style={{ color, borderColor: color } as React.CSSProperties}
      title={qualityLabel}
    >
      {latencyMs} ms
    </span>
  )
}

function EmptyPage({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: string
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <section className="empty-state">
      <div className="empty-state-icon" aria-hidden="true">
        {icon}
      </div>
      <h2>{title}</h2>
      <p>{description}</p>

      {actionLabel && onAction && (
        <button
          className="primary-button"
          type="button"
          onClick={onAction}
        >
          {actionLabel}
        </button>
      )}
    </section>
  )
}

type SubscriptionItem = {
  id: string
  name: string
  host: string
  createdAt: string
  updatedAt: string
}

type SubscriptionInspection = {
  success: boolean
  checkedAt: string
  httpStatus: number | null
  httpStatusText: string | null
  contentType: string | null
  responseSize: number | null
  format: string
  configCount: number
  error: string | null
}

type SubscriptionsPageProps = {
  loading: boolean
  subscriptions: SubscriptionItem[]
  loadError: string | null

  onAddSubscription: (
    name: string,
    url: string,
  ) => Promise<
    | {
        success: true
        error: null
      }
    | {
        success: false
        error: string
      }
  >

  onAddManualNodeFromSub: (
    uri: string,
  ) => Promise<{ success: boolean; error?: string }>

  onRemoveSubscription: (
    subscriptionId: string,
  ) => Promise<
    | {
        success: true
        error: null
      }
    | {
        success: false
        error: string
      }
  >

  onInspectSubscription: (
    subscriptionId: string,
  ) => Promise<SubscriptionInspection>

  onLoadServers: (
    subscriptionId: string,
  ) => Promise<
    | {
        success: true
        error: null
      }
    | {
        success: false
        error: string
      }
  >

  loadingServerSubscriptionId:
    | string
    | null
  subscriptionInfoMap?: Record<string, {
    upload: number | null
    download: number | null
    total: number | null
    expire: string | null
  }>
}

function SubscriptionsPage({
  loading,
  subscriptions,
  loadError,
  onAddSubscription,
  onAddManualNodeFromSub,
  onRemoveSubscription,
  onInspectSubscription,
  onLoadServers,
  loadingServerSubscriptionId,
  subscriptionInfoMap,
}: SubscriptionsPageProps) {
  const t = useT()
  const [nameInput, setNameInput] =
    useState('')

  const [urlInput, setUrlInput] =
    useState('')

  const [submitting, setSubmitting] =
    useState(false)

  const [removingId, setRemovingId] =
    useState<string | null>(null)

  const [undoSubVisible, setUndoSubVisible] = useState(false)
  const [undoSubData, setUndoSubData] = useState<{ name: string; host: string } | null>(null)
  const undoSubTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [inspectingId, setInspectingId] =
    useState<string | null>(null)

  const [
    inspectionResults,
    setInspectionResults,
  ] = useState<
    Record<
      string,
      SubscriptionInspection
    >
  >({})

  const [message, setMessage] =
    useState<{
      type: 'success' | 'error'
      text: string
    } | null>(null)

  const SERVER_URI_PREFIXES = ['vless://', 'vmess://', 'ss://', 'trojan://', 'hysteria2://', 'hy2://', 'tuic://', 'anytls://']

  function isServerUri(text: string) {
    const trimmed = text.trim()
    return SERVER_URI_PREFIXES.some((prefix) => trimmed.toLowerCase().startsWith(prefix))
  }

  async function handleAddSubscription() {
    if (submitting) {
      return
    }

    setSubmitting(true)
    setMessage(null)

    // If the URL field contains a server URI (not a subscription URL), add it as a manual node
    if (isServerUri(urlInput)) {
      const lines = urlInput.split('\n').map((l) => l.trim()).filter(Boolean)
      let addedCount = 0
      let lastError: string | null = null
      for (const line of lines) {
        if (isServerUri(line)) {
          const result = await onAddManualNodeFromSub(line)
          if (result.success) {
            addedCount++
          } else {
            lastError = result.error ?? 'خطا'
          }
        }
      }
      setSubmitting(false)
      setUrlInput('')
      setNameInput('')
      if (addedCount > 0) {
        setMessage({ type: 'success', text: `${addedCount} سرور به لیست سرورها اضافه شد.` })
      } else {
        setMessage({ type: 'error', text: lastError ?? 'افزودن سرور ناموفق بود.' })
      }
      return
    }

    const result =
      await onAddSubscription(
        nameInput,
        urlInput,
      )

    setSubmitting(false)

    if (!result.success) {
      setMessage({
        type: 'error',
        text: result.error,
      })

      return
    }

    setNameInput('')
    setUrlInput('')

    setMessage({
      type: 'success',
      text: t('sub.success.add'),
    })
  }

  async function handleRemoveSubscription(
    subscriptionId: string,
  ) {
    if (removingId) {
      return
    }

    const subToRemove = subscriptions.find((s) => s.id === subscriptionId)
    setRemovingId(subscriptionId)
    setMessage(null)

    const result =
      await onRemoveSubscription(
        subscriptionId,
      )

    setRemovingId(null)

    if (!result.success) {
      setMessage({
        type: 'error',
        text: result.error,
      })

      return
    }

    if (subToRemove) {
      setUndoSubData({ name: subToRemove.name, host: subToRemove.host })
      setUndoSubVisible(true)
      if (undoSubTimer.current) clearTimeout(undoSubTimer.current)
      undoSubTimer.current = setTimeout(() => setUndoSubVisible(false), 5000)
    } else {
      setMessage({ type: 'success', text: t('sub.success.delete') })
    }
  }

  async function handleUndoRemoveSub() {
    if (!undoSubData) return
    const snapshot = { ...undoSubData }
    if (undoSubTimer.current) clearTimeout(undoSubTimer.current)
    setUndoSubVisible(false)
    const result = await onAddSubscription(snapshot.name, snapshot.host)
    setUndoSubData(null)
    if (result.success) {
      setTimeout(() => {
        void window.hamidsDeutsch.subscriptions.list().then(async (subs) => {
          const restored = subs.find((s) => s.name === snapshot.name || s.host === snapshot.host)
          if (restored?.id) await onLoadServers(restored.id)
        }).catch(() => {})
      }, 300)
    }
  }

  async function handleInspectSubscription(
    subscriptionId: string,
  ) {
    if (inspectingId) {
      return
    }

    setInspectingId(subscriptionId)
    setMessage(null)

    const result =
      await onInspectSubscription(
        subscriptionId,
      )

    setInspectionResults(
      (currentResults) => ({
        ...currentResults,
        [subscriptionId]: result,
      }),
    )

    setInspectingId(null)

    if (!result.success) {
      setMessage({
        type: 'error',
        text:
          result.error ??
          'بررسی اشتراک ناموفق بود.',
      })

      return
    }

    setMessage({
      type: 'success',
      text: t('sub.success.inspect'),
    })
  }

  async function handleLoadServers(
    subscriptionId: string,
  ) {
    setMessage(null)

    const result =
      await onLoadServers(
        subscriptionId,
      )

    if (!result.success) {
      setMessage({
        type: 'error',
        text: result.error,
      })
    }
  }

  function handleUrlKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
  ) {
    if (event.key === 'Enter') {
      void handleAddSubscription()
    }
  }

  return (
    <div className="page-stack">
      <section className="panel-card">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">
              {t('sub.add.kicker')}
            </span>
            <h3>{t('sub.add.title')}</h3>
          </div>

          <div className="heading-end-row">
            <span className="count-badge">
              {subscriptions.length} اشتراک
            </span>
            <InfoButton
              fa="لینک اشتراک در فایل داده برنامه به‌صورت رمزگذاری‌شده ذخیره می‌شود. اصل لینک پس از ذخیره در این صفحه نمایش داده نخواهد شد."
              en="The subscription URL is stored encrypted in the app data folder. The original link will not be shown on this page after saving."
            />
          </div>
        </div>

        <label
          className="field-label"
          htmlFor="subscription-name"
        >
          {t('sub.name.label')}
        </label>

        <input
          id="subscription-name"
          className="text-input"
          placeholder={t('sub.name.placeholder')}
          type="text"
          value={nameInput}
          onChange={(event) => {
            setNameInput(
              event.target.value,
            )
            setMessage(null)
          }}
        />

        <label
          className="field-label subscription-url-label"
          htmlFor="subscription-url"
        >
          {t('sub.url.label')}
        </label>

        <div className="input-action-row">
          <input
            id="subscription-url"
            className="text-input"
            dir="ltr"
            placeholder="https://example.com/subscription"
            type="password"
            value={urlInput}
            onChange={(event) => {
              setUrlInput(
                event.target.value,
              )
              setMessage(null)
            }}
            onKeyDown={handleUrlKeyDown}
            autoComplete="off"
            spellCheck={false}
          />

          <button
            className="primary-button"
            type="button"
            disabled={submitting}
            onClick={() => {
              void handleAddSubscription()
            }}
          >
            {submitting
              ? t('sub.add.saving')
              : t('sub.add.btn')}
          </button>
        </div>

        {message && (
          <div
            className={
              message.type === 'success'
                ? 'form-message form-message-success'
                : 'form-message form-message-error'
            }
          >
            {message.text}
          </div>
        )}

        {loadError && (
          <div className="form-message form-message-error">
            {loadError}
          </div>
        )}
      </section>

      <section className="panel-card settings-card" id="settings-connection">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">
              {t('sub.list.kicker')}
            </span>
            <h3>{t('sub.list.title')}</h3>
          </div>
        </div>

        {loading ? (
          <div className="subscription-loading">
            {t('sub.list.loading')}
          </div>
        ) : subscriptions.length > 0 ? (
          <div className="subscription-list">
            {subscriptions.map(
              (subscription) => (
                <article
                  className="subscription-item"
                  key={subscription.id}
                >
                  <div className="subscription-icon">
                    ↧
                  </div>

                  <div className="subscription-main">
                    <strong>
                      {subscription.name}
                    </strong>

                    <span dir="ltr">
                      {subscription.host}
                    </span>

                    <small>
                      {t('sub.list.hidden')}
                    </small>
                  </div>

                  <div className="subscription-actions">
                    <span className="secure-badge">
                      {t('sub.list.secure')}
                    </span>

                    <button
                      className="load-servers-button"
                      type="button"
                      disabled={
                        loadingServerSubscriptionId ===
                        subscription.id
                      }
                      onClick={() => {
                        void handleLoadServers(
                          subscription.id,
                        )
                      }}
                    >
                      {loadingServerSubscriptionId ===
                      subscription.id
                        ? t('sub.list.loading2')
                        : t('sub.list.viewServers')}
                    </button>

                    <button
                      className="inspect-subscription-button"
                      type="button"
                      disabled={
                        inspectingId ===
                        subscription.id
                      }
                      onClick={() => {
                        void handleInspectSubscription(
                          subscription.id,
                        )
                      }}
                    >
                      {inspectingId ===
                      subscription.id
                        ? t('sub.list.inspecting')
                        : t('sub.list.inspect')}
                    </button>

                    <button
                      className="remove-domain-button"
                      type="button"
                      disabled={
                        removingId ===
                        subscription.id
                      }
                      onClick={() => {
                        void handleRemoveSubscription(
                          subscription.id,
                        )
                      }}
                    >
                      {removingId ===
                      subscription.id
                        ? t('sub.list.deleting')
                        : t('sub.list.delete')}
                    </button>
                  </div>

                  {subscriptionInfoMap?.[subscription.id] && (
                    <SubInfoCard info={subscriptionInfoMap[subscription.id]} />
                  )}
                  {inspectionResults[
                    subscription.id
                  ] && (
                    <SubscriptionInspectionPanel
                      inspection={
                        inspectionResults[
                          subscription.id
                        ]
                      }
                    />
                  )}
                </article>
              ),
            )}
          </div>
        ) : (
          <div className="empty-domain-list">
            <span>↧</span>
            <strong>
              {t('sub.empty.title')}
            </strong>
            <p>
              {t('sub.empty.desc')}
            </p>
          </div>
        )}
      </section>

      {undoSubVisible && (
        <div className="undo-bar">
          <span>{t('undo.removeSub')}</span>
          <button className="secondary-button undo-bar-btn" type="button" onClick={() => void handleUndoRemoveSub()}>
            {t('undo.button')}
          </button>
        </div>
      )}
    </div>
  )
}

const MANUAL_SUBSCRIPTION_ID = '__manual__'

function ServersPage({
  loading,
  nodes,
  error,
  selectedServerId,
  latencyTesting,
  latencyResults,
  latencyError,
  fastestServerId,
  directDomains,
  configCheckingNodeId,
  configCheckResults,
  processRunning,
  onCheckConfig,
  onTestLatency,
  onSelectServer,
  onClearSelectedServer,
  onOpenSubscriptions,
  onConnectSubNode,
  onStopConnection,
  subConnectingNodeId,
  subConnectingStep,
  onAddManualNode,
  onRemoveManualNode,
  onHideNode,
  hiddenNodeIds,
}: {
  loading: boolean
  nodes: SafeServerNode[]
  error: string | null
  selectedServerId: string | null
  latencyTesting: boolean
  latencyResults: Record<
    string,
    LatencyItem
  >
  latencyError: string | null
  fastestServerId: string | null
  directDomains: string[]
  configCheckingNodeId: string | null
  configCheckResults: Record<
    string,
    {
      success: boolean
      checkedAt: string
      nodeId: string | null
      protocol: string | null
      server: string | null
      serverPort: number | null
      configPath: string | null
      directDomainCount: number
      stdout: string
      error: string | null
    }
  >
  processRunning: boolean
  onCheckConfig: (node: SafeServerNode) => void
  onTestLatency: () => void
  onSelectServer: (server: PublicServer) => void
  onClearSelectedServer: () => void
  onOpenSubscriptions: () => void
  onConnectSubNode: (node: SafeServerNode) => void
  onStopConnection: () => void
  subConnectingNodeId: string | null
  subConnectingStep: string | null
  onAddManualNode: (uri: string) => Promise<{ success: boolean; error?: string }>
  onRemoveManualNode: (nodeId: string) => Promise<{ success: boolean; error?: string }>
  onHideNode: (compositeId: string) => Promise<void>
  hiddenNodeIds: string[]
}) {
  const t = useT()
  const [expandedServerId, setExpandedServerId] =
    useState<string | null>(null)

  const [switchConfirm, setSwitchConfirm] =
    useState<{ server: PublicServer } | null>(null)

  const [manualInput, setManualInput] = useState('')
  const [manualAdding, setManualAdding] = useState(false)
  const [manualError, setManualError] = useState<string | null>(null)
  const [showManualInput, setShowManualInput] = useState(false)

  type SortMode = 'ping' | 'name' | 'protocol' | 'reality'
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const saved = localStorage.getItem('hamidsdeutsch:server-sort')
    return (saved === 'ping' || saved === 'name' || saved === 'protocol' || saved === 'reality') ? saved : 'ping'
  })

  if (loading) {
    return (
      <section className="empty-state">
        <div className="empty-state-icon"><BrandIcon name="refresh" size={30} /></div>
        <h2>{t('servers.loading')}</h2>
        <p>{t('servers.loadingDesc')}</p>
      </section>
    )
  }

  if (error) {
    return (
      <section className="empty-state">
        <div className="empty-state-icon">!</div>
        <h2>{t('servers.error.title')}</h2>
        <p>{error}</p>
        <button
          className="primary-button"
          type="button"
          onClick={onOpenSubscriptions}
        >
          {t('servers.back')}
        </button>
      </section>
    )
  }

  const validNodes = nodes.filter(
    (node) => node.valid,
  )

  const visibleNodes = nodes.filter((n) => !hiddenNodeIds.includes(n.id))
  const sortedNodes = [...visibleNodes].sort((a, b) => {
    if (sortMode === 'name') return a.name.localeCompare(b.name)
    if (sortMode === 'protocol') return a.protocol.localeCompare(b.protocol)
    if (sortMode === 'reality') {
      const aR = (a.security ?? '').toLowerCase() === 'reality' ? 0 : 1
      const bR = (b.security ?? '').toLowerCase() === 'reality' ? 0 : 1
      if (aR !== bR) return aR - bR
    }
    // default ping sort (also used as tiebreaker for reality)
    const aRes = latencyResults[a.id]
    const bRes = latencyResults[b.id]
    const aRank = aRes?.reachable && typeof aRes.latencyMs === 'number' ? aRes.latencyMs : aRes ? Number.MAX_SAFE_INTEGER - 1 : Number.MAX_SAFE_INTEGER - 2
    const bRank = bRes?.reachable && typeof bRes.latencyMs === 'number' ? bRes.latencyMs : bRes ? Number.MAX_SAFE_INTEGER - 1 : Number.MAX_SAFE_INTEGER - 2
    return aRank - bRank
  })

  function getServerStatus(
    node: SafeServerNode,
  ) {
    const configResult =
      configCheckResults[node.id]
    const latencyResult =
      latencyResults[node.id]

    if (configCheckingNodeId === node.id) {
      return {
        label: t('servers.status.checking'),
        className: 'server-status-checking',
      }
    }

    if (configResult?.success) {
      return {
        label: t('servers.status.ok'),
        className: 'server-status-ready',
      }
    }

    if (configResult && !configResult.success) {
      return {
        label: t('servers.status.bad'),
        className: 'server-status-error',
      }
    }

    if (latencyResult?.reachable) {
      return {
        label: t('servers.status.reachable'),
        className: 'server-status-online',
      }
    }

    if (latencyResult && !latencyResult.reachable) {
      return {
        label: t('servers.status.offline'),
        className: 'server-status-offline',
      }
    }

    return {
      label: node.valid
        ? t('servers.status.ready')
        : t('servers.status.incomplete'),
      className: node.valid
        ? 'server-status-pending'
        : 'server-status-error',
    }
  }

  return (
    <div className="page-stack">
      {nodes.length === 0 ? (
        <section className="empty-state">
          <div className="empty-state-icon empty-state-icon-servers"><BrandIcon name="servers" size={30} /></div>
          <h2>{t('servers.empty.title')}</h2>
          <p>{t('servers.empty.desc')}</p>
          <ol className="empty-state-steps">
            <li>{t('servers.empty.step1')}</li>
            <li>{t('servers.empty.step2')}</li>
            <li>{t('servers.empty.step3')}</li>
          </ol>
          <button className="primary-button" type="button" onClick={onOpenSubscriptions}>
            {t('servers.goSubs')}
          </button>
        </section>
      ) : (
        <>
        <section className="panel-card">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">
              All Subscription Nodes
            </span>
            <h3>{t('servers.title')}</h3>
          </div>

          <div className="servers-heading-actions">
            <span className="count-badge">
              {validNodes.length} سرور معتبر از {
                new Set(
                  nodes.map(
                    (node) =>
                      node.subscriptionId,
                  ),
                ).size
              } اشتراک
            </span>

            <button
              className="inspect-subscription-button"
              type="button"
              disabled={latencyTesting}
              onClick={onTestLatency}
            >
              {latencyTesting
                ? t('servers.retesting')
                : t('servers.retestPing')}
            </button>

            {selectedServerId && (
              <button
                className="text-button"
                type="button"
                onClick={onClearSelectedServer}
              >
                {t('servers.deselect')}
              </button>
            )}

            <InfoButton
              fa="سرورهای همه اشتراک‌ها باهم بررسی و از سریع‌ترین به کندترین مرتب می‌شوند. برای دیدن اشتراک، آدرس، پورت و سایر جزئیات روی هر ردیف بزن."
              en="All subscription servers are tested together and sorted fastest to slowest. Tap a row to see subscription, address, port, and other details."
            />
          </div>
        </div>

        {latencyError && (
          <div className="form-message form-message-error">
            {latencyError}
          </div>
        )}

        {/* ── Manual server add ── */}
        <div className="manual-server-add">
          {!showManualInput ? (
            <button
              className="text-button manual-server-toggle"
              type="button"
              onClick={() => { setShowManualInput(true); setManualError(null) }}
            >
              + افزودن سرور دستی (vless, vmess, ss, ...)
            </button>
          ) : (
            <div className="manual-server-form">
              <textarea
                className="manual-server-input"
                placeholder="لینک سرور را اینجا بچسبانید&#10;vless://...&#10;vmess://...&#10;ss://..."
                value={manualInput}
                rows={3}
                onChange={(e) => { setManualInput(e.target.value); setManualError(null) }}
                dir="ltr"
                autoFocus
              />
              {manualError && (
                <div className="form-message form-message-error">{manualError}</div>
              )}
              <div className="manual-server-form-actions">
                <button
                  className="primary-button"
                  type="button"
                  disabled={manualAdding || !manualInput.trim()}
                  onClick={async () => {
                    const lines = manualInput.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean)
                    setManualAdding(true)
                    setManualError(null)
                    let lastError: string | null = null
                    for (const line of lines) {
                      const result = await onAddManualNode(line)
                      if (!result.success) lastError = result.error ?? 'خطا'
                    }
                    setManualAdding(false)
                    if (lastError) {
                      setManualError(lastError)
                    } else {
                      setManualInput('')
                      setShowManualInput(false)
                    }
                  }}
                >
                  {manualAdding ? 'در حال افزودن...' : 'افزودن'}
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => { setShowManualInput(false); setManualInput(''); setManualError(null) }}
                >
                  انصراف
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="server-sort-bar">
        {(['ping', 'name', 'protocol', 'reality'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`sort-chip${sortMode === mode ? ' sort-chip-active' : ''}`}
            onClick={() => { setSortMode(mode); localStorage.setItem('hamidsdeutsch:server-sort', mode) }}
          >
            {mode === 'ping' ? t('servers.sort.ping') : mode === 'name' ? t('servers.sort.name') : mode === 'protocol' ? t('servers.sort.protocol') : t('servers.sort.reality')}
          </button>
        ))}
      </div>

      <section className="server-list">
        {sortedNodes.map((node) => {
          const latencyResult =
            latencyResults[node.id] ?? null
          const configResult =
            configCheckResults[node.id] ?? null
          const isFastest =
            fastestServerId === node.id
          const isSelected =
            selectedServerId === node.id
          const isExpanded =
            expandedServerId === node.id
          const status =
            getServerStatus(node)
          const latencyBarPct = latencyResult?.reachable && latencyResult.latencyMs != null
            ? Math.min(latencyResult.latencyMs / 400 * 100, 100)
            : 0
          const isConnecting = subConnectingNodeId === node.id
          const isManual = node.subscriptionId === MANUAL_SUBSCRIPTION_ID

          return (
            <article
              className={[
                'server-list-item',
                isFastest
                  ? 'server-list-item-fastest'
                  : '',
                isSelected
                  ? 'server-list-item-selected'
                  : '',
                isConnecting
                  ? 'server-list-item-connecting'
                  : '',
                !node.valid
                  ? 'server-list-item-invalid'
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
              key={node.id}
              style={latencyBarPct > 0 ? { '--lat-pct': `${latencyBarPct}%`, '--lat-color': getLatencyColor(latencyResult?.latencyMs ?? null) } as React.CSSProperties : undefined}
            >
              <div className="server-list-row">
                <button
                  className="server-list-summary"
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={() => {
                    setExpandedServerId(
                      isExpanded ? null : node.id,
                    )
                  }}
                >
                  <span className="server-list-rank">
                    {isFastest ? '★' : '◉'}
                  </span>

                  <span className="server-list-name">
                    <strong>{node.name}</strong>
                    <small>
                      {node.subscriptionName}
                      {node.protocol && <ProtocolBadge protocol={node.protocol} />}
                    </small>
                  </span>

                  <LatencyBadge
                    latencyMs={
                      latencyResult?.latencyMs ?? null
                    }
                    testing={
                      latencyTesting &&
                      !latencyResult
                    }
                  />

                  <span
                    className={`server-list-status ${status.className}`}
                  >
                    {status.label}
                  </span>

                  {isSelected && (
                    <span className="server-selected-label">
                      {t('servers.selected')}
                    </span>
                  )}

                  <span className="server-expand-icon">
                    {isExpanded ? '⌃' : '⌄'}
                  </span>
                </button>
                <button
                  className={`server-list-connect-btn${isSelected && processRunning ? ' server-list-connect-btn-active' : ''}${isConnecting ? ' server-list-connect-btn-connecting' : ''}`}
                  type="button"
                  disabled={!node.valid || (subConnectingNodeId !== null && !isConnecting)}
                  title={isSelected && processRunning ? t('btn.disconnect') : t('servers.selectThis')}
                  onClick={() => {
                    // Already connected to THIS node → stop. Otherwise connect —
                    // prepareAndStart stops whatever is running first, then dials.
                    if (isSelected && processRunning) {
                      onStopConnection()
                    } else {
                      onConnectSubNode(node)
                    }
                  }}
                >
                  {isConnecting ? '◌' : isSelected && processRunning ? '■' : '▶'}
                </button>
              </div>

              {/* Connection progress inline */}
              {isConnecting && subConnectingStep && (
                <div className="server-connecting-progress">
                  <span className="server-connecting-spinner">◌</span>
                  <span className="server-connecting-text">{subConnectingStep}</span>
                </div>
              )}

              {isExpanded && (
                <div className="server-list-details">
                  <div className="server-detail-grid">
                    <ServerInformationRow
                      label={t('servers.address')}
                      value={node.host ?? t('servers.unknown')}
                      leftToRight
                    />
                    <ServerInformationRow
                      label={t('servers.port')}
                      value={
                        node.port
                          ? String(node.port)
                          : t('servers.unknown')
                      }
                    />
                    <ServerInformationRow
                      label="Protocol"
                      value={
                        formatProtocolNameForUi(
                          node.protocol,
                        )
                      }
                    />
                    <ServerInformationRow
                      label={t('servers.subscription')}
                      value={
                        node.subscriptionName
                      }
                    />
                    <ServerInformationRow
                      label={t('servers.transport')}
                      value={
                        node.transport ?? t('servers.unknown')
                      }
                    />
                    <ServerInformationRow
                      label={t('servers.security')}
                      value={
                        node.tls
                          ? node.security ?? 'TLS'
                          : t('servers.noTls')
                      }
                    />
                    <ServerInformationRow
                      label={t('servers.directDomains')}
                      value={`${directDomains.length} ${t('stats.domainCount')}`}
                    />
                  </div>

                  {configResult && (
                    <div
                      className={
                        configResult.success
                          ? 'config-check-result config-check-result-success'
                          : 'config-check-result config-check-result-error'
                      }
                    >
                      <strong>
                        {configResult.success
                          ? t('servers.configOk')
                          : t('servers.configFail')}
                      </strong>
                      <p>
                        {configResult.success
                          ? `${configResult.protocol ?? node.protocol} • ${configResult.directDomainCount} دامنه مستقیم`
                          : configResult.error ?? 'خطای نامشخص'}
                      </p>
                    </div>
                  )}

                  <div className="server-list-actions">
                    <button
                      className={
                        isSelected
                          ? 'select-server-button select-server-button-selected'
                          : 'select-server-button'
                      }
                      type="button"
                      disabled={!node.valid}
                      onClick={() => {
                        const pub = toPublicServer(node)
                        if (processRunning && !isSelected) {
                          setSwitchConfirm({ server: pub })
                        } else {
                          onSelectServer(pub)
                        }
                      }}
                    >
                      {isSelected
                        ? t('servers.selectedBtn')
                        : t('servers.selectThis')}
                    </button>

                    {node.subscriptionId && (
                      <button
                        className="inspect-subscription-button"
                        type="button"
                        disabled={
                          !node.valid ||
                          configCheckingNodeId ===
                            node.id
                        }
                        onClick={() => {
                          onCheckConfig(node)
                        }}
                      >
                        {configCheckingNodeId === node.id
                          ? t('servers.checking')
                          : t('servers.checkBtn')}
                      </button>
                    )}

                    <button
                      className="text-button manual-server-remove"
                      type="button"
                      onClick={async () => {
                        if (isManual) {
                          await onRemoveManualNode(node.nodeId)
                        } else {
                          await onHideNode(node.id)
                        }
                      }}
                    >
                      حذف سرور
                    </button>
                  </div>
                </div>
              )}
            </article>
          )
        })}
        </section>
        </>
      )}

      {switchConfirm && (
        <ConfirmDialog
          title={t('confirm.switchServer.title')}
          message={`${t('confirm.switchServer.message')} «${switchConfirm.server.name}»`}
          confirmLabel={t('confirm.switchServer.ok')}
          onConfirm={() => {
            onSelectServer(switchConfirm.server)
            setSwitchConfirm(null)
          }}
          onCancel={() => setSwitchConfirm(null)}
        />
      )}

    </div>
  )
}

function ServerInformationRow({
  label,
  value,
  leftToRight = false,
}: {
  label: string
  value: string
  leftToRight?: boolean
}) {
  return (
    <div className="server-information-row">
      <span>{label}</span>
      <strong
        dir={
          leftToRight
            ? 'ltr'
            : undefined
        }
      >
        {value}
      </strong>
    </div>
  )
}

function formatProtocolNameForUi(
  protocol: string,
) {
  const names: Record<string, string> = {
    vmess: 'VMess',
    vless: 'VLESS',
    trojan: 'Trojan',
    ss: 'Shadowsocks',
    hysteria: 'Hysteria',
    hysteria2: 'Hysteria 2',
    hy2: 'Hysteria 2',
    tuic: 'TUIC',
  }

  return names[protocol] ?? protocol
}

type DirectSitesPageProps = {
  domains: string[]
  onAddDomain: (
    rawInput: string,
  ) =>
    | {
        success: true
        domain: string
      }
    | {
        success: false
        error: string
      }
  onAddDomains: (
    rawInput: string,
  ) => {
    success: boolean
    added: string[]
    duplicates: string[]
    invalid: string[]
    total: number
    error: string | null
  }
  onRemoveDomain: (
    domain: string,
  ) => void
  onResetDomains: () => void
}

function SubInfoCard({ info }: {
  info: { upload: number | null; download: number | null; total: number | null; expire: string | null }
}) {
  const { lang } = useContext(LangCtx)
  const used = (info.upload ?? 0) + (info.download ?? 0)
  const total = info.total ?? 0
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : null
  function fmtGb(b: number | null) {
    if (b == null) return '—'
    if (b < 1e9) return `${(b / 1e6).toFixed(0)} MB`
    return `${(b / 1e9).toFixed(2)} GB`
  }
  const expireDate = info.expire ? new Date(info.expire) : null
  const daysLeft = expireDate ? Math.ceil((expireDate.getTime() - Date.now()) / 86400000) : null
  const remainGb = total > 0 ? Math.max(0, total - used) : null
  // Bar colour by how much is left (gold → amber → red as it depletes).
  const barColor = pct === null ? 'var(--gold)' : pct < 70 ? 'var(--green)' : pct < 90 ? 'var(--gold)' : 'var(--red)'
  const dayColor = daysLeft === null ? 'var(--text-soft)' : daysLeft <= 0 ? 'var(--red)' : daysLeft <= 3 ? 'var(--red)' : daysLeft <= 7 ? 'var(--gold)' : 'var(--green)'
  if (pct === null && daysLeft === null) return null
  return (
    <div className="sub-info-card">
      {pct !== null && (
        <div className="sub-info-usage">
          <div className="sub-info-usage-head">
            <span className="sub-info-label">{lang === 'fa' ? 'حجم باقی‌مانده' : 'Data left'}</span>
            <strong dir="ltr">{fmtGb(remainGb)} <span className="sub-info-of">/ {fmtGb(total)}</span></strong>
          </div>
          <div className="sub-info-bar">
            <div className="sub-info-bar-fill" style={{ width: `${100 - pct}%`, background: barColor }} />
          </div>
        </div>
      )}
      {daysLeft !== null && (
        <div className="sub-info-days" style={{ color: dayColor, borderColor: 'color-mix(in srgb, currentColor 32%, transparent)' }}>
          <span className="sub-info-days-num" dir="ltr">{daysLeft > 0 ? daysLeft : 0}</span>
          <span className="sub-info-days-label">{daysLeft > 0 ? (lang === 'fa' ? 'روز مانده' : 'days left') : (lang === 'fa' ? 'منقضی' : 'expired')}</span>
        </div>
      )}
    </div>
  )
}

function SubscriptionInspectionPanel({
  inspection,
}: {
  inspection: SubscriptionInspection
}) {
  return (
    <div
      className={
        inspection.success
          ? 'subscription-inspection subscription-inspection-success'
          : 'subscription-inspection subscription-inspection-error'
      }
    >
      <div className="inspection-heading">
        <strong>
          {inspection.success
            ? 'نتیجه بررسی موفق'
            : 'بررسی ناموفق'}
        </strong>

        <span>
          {formatInspectionDate(
            inspection.checkedAt,
          )}
        </span>
      </div>

      <div className="inspection-grid">
        <InspectionValue
          label="وضعیت HTTP"
          value={
            inspection.httpStatus
              ? String(
                  inspection.httpStatus,
                )
              : '—'
          }
        />

        <InspectionValue
          label="نوع محتوا"
          value={formatSubscriptionFormat(
            inspection.format,
          )}
        />

        <InspectionValue
          label="تعداد کانفیگ"
          value={String(
            inspection.configCount,
          )}
        />

        <InspectionValue
          label="حجم پاسخ"
          value={formatByteSize(
            inspection.responseSize,
          )}
        />
      </div>

      {inspection.contentType && (
        <p
          className="inspection-content-type"
          dir="ltr"
        >
          {inspection.contentType}
        </p>
      )}

      {inspection.error && (
        <p className="inspection-error-message">
          {inspection.error}
        </p>
      )}
    </div>
  )
}

function InspectionValue({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="inspection-value">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function formatByteSize(
  bytes: number | null,
) {
  if (bytes === null) {
    return '—'
  }

  if (bytes < 1024) {
    return `${bytes} بایت`
  }

  if (bytes < 1024 * 1024) {
    return `${(
      bytes / 1024
    ).toFixed(1)} کیلوبایت`
  }

  return `${(
    bytes /
    (1024 * 1024)
  ).toFixed(2)} مگابایت`
}

function formatSubscriptionFormat(
  format: string,
) {
  const labels: Record<string, string> = {
    'uri-list': 'فهرست لینک‌ها',
    'base64-uri-list':
      'فهرست Base64',
    json: 'JSON',
    'base64-json':
      'JSON رمزگذاری‌شده',
    'base64-unknown':
      'Base64 ناشناخته',
    unknown: 'ناشناخته',
    empty: 'خالی',
    timeout: 'پایان زمان',
    'http-error': 'خطای HTTP',
    'network-error': 'خطای شبکه',
    'internal-error': 'خطای داخلی',
    'renderer-error': 'خطای رابط',
  }

  return labels[format] ?? format
}

function formatInspectionDate(
  isoDate: string,
) {
  try {
    return new Intl.DateTimeFormat(
      activeLocale(),
      {
        hour: '2-digit',
        minute: '2-digit',
      },
    ).format(new Date(isoDate))
  } catch {
    return 'همین حالا'
  }
}

function NetworkRepairRow({ lang }: { lang: 'fa' | 'en' }) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function repair() {
    if (busy) return
    setBusy(true)
    setDone(false)
    setError(null)
    try {
      const result = await window.hamidsDeutsch.network.repair()
      if (result.success) {
        setDone(true)
        setTimeout(() => setDone(false), 4000)
      } else {
        const failed = Object.entries(result.steps)
          .filter(([, succeeded]) => !succeeded)
          .map(([step]) => step)
          .join(', ')
        setError(
          lang === 'fa'
            ? `تعمیر کامل نشد: ${failed || 'خطای نامشخص'}`
            : `Repair was incomplete: ${failed || 'unknown error'}`,
        )
      }
    } catch (repairError) {
      setError(
        repairError instanceof Error
          ? repairError.message
          : lang === 'fa'
            ? 'تعمیر شبکه ناموفق بود.'
            : 'Network repair failed.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="setting-row">
      <div className="setting-title-with-info">
        <strong>{lang === 'fa' ? 'تعمیر شبکه' : 'Repair network'}</strong>
        <InfoButton
          fa="اگر بعد از یک قطع ناگهانی، سرورهای اشتراک لود نمی‌شوند یا اتصال روی «تعیین IP» می‌ماند، این ابزار پروکسی گیرکرده ویندوز را پاک می‌کند، موتورهای باقی‌مانده را می‌بندد و قفل اضطراری را برمی‌دارد."
          en='If subscriptions will not load or a connection hangs on "verifying IP" after a hard stop, this clears a stuck Windows proxy, closes orphan engines, and lifts the emergency block.'
        />
      </div>
      <button className="secondary-button" type="button" onClick={() => void repair()} disabled={busy}>
        <BrandIcon name={done ? 'check' : 'repair'} size={16} />
        {busy ? (lang === 'fa' ? 'در حال تعمیر…' : 'Repairing…') : done ? (lang === 'fa' ? 'انجام شد' : 'Done') : (lang === 'fa' ? 'اجرا' : 'Run')}
      </button>
      {error && <span className="setting-row-error" role="alert">{error}</span>}
    </div>
  )
}

type SplitApp = { name: string; processName: string; path: string; icon: string | null }

function SplitTunnelSection() {
  const { lang } = useContext(LangCtx)
  const [apps, setApps] = useState<SplitApp[]>([])
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    void window.hamidsDeutsch.apps.list().then(setApps).catch(() => {})
  }, [])

  async function handleAdd() {
    if (adding) return
    setAdding(true)
    try {
      const r = await window.hamidsDeutsch.apps.add()
      if (r?.apps) setApps(r.apps)
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(processName: string) {
    const r = await window.hamidsDeutsch.apps.remove(processName)
    if (r?.apps) setApps(r.apps)
  }

  return (
    <section className="panel-card split-tunnel-card">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">{lang === 'fa' ? 'اتصال با فیلتر' : 'Filtered connection'}</span>
          <h3>{lang === 'fa' ? 'برنامه‌های بدون تونل' : 'Apps that bypass the VPN'}</h3>
        </div>
        <span className="count-badge">{apps.length}</span>
      </div>

      <p className="split-tunnel-desc">
        {lang === 'fa'
          ? 'کل ترافیک از VPN رد می‌شود، به‌جز برنامه‌هایی که این‌جا اضافه می‌کنی (مثل اپ‌های بانکی یا سرویس‌های داخلی). فقط در حالت TUN اعمال می‌شود.'
          : 'All traffic goes through the VPN except the apps you add here (e.g. banking or local services). Applies in TUN mode only.'}
      </p>

      <button className="split-add-btn" type="button" onClick={() => void handleAdd()} disabled={adding}>
        <span className="split-add-icon">＋</span>
        {adding ? (lang === 'fa' ? 'در حال افزودن…' : 'Adding…') : (lang === 'fa' ? 'افزودن برنامه' : 'Add app')}
      </button>

      {apps.length === 0 ? (
        <div className="split-empty">
          <div className="split-empty-icon">🧩</div>
          <p>{lang === 'fa' ? 'هنوز برنامه‌ای اضافه نشده' : 'No apps added yet'}</p>
        </div>
      ) : (
        <div className="split-app-grid">
          {apps.map((a) => (
            <div className="split-app-chip" key={a.processName} title={a.path}>
              {a.icon ? <img className="split-app-icon" src={a.icon} alt="" /> : <span className="split-app-icon split-app-icon-fallback">▣</span>}
              <span className="split-app-name">{a.name}</span>
              <button className="split-app-remove" type="button" aria-label="remove" onClick={() => void handleRemove(a.processName)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function DirectSitesPage({
  domains,
  onAddDomain,
  onAddDomains,
  onRemoveDomain,
  onResetDomains,
}: DirectSitesPageProps) {
  const t = useT()
  const [domainInput, setDomainInput] =
    useState('')

  const [bulkDomainInput, setBulkDomainInput] =
    useState('')

  const [message, setMessage] =
    useState<{
      type: 'success' | 'error'
      text: string
    } | null>(null)

  function handleAddDomain() {
    const result =
      onAddDomain(domainInput)

    if (!result.success) {
      setMessage({
        type: 'error',
        text: result.error,
      })
      return
    }

    setDomainInput('')
    setMessage({
      type: 'success',
      text: `${result.domain} به فهرست سایت‌های مستقیم اضافه شد.`,
    })
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
  ) {
    if (event.key === 'Enter') {
      handleAddDomain()
    }
  }

  function handleAddDomains() {
    const result =
      onAddDomains(
        bulkDomainInput,
      )

    if (
      result.added.length === 0
    ) {
      setMessage({
        type: 'error',
        text:
          result.error ??
          'هیچ دامنه جدیدی اضافه نشد.',
      })
      return
    }

    setBulkDomainInput('')

    const details = [
      `${result.added.length.toLocaleString(
        'fa-IR',
      )} دامنه اضافه شد.`,
    ]

    if (
      result.duplicates.length > 0
    ) {
      details.push(
        `${result.duplicates.length.toLocaleString(
          'fa-IR',
        )} مورد تکراری نادیده گرفته شد.`,
      )
    }

    if (
      result.invalid.length > 0
    ) {
      details.push(
        `${result.invalid.length.toLocaleString(
          'fa-IR',
        )} مورد نامعتبر بود.`,
      )
    }

    setMessage({
      type: 'success',
      text:
        details.join(' '),
    })
  }

  function handleRemoveDomain(
    domain: string,
  ) {
    onRemoveDomain(domain)

    setMessage({
      type: 'success',
      text: `${domain} از فهرست حذف شد.`,
    })
  }

  function handleResetDomains() {
    onResetDomains()

    setMessage({
      type: 'success',
      text: 'فهرست اولیه سایت‌های مستقیم بازیابی شد.',
    })
  }

  return (
    <div className="page-stack">
      <SplitTunnelSection />
      <section className="panel-card">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">
              {t('direct.add.kicker')}
            </span>
            <h3>
              {t('direct.add.title')}
            </h3>
          </div>

          <span className="count-badge">
            {domains.length} دامنه
          </span>
        </div>

        <div className="input-action-row">
          <input
            className="text-input"
            dir="ltr"
            placeholder="https://example.ir یا example.ir"
            type="text"
            value={domainInput}
            onChange={(event) => {
              setDomainInput(
                event.target.value,
              )
              setMessage(null)
            }}
            onKeyDown={handleKeyDown}
          />

          <button
            className="primary-button"
            type="button"
            onClick={handleAddDomain}
          >
            {t('direct.add.btn')}
          </button>

          <InfoButton
            fa="می‌توانی آدرس را با https، بدون https، همراه مسیر کامل یا با پیشوند domain وارد کنی. برنامه نام دامنه را خودکار استخراج می‌کند."
            en="You can enter the address with or without https, as a full URL, or with a domain: prefix. The app automatically extracts the domain name."
          />
        </div>

        <div className="bulk-domain-import">
          <div className="bulk-domain-heading">
            <div>
              <strong>
                {t('direct.bulk.title')}
              </strong>
              <span>
                {t('direct.bulk.desc')}
              </span>
            </div>
          </div>

          <textarea
            className="bulk-domain-textarea"
            dir="ltr"
            rows={9}
            spellCheck={false}
            value={
              bulkDomainInput
            }
            placeholder={`domain:intrack.ir,
domain:eghamat24.com,
domain:aparatsport.ir,
domain:hamidrezasaadati.com`}
            onChange={(event) => {
              setBulkDomainInput(
                event.target.value,
              )
              setMessage(null)
            }}
          />

          <div className="bulk-footer-row">
            <button
              className="secondary-button bulk-domain-button"
              type="button"
              disabled={
                !bulkDomainInput.trim()
              }
              onClick={
                handleAddDomains
              }
            >
              {t('direct.bulk.btn')}
            </button>
            <InfoButton
              fa="پیشوندهای domain:، آدرس کامل با https، ویرگول انتهای خط و خطوط خالی خودکار پاک می‌شوند. موارد تکراری دوباره ثبت نخواهند شد."
              en="domain: prefixes, full https URLs, trailing commas, and blank lines are stripped automatically. Duplicates are ignored."
            />
          </div>
        </div>

        {message && (
          <div
            className={
              message.type === 'success'
                ? 'form-message form-message-success'
                : 'form-message form-message-error'
            }
          >
            {message.text}
          </div>
        )}
      </section>

      <section className="panel-card">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">
              مسیر مستقیم
            </span>
            <h3>{t('direct.list.title')}</h3>
          </div>

          <button
            className="text-button"
            type="button"
            onClick={handleResetDomains}
          >
            {t('direct.list.reset')}
          </button>
        </div>

        {domains.length > 0 ? (
          <div className="domain-management-list">
            {domains.map((domain) => (
              <div
                className="domain-management-item"
                key={domain}
              >
                <div className="domain-management-main">
                  <span className="domain-preview-check">
                    ✓
                  </span>

                  <div>
                    <strong dir="ltr">
                      {domain}
                    </strong>
                    <span>
                      {t('direct.list.scope')}
                    </span>
                  </div>
                </div>

                <div className="domain-management-actions">
                  <span className="direct-badge">
                    {t('direct.list.direct')}
                  </span>

                  <button
                    className="remove-domain-button"
                    type="button"
                    onClick={() =>
                      handleRemoveDomain(
                        domain,
                      )
                    }
                  >
                    {t('direct.list.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-domain-list">
            <span>↗</span>
            <strong>
              {t('direct.empty.title')}
            </strong>
            <p>
              {t('direct.empty.desc')}
            </p>
          </div>
        )}
      </section>
    </div>
  )
}

function RescuePage({
  settings,
  onUpdate,
  onReset,
  connected,
}: {
  settings: {
    enabled: boolean
    recordFragment: boolean
    handshakeFragment: boolean
    fragmentFallbackDelay: string
    customSni: string
    dpiBypassAuto: boolean
  }
  onUpdate: (
    patch: Partial<{
      enabled: boolean
      recordFragment: boolean
      handshakeFragment: boolean
      fragmentFallbackDelay: string
      customSni: string
      dpiBypassAuto: boolean
    }>,
  ) => void
  onReset: () => void
  connected: boolean
}) {
  const t = useT()
  const { lang } = useContext(LangCtx)
  return (
    <div className="page-stack">
      <section className="rescue-header-card active-rescue-header">
        <span className="rescue-header-icon"><BrandIcon name="shield" size={22} /></span>

        <div>
          <span className="panel-kicker">
            {lang === 'fa' ? 'اتصال اضطراری' : 'Emergency Connection'}
          </span>
          <h2>
            {t('rescue.title')}
          </h2>
          <p>
            این گزینه‌ها فقط هنگام ساخت اتصال جدید
            اعمال می‌شوند. برای تغییر حالت، ابتدا
            اتصال فعلی را قطع و دوباره وصل کن.
          </p>
        </div>

        <label className="rescue-master-switch">
          <input
            type="checkbox"
            checked={
              settings.enabled
            }
            onChange={(event) =>
              onUpdate({
                enabled:
                  event.target
                    .checked,
              })
            }
          />
          <span>
            {settings.enabled
              ? t('rescue.enabled')
              : t('rescue.disabled')}
          </span>
        </label>
      </section>

      {connected && (
        <div className="inline-notice">
          اتصال فعلی با تنظیمات قبلی اجرا شده است؛
          برای اعمال تغییرات یک‌بار قطع و وصل کن.
        </div>
      )}

      <section className="rescue-settings-grid">
        <article className="rescue-setting-card">
          <div className="rescue-setting-heading">
            <div>
              <span className="rescue-setting-badge">
                {t('rescue.suggested')}
              </span>
              <h3>
                TLS Record Fragment
              </h3>
            </div>

            <label className="compact-switch">
              <input
                type="checkbox"
                disabled={
                  !settings.enabled
                }
                checked={
                  settings.recordFragment
                }
                onChange={(event) =>
                  onUpdate({
                    recordFragment:
                      event.target
                        .checked,
                  })
                }
              />
              <span />
            </label>
          </div>

          <p>
            ClientHello را در چند TLS Record تقسیم
            می‌کند. این روش سبک‌تر است و قبل از
            Fragment کامل پیشنهاد می‌شود.
          </p>
        </article>

        <article className="rescue-setting-card">
          <div className="rescue-setting-heading">
            <div>
              <span className="rescue-setting-badge secondary">
                {t('rescue.advanced')}
              </span>
              <h3>
                TLS Handshake Fragment
              </h3>
            </div>

            <label className="compact-switch">
              <input
                type="checkbox"
                disabled={
                  !settings.enabled
                }
                checked={
                  settings.handshakeFragment
                }
                onChange={(event) =>
                  onUpdate({
                    handshakeFragment:
                      event.target
                        .checked,
                  })
                }
              />
              <span />
            </label>
          </div>

          <p>
            بسته‌های Handshake را در سطح TCP تقسیم
            می‌کند. ممکن است سرعت را کاهش دهد؛ فقط
            وقتی Record Fragment کافی نیست فعالش کن.
          </p>

          <label className="rescue-field">
            <span>
              {t('rescue.fallbackDelay')}
            </span>
            <select
              disabled={
                !settings.enabled ||
                !settings.handshakeFragment
              }
              value={
                settings.fragmentFallbackDelay
              }
              onChange={(event) =>
                onUpdate({
                  fragmentFallbackDelay:
                    event.target.value,
                })
              }
            >
              <option value="100ms">
                100 ms
              </option>
              <option value="250ms">
                250 ms
              </option>
              <option value="500ms">
                500 ms
              </option>
              <option value="1s">
                {t('rescue.sec1')}
              </option>
            </select>
          </label>
        </article>

        <article className="rescue-setting-card rescue-sni-card">
          <div className="rescue-setting-heading">
            <div>
              <span className="rescue-setting-badge caution">
                {t('rescue.optional')}
              </span>
              <h3>
                SNI سفارشی
              </h3>
            </div>
          </div>

          <p>
            فقط زمانی وارد کن که سرویس‌دهنده سرور
            یک SNI جایگزین معتبر داده باشد. مقدار
            اشتباه باعث شکست TLS می‌شود.
          </p>

          <label className="rescue-field">
            <span>
              {t('rescue.sniLabel')}
            </span>
            <input
              type="text"
              dir="ltr"
              disabled={
                !settings.enabled
              }
              value={
                settings.customSni
              }
              placeholder="example.com"
              onChange={(event) =>
                onUpdate({
                  customSni:
                    event.target.value,
                })
              }
            />
          </label>
        </article>

        <article className="rescue-setting-card rescue-dpi-card">
          <div className="rescue-setting-heading">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div>
                <span className="rescue-setting-badge caution">
                  {t('rescue.dpiBypass.badge')}
                </span>
                <h3>
                  {t('rescue.dpiBypass.title')}
                </h3>
              </div>
              <InfoButton
                fa={t('rescue.dpiBypass.tooltip')}
                en={t('rescue.dpiBypass.tooltip')}
              />
            </div>

            <label className="compact-switch">
              <input
                type="checkbox"
                checked={
                  settings.dpiBypassAuto
                }
                onChange={(event) =>
                  onUpdate({
                    dpiBypassAuto:
                      event.target.checked,
                  })
                }
              />
              <span />
            </label>
          </div>

          <p>
            {t('rescue.dpiBypass.desc')}
          </p>
        </article>
      </section>

      <section className="rescue-summary-card">
        <div>
          <span className="panel-kicker">
            {lang === 'fa' ? 'پروفایل فعلی' : 'Current Profile'}
          </span>
          <h3>
            وضعیت پروفایل نجات
          </h3>
        </div>

        <div className="rescue-summary-items">
          <span>
            Record Fragment:
            <strong>
              {settings.enabled &&
              settings.recordFragment
                ? ` ${t('rescue.on')}`
                : ` ${t('rescue.off')}`}
            </strong>
          </span>

          <span>
            Handshake Fragment:
            <strong>
              {settings.enabled &&
              settings.handshakeFragment
                ? ` ${t('rescue.on')}`
                : ` ${t('rescue.off')}`}
            </strong>
          </span>

          <span>
            SNI:
            <strong dir="ltr">
              {settings.enabled &&
              settings.customSni
                ? ` ${settings.customSni}`
                : ` ${t('rescue.auto')}`}
            </strong>
          </span>

          <span>
            {t('rescue.dpiBypass.summary')}:
            <strong>
              {settings.dpiBypassAuto
                ? ` ${t('rescue.on')}`
                : ` ${t('rescue.off')}`}
            </strong>
          </span>
        </div>

        <button
          className="secondary-button"
          type="button"
          onClick={onReset}
        >
          {t('rescue.reset')}
        </button>
      </section>
    </div>
  )
}

function ActivityPage({
  summary,
  sessions,
  events,
  onClear,
  onCopyReport,
}: {
  summary: {
    successfulSessions: number
    failedAttempts: number
    totalDurationMs: number
    tunSessions: number
  }
  sessions: React.ComponentProps<typeof StatisticsPage>['sessions']
  events: React.ComponentProps<typeof LogsPage>['events']
  onClear: () => void
  onCopyReport: () => Promise<void>
}) {
  const t = useT()
  const { lang } = useContext(LangCtx)
  const numberLocale = lang === 'fa' ? 'fa-IR' : 'en-US'

  // Sessions and the event log answer different questions about the same
  // history, so they share one page and one set of totals rather than sitting
  // in two tabs that each tell half the story.
  const [view, setView] = useState<'sessions' | 'log'>('sessions')

  const views = [
    { id: 'sessions' as const, label: t('activity.view.sessions'), count: sessions.length },
    { id: 'log' as const, label: t('activity.view.log'), count: events.length },
  ]

  return (
    <div className="page-stack">
        <section className="quick-statistics">
          <article className="statistic-card">
            <span className="statistic-icon" aria-hidden="true">
              ✓
            </span>
            <div>
              <span className="statistic-label">
                {t('stats2.success')}
              </span>
              <strong>
                {summary.successfulSessions.toLocaleString(numberLocale)}
              </strong>
            </div>
          </article>

          <article className="statistic-card">
            <span className="statistic-icon" aria-hidden="true">
              !
            </span>
            <div>
              <span className="statistic-label">
                {t('stats2.failed')}
              </span>
              <strong>
                {summary.failedAttempts.toLocaleString(numberLocale)}
              </strong>
            </div>
          </article>

          <article className="statistic-card">
            <span className="statistic-icon" aria-hidden="true">
              ◷
            </span>
            <div>
              <span className="statistic-label">
                {t('stats2.totalTime')}
              </span>
              <strong>
                {formatDuration(
                  summary.totalDurationMs,
                )}
              </strong>
            </div>
          </article>

          <article className="statistic-card">
            <span className="statistic-icon" aria-hidden="true">
              T
            </span>
            <div>
              <span className="statistic-label">
                {t('stats2.tunSessions')}
              </span>
              <strong>
                {summary.tunSessions.toLocaleString(numberLocale)}
              </strong>
            </div>
          </article>
        </section>

      <div className="activity-switch" role="tablist" aria-label={t('page.activity')}>
        {views.map((item) => (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={view === item.id}
            className={`activity-switch-btn${view === item.id ? ' is-active' : ''}`}
            onClick={() => setView(item.id)}
          >
            <span>{item.label}</span>
            <span className="activity-switch-count">
              {item.count.toLocaleString(numberLocale)}
            </span>
          </button>
        ))}
      </div>

      {view === 'sessions'
        ? <StatisticsPage sessions={sessions} />
        : <LogsPage events={events} onClear={onClear} onCopyReport={onCopyReport} />}
    </div>
  )
}

function StatisticsPage({
  sessions,
}: {
  sessions: Array<{
    id: string
    startedAt: string
    endedAt: string | null
    serverName: string
    subscriptionName: string
    mode:
      | 'tun'
      | 'system-proxy'
    latencyMs: number | null
    exitIp: string | null
    endReason:
      | 'manual'
      | 'connection-lost'
      | 'application'
      | null
  }>
}) {
  const t = useT()
  const { lang } = useContext(LangCtx)
  const numberLocale = lang === 'fa' ? 'fa-IR' : 'en-US'
  const recentSessions =
    sessions.slice(0, 10)

  return (
    <div className="page-stack">

      <section className="panel-card">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">
              Connection History
            </span>
            <h3>
              {t('stats2.recent')}
            </h3>
          </div>

          <span className="count-badge">
            {sessions.length.toLocaleString(numberLocale)} {t('stats2.sessions')}
          </span>
        </div>

        {recentSessions.length === 0 ? (
          <EmptyPage
            icon="▥"
            title={t('stats2.noSessions')}
            description={t('stats2.noSessionsDesc')}
          />
        ) : (
          <div className="diagnostic-session-list">
            {recentSessions.map(
              (session) => (
                <article
                  className="diagnostic-session-row"
                  key={
                    session.id
                  }
                >
                  <div>
                    <strong>
                      {session.serverName}
                    </strong>
                    <span>
                      {
                        session.subscriptionName
                      }
                    </span>
                  </div>

                  <div className="diagnostic-session-meta">
                    <span>
                      {session.mode ===
                      'tun'
                        ? 'TUN'
                        : 'System Proxy'}
                    </span>
                    <span>
                      {formatSessionDuration(
                        session.startedAt,
                        session.endedAt,
                      )}
                    </span>
                    <span>
                      {session.latencyMs !==
                      null
                        ? `${session.latencyMs.toLocaleString(numberLocale)} ms`
                        : t('stats2.noPing')}
                    </span>
                    <span>
                      {session.endedAt
                        ? formatLocalDateTime(
                            session.endedAt,
                          )
                        : t('stats2.connecting')}
                    </span>
                  </div>
                </article>
              ),
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function LogsPage({
  events,
  onClear,
  onCopyReport,
}: {
  events: Array<{
    id: string
    timestamp: string
    level:
      | 'info'
      | 'success'
      | 'warning'
      | 'error'
    type: string
    message: string
    serverName: string | null
    subscriptionName: string | null
    mode:
      | 'tun'
      | 'system-proxy'
      | null
    latencyMs: number | null
  }>
  onClear: () => void
  onCopyReport: () =>
    Promise<void>
}) {
  const t = useT()
  const [copied, setCopied] =
    useState(false)

  async function copyReport() {
    await onCopyReport()
    setCopied(true)

    window.setTimeout(() => {
      setCopied(false)
    }, 1800)
  }

  return (
    <section className="panel-card log-panel">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">
            Application Diagnostics
          </span>
          <h3>
            {t('logs.title')}
          </h3>
        </div>

        <div className="log-actions">
          <InfoButton
            fa="این گزارش شامل URI، UUID، رمز، کلید یا نشانی اشتراک نیست و فقط وضعیت عملیاتی اتصال را نگه می‌دارد."
            en="This log contains no URIs, UUIDs, passwords, keys, or subscription URLs — only operational connection status is recorded."
          />

          <button
            className="secondary-button"
            type="button"
            disabled={
              events.length === 0
            }
            onClick={() => {
              void copyReport()
            }}
          >
            {copied
              ? t('logs.copied')
              : t('logs.copy')}
          </button>

          <button
            className="text-button"
            type="button"
            disabled={
              events.length === 0
            }
            onClick={onClear}
          >
            {t('logs.clear')}
          </button>
        </div>
      </div>

      {events.length === 0 ? (
        <EmptyPage
          icon="▤"
          title={t('logs.empty.title')}
          description={t('logs.empty.desc')}
        />
      ) : (
        <div className="diagnostic-log-list">
          {events.map(
            (event) => (
              <article
                className={`diagnostic-log-row diagnostic-log-${event.level}`}
                key={event.id}
              >
                <div className="diagnostic-log-level">
                  {formatDiagnosticLevel(
                    event.level,
                  )}
                </div>

                <div className="diagnostic-log-content">
                  <strong>
                    {event.message}
                  </strong>

                  <div>
                    <span>
                      {formatLocalDateTime(
                        event.timestamp,
                      )}
                    </span>

                    {event.serverName && (
                      <span>
                        {event.serverName}
                      </span>
                    )}

                    {event.subscriptionName && (
                      <span>
                        {
                          event.subscriptionName
                        }
                      </span>
                    )}

                    {event.mode && (
                      <span>
                        {event.mode ===
                        'tun'
                          ? 'TUN'
                          : 'System Proxy'}
                      </span>
                    )}

                    {event.latencyMs !==
                      null && (
                      <span>
                        {event.latencyMs.toLocaleString(activeLocale())}{' '}
                        ms
                      </span>
                    )}
                  </div>
                </div>
              </article>
            ),
          )}
        </div>
      )}
    </section>
  )
}

function formatDiagnosticLevel(
  level:
    | 'info'
    | 'success'
    | 'warning'
    | 'error',
) {
  if (level === 'success') {
    return 'موفق'
  }

  if (level === 'warning') {
    return 'هشدار'
  }

  if (level === 'error') {
    return 'خطا'
  }

  return 'اطلاع'
}

function formatDuration(
  durationMs: number,
) {
  const totalSeconds =
    Math.floor(
      durationMs / 1000,
    )

  const hours =
    Math.floor(
      totalSeconds / 3600,
    )

  const minutes =
    Math.floor(
      (
        totalSeconds % 3600
      ) / 60,
    )

  const seconds =
    totalSeconds % 60

  return [
    hours,
    minutes,
    seconds,
  ]
    .map((value) =>
      value
        .toString()
        .padStart(2, '0'),
    )
    .join(':')
}

function formatSessionDuration(
  startedAt: string,
  endedAt: string | null,
) {
  const started =
    new Date(
      startedAt,
    ).getTime()

  const ended =
    endedAt
      ? new Date(
          endedAt,
        ).getTime()
      : Date.now()

  return formatDuration(
    Math.max(
      0,
      ended - started,
    ),
  )
}

function formatLocalDateTime(
  value: string,
) {
  return new Intl.DateTimeFormat(
    activeLocale(),
    {
      dateStyle: 'short',
      timeStyle: 'medium',
    },
  ).format(
    new Date(value),
  )
}

function SettingsPage({
  settings,
  onUpdate,
  onReset,
  directDomainCount: _directDomainCount,
  administratorAvailable,
  connected,
  onOpenDirectSites: _onOpenDirectSites,
  onOpenVirtualLocationExtension,
  onDownloadExtensionZip,
  currentEngineVersion,
  onCheckEngineUpdate,
  onInstallEngineUpdate,
  ctrlEnterEnabled,
  onCtrlEnterToggle,
  closeToTray,
  onCloseToTrayToggle,
  killSwitch,
  killSwitchAvailable,
  onKillSwitchToggle,
  autoUpdateEnabled,
  updateState,
  onAutoUpdateToggle,
  onCheckAppUpdate,
  onDownloadAppUpdate,
  onInstallAppUpdate,
  standaloneDoH,
  standaloneDoHLoading,
  customDnsPrimary,
  customDnsSecondary,
  dnsApplyError,
  customDnsProfiles,
  onSaveDnsProfile,
  onRemoveDnsProfile,
  onCustomDnsChange,
  onStandaloneDoHChange,
  proxyDoH,
  onProxyDoHToggle,
  utlsHardened,
  onHardenTls,
}: {
  settings: {
    engine: 'xray' | 'sing-box'
    mode:
      | 'auto'
      | 'tun'
      | 'system-proxy'
    allowFallback: boolean
  }
  onUpdate: (
    patch: Partial<{
      engine: 'xray' | 'sing-box'
      mode:
        | 'auto'
        | 'tun'
        | 'system-proxy'
      allowFallback: boolean
    }>,
  ) => void
  onReset: () => void
  directDomainCount: number
  administratorAvailable: boolean
  connected: boolean
  onOpenDirectSites: () => void
  onOpenVirtualLocationExtension: () =>
    Promise<{
      success: boolean
      path: string
      error: string | null
    }>
  onDownloadExtensionZip: () =>
    Promise<{
      success: boolean
      path?: string
      error: string | null
    }>
  currentEngineVersion:
    | string
    | null
  onCheckEngineUpdate: () =>
    Promise<{
      success: boolean
      currentVersion: string | null
      latestVersion: string | null
      updateAvailable: boolean
      publishedAt: string | null
      releaseUrl: string | null
      assetName: string | null
      assetUrl: string | null
      assetDigest: string | null
      error: string | null
    }>
  onInstallEngineUpdate: () =>
    Promise<{
      success: boolean
      updated: boolean
      currentVersion: string | null
      latestVersion: string | null
      installedVersion: string | null
      message: string | null
      error: string | null
    }>
  ctrlEnterEnabled: boolean
  onCtrlEnterToggle: (v: boolean) => void
  closeToTray: boolean
  onCloseToTrayToggle: (v: boolean) => Promise<void>
  killSwitch: boolean
  killSwitchAvailable: boolean
  onKillSwitchToggle: (v: boolean) => Promise<void>
  autoUpdateEnabled: boolean
  updateState: {
    phase: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'
    availableVersion: string | null
    percent: number
    error: string | null
    retryAfterConnection: boolean
    lastCheckedAt: string | null
  }
  onAutoUpdateToggle: (v: boolean) => Promise<void>
  onCheckAppUpdate: () => Promise<unknown>
  onDownloadAppUpdate: () => Promise<unknown>
  onInstallAppUpdate: () => Promise<unknown>
  standaloneDoH: 'off' | 'cloudflare-smart' | 'cloudflare' | 'cloudflare-family' | 'google' | 'adguard' | 'shecan' | 'radar' | 'electro' | 'custom'
  standaloneDoHLoading: boolean
  customDnsPrimary: string
  customDnsSecondary: string
  dnsApplyError: string | null
  customDnsProfiles: DnsProfile[]
  onSaveDnsProfile: (profile: { name: string; primary: string; secondary: string }) => void
  onRemoveDnsProfile: (id: string) => void
  onCustomDnsChange: (primary: string, secondary: string) => void
  onStandaloneDoHChange: (
    server: 'off' | 'cloudflare-smart' | 'cloudflare' | 'cloudflare-family' | 'google' | 'adguard' | 'shecan' | 'radar' | 'electro' | 'custom',
    primary?: string,
    secondary?: string,
  ) => Promise<void>
  proxyDoH: boolean
  onProxyDoHToggle: (v: boolean) => Promise<void>
  utlsHardened: boolean
  onHardenTls: () => Promise<boolean>
}) {
  const t = useT()
  const [
    extensionMessage,
    setExtensionMessage,
  ] = useState<{
    type:
      | 'success'
      | 'error'
    text: string
  } | null>(null)

  const [
    openingExtensionFolder,
    setOpeningExtensionFolder,
  ] = useState(false)

  const [
    downloadingExtensionZip,
    setDownloadingExtensionZip,
  ] = useState(false)

  const [
    engineUpdateState,
    setEngineUpdateState,
  ] = useState<{
    checking: boolean
    installing: boolean
    latestVersion: string | null
    installedVersion: string | null
    updateAvailable: boolean
    message: string | null
    error: string | null
  }>({
    checking: false,
    installing: false,
    latestVersion: null,
    installedVersion:
      currentEngineVersion,
    updateAvailable: false,
    message: null,
    error: null,
  })

  async function checkEngineUpdate() {
    if (
      engineUpdateState.checking ||
      engineUpdateState.installing
    ) {
      return
    }

    setEngineUpdateState(
      (current) => ({
        ...current,
        checking: true,
        message: null,
        error: null,
      }),
    )

    const result =
      await onCheckEngineUpdate()

    setEngineUpdateState(
      (current) => ({
        ...current,
        checking: false,
        latestVersion:
          result.latestVersion,
        installedVersion:
          result.currentVersion ??
          current.installedVersion,
        updateAvailable:
          result.updateAvailable,
        message:
          result.success
            ? result.updateAvailable
              ? t('settings.engine.updateAvailable')
              : t('settings.engine.upToDate')
            : null,
        error:
          result.error,
      }),
    )
  }

  async function installEngineUpdate() {
    if (
      connected ||
      engineUpdateState.installing
    ) {
      return
    }

    setEngineUpdateState(
      (current) => ({
        ...current,
        installing: true,
        message: null,
        error: null,
      }),
    )

    const result =
      await onInstallEngineUpdate()

    setEngineUpdateState(
      (current) => ({
        ...current,
        installing: false,
        latestVersion:
          result.latestVersion ??
          current.latestVersion,
        installedVersion:
          result.installedVersion ??
          current.installedVersion,
        updateAvailable:
          result.success
            ? false
            : current.updateAvailable,
        message:
          result.message,
        error:
          result.error,
      }),
    )
  }

  async function downloadZip() {
    if (downloadingExtensionZip) return
    setDownloadingExtensionZip(true)
    setExtensionMessage(null)
    try {
      const result = await onDownloadExtensionZip()
      if (result.success) {
        setExtensionMessage({ type: 'success', text: t('settings.ext.zipSaved') })
      } else {
        setExtensionMessage({ type: 'error', text: result.error ?? t('settings.ext.zipFailed') })
      }
    } catch (error) {
      setExtensionMessage({ type: 'error', text: error instanceof Error ? error.message : t('settings.ext.zipFailed') })
    } finally {
      setDownloadingExtensionZip(false)
    }
  }

  async function openExtensionFolder() {
    if (openingExtensionFolder) {
      return
    }

    setOpeningExtensionFolder(true)
    setExtensionMessage(null)

    try {
      const result =
        await onOpenVirtualLocationExtension()

      if (result.success) {
        setExtensionMessage({
          type: 'success',
          text: t('settings.ext.folderOpened'),
        })
      } else {
        setExtensionMessage({
          type: 'error',
          text:
            result.error ??
            t('settings.ext.folderFailed'),
        })
      }
    } catch (error) {
      setExtensionMessage({
        type: 'error',
        text:
          error instanceof Error
            ? error.message
            : t('settings.ext.folderFailed'),
      })
    } finally {
      setOpeningExtensionFolder(false)
    }
  }

  const { lang } = useContext(LangCtx)
  const [dnsSelection, setDnsSelection] = useState(standaloneDoH)
  const [customDnsName, setCustomDnsName] = useState('')

  useEffect(() => {
    setDnsSelection(standaloneDoH)
  }, [standaloneDoH])

  useEffect(() => {
    if (dnsApplyError && dnsSelection !== 'custom') {
      setDnsSelection(standaloneDoH)
    }
  }, [dnsApplyError, dnsSelection, standaloneDoH])

  // ── Guided setup ───────────────────────────────────────────────────────
  // One switch that applies the hardened combination most users want but few
  // assemble by hand. Each step reports its own result: a machine without
  // Administrator rights cannot arm the Kill Switch, and silently skipping it
  // would leave the user believing they are protected.
  const [aiApplying, setAiApplying] = useState(false)
  // Translation keys, not translated text: a step list captured in one language
  // must not stay frozen in it when the user switches.
  const [aiSteps, setAiSteps] = useState<Array<{
    key: string
    labelKey: string
    state: 'pending' | 'running' | 'done' | 'failed'
    detailKey?: string
    detail?: string
  }>>([])

  const aiEnabled =
    killSwitch &&
    killSwitchAvailable &&
    standaloneDoH === 'cloudflare-smart' &&
    proxyDoH &&
    utlsHardened

  async function applyGuidedSetup() {
    setAiApplying(true)

    const steps = [
      { key: 'dns', labelKey: 'settings.ai.step.dns' },
      { key: 'doh', labelKey: 'settings.ai.step.doh' },
      { key: 'tls', labelKey: 'settings.ai.step.tls' },
      { key: 'kill', labelKey: 'settings.ai.step.killSwitch' },
    ]
    setAiSteps(steps.map((step) => ({ ...step, state: 'pending' as const })))

    const mark = (
      key: string,
      state: 'running' | 'done' | 'failed',
      detail?: { key?: string; text?: string },
    ) => {
      setAiSteps((current) =>
        current.map((step) => (step.key === key
          ? { ...step, state, detailKey: detail?.key, detail: detail?.text }
          : step)),
      )
    }

    try {
      mark('dns', 'running')
      try {
        setDnsSelection('cloudflare-smart')
        await onStandaloneDoHChange('cloudflare-smart')
        mark('dns', 'done')
      } catch (error) {
        mark('dns', 'failed', { text: error instanceof Error ? error.message : undefined })
      }

      mark('doh', 'running')
      try {
        await onProxyDoHToggle(true)
        mark('doh', 'done')
      } catch (error) {
        mark('doh', 'failed', { text: error instanceof Error ? error.message : undefined })
      }

      mark('tls', 'running')
      try {
        const applied = await onHardenTls()
        if (applied) {
          mark('tls', 'done')
        } else {
          mark('tls', 'failed', { key: 'settings.ai.step.tlsFailed' })
        }
      } catch (error) {
        mark('tls', 'failed', { text: error instanceof Error ? error.message : undefined })
      }

      mark('kill', 'running')
      if (!killSwitchAvailable) {
        mark('kill', 'failed', { key: 'settings.killSwitch.needsAdmin' })
      } else {
        try {
          await onKillSwitchToggle(true)
          mark('kill', 'done')
        } catch (error) {
          mark('kill', 'failed', { text: error instanceof Error ? error.message : undefined })
        }
      }
    } finally {
      setAiApplying(false)
    }
  }

  return (
    <div className="page-stack settings-page">
      {/* ── Guided setup, first because it configures everything below ─── */}
      <section className="panel-card guided-card">
        <div className="guided-head">
          <span className="guided-icon"><BrandIcon name="shield" size={22} /></span>
          <div className="guided-title">
            <span className="panel-kicker">{t('settings.ai.kicker')}</span>
            <h3>{t('settings.ai.title')}</h3>
          </div>
          <span className={aiEnabled ? 'guided-badge guided-badge-on' : 'guided-badge'}>
            {aiEnabled ? t('settings.ai.active') : t('settings.ai.inactive')}
          </span>
        </div>

        <p className="guided-desc">{t('settings.ai.desc')}</p>

        <ul className="guided-list">
          <li>{t('settings.ai.item.killSwitch')}</li>
          <li>{t('settings.ai.item.dns')}</li>
          <li>{t('settings.ai.item.doh')}</li>
          <li>{t('settings.ai.item.tls')}</li>
        </ul>

        <div className="guided-actions">
          <button
            className="guided-apply"
            type="button"
            disabled={aiApplying || standaloneDoHLoading}
            onClick={() => void applyGuidedSetup()}
          >
            {aiApplying && <span className="connect-progress-spinner" aria-hidden="true" />}
            <span>
              {aiApplying
                ? t('settings.ai.applying')
                : aiEnabled
                  ? t('settings.ai.reapply')
                  : t('settings.ai.apply')}
            </span>
          </button>

          {!killSwitchAvailable && (
            <span className="guided-warn">{t('settings.killSwitch.needsAdmin')}</span>
          )}
        </div>

        {aiSteps.length > 0 && (
          <ol className="guided-steps" aria-live="polite">
            {aiSteps.map((step) => (
              <li key={step.key} className={`guided-step guided-step-${step.state}`}>
                <span className="guided-step-mark" aria-hidden="true">
                  {step.state === 'running'
                    ? <span className="connect-progress-spinner" />
                    : step.state === 'done'
                      ? <BrandIcon name="check" size={14} />
                      : step.state === 'failed'
                        ? <BrandIcon name="close" size={14} />
                        : '·'}
                </span>
                <span className="guided-step-body">
                  <span className="guided-step-label">{t(step.labelKey)}</span>
                  {(step.detailKey || step.detail) && (
                    <span className="guided-step-detail">
                      {step.detailKey ? t(step.detailKey) : step.detail}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ── Connection routing ──────────────────────────────────────── */}
      <section className="panel-card">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">
              {lang === 'fa' ? 'مسیریابی اتصال' : 'Connection Routing'}
            </span>
            <h3>
              {t('settings.connection.title')}
            </h3>
          </div>

          <button
            className="secondary-button"
            type="button"
            onClick={onReset}
          >
            {t('settings.connection.reset')}
          </button>
        </div>

        {connected && (
          <div className="inline-notice">
            {t('settings.connection.notice')}
          </div>
        )}

        <label className="settings-select-field">
          <span>{lang === 'fa' ? 'موتور اتصال' : 'Connection engine'}</span>
          <select
            value={settings.engine}
            disabled={connected}
            onChange={(event) => {
              const engine = event.target.value as 'xray' | 'sing-box'
              onUpdate({ engine })
              void window.hamidsDeutsch.engine.setPreference(engine)
            }}
          >
            <option value="xray">Xray Core · {lang === 'fa' ? 'پیش‌فرض' : 'Default'}</option>
            <option value="sing-box">sing-box · {lang === 'fa' ? 'موتور دوم' : 'Secondary engine'}</option>
          </select>
        </label>

        <div className="inline-notice">
          {settings.engine === 'xray'
            ? (lang === 'fa'
                ? 'Xray برای VLESS، VMess، Trojan و Shadowsocks استفاده می‌شود. TUN، Hysteria2، TUIC و AnyTLS با هشدار به sing-box نیاز دارند.'
                : 'Xray handles VLESS, VMess, Trojan, and Shadowsocks. TUN, Hysteria2, TUIC, and AnyTLS require sing-box with confirmation.')
            : (lang === 'fa'
                ? 'sing-box فعال است. تنها موتوری است که حالت TUN و پروتکل‌های Hysteria2، TUIC و AnyTLS را پشتیبانی می‌کند.'
                : 'sing-box is active. It is the only engine that supports TUN mode and the Hysteria2, TUIC and AnyTLS protocols.')}
        </div>

        <label className="settings-select-field">
          <span>
            {t('settings.mode.label')}
          </span>

          <select
            value={
              settings.mode
            }
            onChange={(event) =>
              onUpdate({
                mode:
                  event.target
                    .value as
                    | 'auto'
                    | 'tun'
                    | 'system-proxy',
              })
            }
          >
            <option value="auto">
              {t('settings.mode.auto')}
            </option>
            <option value="tun">
              {t('settings.mode.tunOnly')}
            </option>
            <option value="system-proxy">
              {t('settings.mode.proxyOnly')}
            </option>
          </select>
        </label>

        <SettingRow
          title={t('settings.mode.fallbackTitle')}
          description={t('settings.mode.fallbackDesc')}
          checked={
            settings.allowFallback
          }
          disabled={
            settings.mode ===
              'system-proxy' ||
            settings.mode ===
              'tun'
          }
          onChange={(checked) =>
            onUpdate({
              allowFallback:
                checked,
            })
          }
        />

        <SettingRow
          title={t('settings.shortcut.title')}
          description={t('settings.shortcut.desc')}
          checked={ctrlEnterEnabled}
          onChange={onCtrlEnterToggle}
        />

        <SettingRow
          title={lang === 'fa' ? 'کوچک‌سازی به سینی سیستم' : 'Minimize to System Tray'}
          description={lang === 'fa' ? 'با بستن پنجره، برنامه به‌جای خروج، در سینی سیستم باقی می‌ماند.' : 'Closing the window hides the app to the system tray instead of quitting.'}
          checked={closeToTray}
          onChange={(v) => void onCloseToTrayToggle(v)}
        />

        <SettingRow
          title={t('settings.killSwitch.title')}
          description={t('settings.killSwitch.desc')}
          checked={killSwitch && killSwitchAvailable}
          disabled={!killSwitchAvailable}
          onChange={(v) => void onKillSwitchToggle(v)}
        />
        {!killSwitchAvailable && (
          <p className="setting-row-note" role="note">{t('settings.killSwitch.needsAdmin')}</p>
        )}

        <NetworkRepairRow lang={lang} />

        {/* ── System DNS / DNS over HTTPS ─────────────────────────────────── */}
        <div className="settings-section-divider">
          <span>{lang === 'fa' ? 'DNS و DNS over HTTPS' : 'DNS & DNS over HTTPS'}</span>
        </div>

        <div className="setting-row">
          <div className="setting-title-with-info">
            <strong>{lang === 'fa' ? 'DNS سیستم' : 'System DNS'}</strong>
            <InfoButton
              fa="پیش از اعمال، پاسخ واقعی سرورها بررسی می‌شود و سپس DNS همه آداپترهای فعال ویندوز تغییر می‌کند. گزینه‌های خارجی در Windows 11 با DoH رمزگذاری می‌شوند."
              en="Servers are queried before use, then applied to every active Windows adapter. International presets use encrypted DoH on Windows 11."
            />
          </div>
          <select
            className="doh-server-select"
            value={dnsSelection}
            disabled={standaloneDoHLoading}
            onChange={(event) => {
              const next = event.target.value as typeof dnsSelection
              setDnsSelection(next)
              if (next !== 'custom') void onStandaloneDoHChange(next)
            }}
          >
            <option value="off">{lang === 'fa' ? 'غیرفعال' : 'Off'}</option>
            <option value="cloudflare-smart">Cloudflare Smart ({lang === 'fa' ? 'بهترین IP تأییدشده' : 'verified best IP'})</option>
            <option value="cloudflare">Cloudflare Traditional (1.1.1.1)</option>
            <option value="cloudflare-family">Cloudflare Family (1.1.1.3)</option>
            <option value="google">Google (8.8.8.8)</option>
            <option value="adguard">AdGuard (94.140.14.14)</option>
            <option value="shecan">شکن · 178.22.122.100</option>
            <option value="radar">رادار گیم · 10.202.10.10</option>
            <option value="electro">الکترو · 78.157.42.100</option>
            <option value="custom">{lang === 'fa' ? 'DNS دستی…' : 'Custom DNS…'}</option>
          </select>
        </div>

        {dnsSelection === 'custom' && (
          <div className="custom-dns-panel">
            <label>
              <span>{lang === 'fa' ? 'نام پروفایل' : 'Profile name'}</span>
              <input
                type="text"
                value={customDnsName}
                maxLength={40}
                placeholder={lang === 'fa' ? 'مثلاً DNS محل کار' : 'e.g. Work DNS'}
                disabled={standaloneDoHLoading}
                onChange={(event) => setCustomDnsName(event.target.value)}
              />
            </label>
            <label>
              <span>{lang === 'fa' ? 'DNS اصلی' : 'Primary DNS'}</span>
              <input
                type="text"
                inputMode="decimal"
                dir="ltr"
                value={customDnsPrimary}
                placeholder="9.9.9.9"
                disabled={standaloneDoHLoading}
                onChange={(event) => onCustomDnsChange(event.target.value, customDnsSecondary)}
              />
            </label>
            <label>
              <span>{lang === 'fa' ? 'DNS دوم (اختیاری)' : 'Secondary DNS (optional)'}</span>
              <input
                type="text"
                inputMode="decimal"
                dir="ltr"
                value={customDnsSecondary}
                placeholder="149.112.112.112"
                disabled={standaloneDoHLoading}
                onChange={(event) => onCustomDnsChange(customDnsPrimary, event.target.value)}
              />
            </label>
            <button
              className="primary-button"
              type="button"
              disabled={standaloneDoHLoading || customDnsPrimary.trim().length === 0}
              onClick={() => {
                onSaveDnsProfile({
                  name: customDnsName,
                  primary: customDnsPrimary,
                  secondary: customDnsSecondary,
                })
                setCustomDnsName('')
                void onStandaloneDoHChange('custom', customDnsPrimary, customDnsSecondary)
              }}
            >
              {standaloneDoHLoading
                ? (lang === 'fa' ? 'در حال تست و اعمال…' : 'Testing and applying…')
                : (lang === 'fa' ? 'ذخیره، تست و اعمال' : 'Save, test & apply')}
            </button>
          </div>
        )}

        {customDnsProfiles.length > 0 && (
          <div className="saved-dns-profiles">
            <div className="saved-dns-heading">
              <strong>{lang === 'fa' ? 'DNSهای ذخیره‌شده من' : 'My saved DNS profiles'}</strong>
              <span>{customDnsProfiles.length}</span>
            </div>
            {customDnsProfiles.map((profile) => (
              <div className="saved-dns-row" key={profile.id}>
                <div>
                  <strong>{profile.name}</strong>
                  <span dir="ltr">{profile.primary}{profile.secondary ? ` · ${profile.secondary}` : ''}</span>
                </div>
                <div className="saved-dns-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={standaloneDoHLoading}
                    onClick={() => void onStandaloneDoHChange('custom', profile.primary, profile.secondary)}
                  >
                    {lang === 'fa' ? 'اعمال' : 'Apply'}
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    disabled={standaloneDoHLoading}
                    aria-label={lang === 'fa' ? 'حذف' : 'Delete'}
                    onClick={() => onRemoveDnsProfile(profile.id)}
                  >
                    <BrandIcon name="close" size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {dnsApplyError && <div className="inline-error dns-apply-error">{dnsApplyError}</div>}

        <SettingRow
          title={lang === 'fa' ? 'DoH داخل پروکسی' : 'DoH Inside Proxy'}
          description={lang === 'fa'
            ? 'هنگام اتصال VPN، درخواست‌های DNS را هم از داخل تونل پروکسی ارسال می‌کند — از نشت DNS جلوگیری می‌کند.'
            : 'When connected via proxy, routes DNS through the tunnel too — prevents DNS leaks.'
          }
          checked={proxyDoH}
          onChange={(v) => void onProxyDoHToggle(v)}
        />

        <div className="connection-mode-summary">
          <span>
            Administrator
          </span>
          <strong>
            {administratorAvailable
              ? t('settings.mode.active')
              : t('settings.mode.inactive')}
          </strong>

          <span>
            {t('settings.mode.selected')}
          </span>
          <strong>
            {settings.mode ===
            'auto'
              ? t('settings.mode.autoShort')
              : settings.mode ===
                  'tun'
                ? t('settings.mode.tunShort')
                : t('settings.mode.proxyShort')}
          </strong>
        </div>
      </section>

      <section className="panel-card settings-card app-update-card" id="settings-updates">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">{lang === 'fa' ? 'به‌روزرسانی برنامه' : 'Automatic Updates'}</span>
            <h3>{lang === 'fa' ? 'آپدیت خودکار برنامه' : 'Automatic App Updates'}</h3>
          </div>
          <span className={`count-badge update-state-${updateState.phase}`}>
            {updateState.phase === 'checking'
              ? (lang === 'fa' ? 'در حال بررسی' : 'Checking')
              : updateState.phase === 'available'
                ? (lang === 'fa' ? 'نسخه جدید' : 'Update found')
                : updateState.phase === 'downloading'
                  ? `${updateState.percent}%`
                  : updateState.phase === 'ready'
                    ? (lang === 'fa' ? 'آماده نصب' : 'Ready')
                    : updateState.phase === 'error'
                      ? (lang === 'fa' ? 'نیاز به تلاش مجدد' : 'Retry pending')
                      : updateState.lastCheckedAt
                        ? (lang === 'fa' ? 'به‌روز' : 'Up to date')
                        : (lang === 'fa' ? 'هنوز بررسی نشده' : 'Not checked yet')}
          </span>
        </div>

        <SettingRow
          title={lang === 'fa' ? 'بررسی خودکار نسخه جدید' : 'Check automatically'}
          description={lang === 'fa'
            ? 'هنگام اجرای برنامه در پس‌زمینه بررسی می‌شود؛ اگر GitHub در دسترس نباشد، پس از اتصال موفق دوباره تلاش می‌کند.'
            : 'Checks quietly at launch and retries after a verified VPN connection if GitHub was unreachable.'}
          checked={autoUpdateEnabled}
          onChange={(v) => void onAutoUpdateToggle(v)}
        />

        {updateState.error && (
          <p className="inline-notice">
            {updateState.retryAfterConnection && lang === 'fa' && !connected
              ? 'GitHub فعلاً در دسترس نیست؛ پس از اتصال موفق، بررسی خودکار تکرار می‌شود.'
              : lang === 'fa'
                ? `بررسی آپدیت انجام نشد: ${updateState.error}`
                : updateState.error}
          </p>
        )}

        <div className="settings-inline-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={!autoUpdateEnabled || updateState.phase === 'checking' || updateState.phase === 'downloading'}
            onClick={() => void onCheckAppUpdate()}
          >
            {lang === 'fa' ? 'بررسی همین حالا' : 'Check now'}
          </button>
          {updateState.phase === 'available' && (
            <button className="primary-button" type="button" onClick={() => void onDownloadAppUpdate()}>
              {lang === 'fa'
                ? `دانلود نسخه ${updateState.availableVersion ?? ''}`
                : `Download ${updateState.availableVersion ?? ''}`}
            </button>
          )}
          {updateState.phase === 'ready' && (
            <button className="primary-button" type="button" onClick={() => void onInstallAppUpdate()}>
              {lang === 'fa' ? 'نصب و راه‌اندازی دوباره' : 'Install and restart'}
            </button>
          )}
        </div>
      </section>

      <section className="panel-card settings-card engine-update-card" id="settings-tools">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">
              {lang === 'fa' ? 'به‌روزرسانی موتور' : 'Engine Update'}
            </span>
            <h3>
              {t('settings.engine.title')}
            </h3>
          </div>

          <div className="heading-end-row">
            <span className="count-badge">
              {lang === 'fa' ? 'فقط نسخه پایدار' : 'Stable only'}
            </span>
            <InfoButton
              fa="نسخه فعلی با آخرین Release پایدار رسمی SagerNet مقایسه می‌شود. نسخه‌های Alpha، Beta و RC نصب نخواهند شد."
              en="The current version is compared against the latest stable SagerNet release. Alpha, Beta, and RC versions will not be installed."
            />
          </div>
        </div>

        <div className="engine-version-grid">
          <div>
            <span>
              {t('settings.engine.installed')}
            </span>
            <strong dir="ltr">
              {engineUpdateState.installedVersion ??
              currentEngineVersion ??
              t('settings.engine.unknown')}
            </strong>
          </div>

          <div>
            <span>
              {t('settings.engine.latest')}
            </span>
            <strong dir="ltr">
              {engineUpdateState.latestVersion ??
              t('settings.engine.notChecked')}
            </strong>
          </div>
        </div>

        <div className="engine-update-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={
              engineUpdateState.checking ||
              engineUpdateState.installing
            }
            onClick={() => {
              void checkEngineUpdate()
            }}
          >
            {engineUpdateState.checking
              ? t('settings.engine.checking')
              : t('settings.engine.check')}
          </button>

          <button
            className="primary-button compact-primary"
            type="button"
            disabled={
              connected ||
              engineUpdateState.installing ||
              !engineUpdateState.updateAvailable
            }
            onClick={() => {
              void installEngineUpdate()
            }}
          >
            {engineUpdateState.installing
              ? t('settings.engine.installing')
              : connected
                ? t('settings.engine.disconnectFirst')
                : t('settings.engine.install')}
          </button>
        </div>

        {engineUpdateState.message && (
          <div className="inline-notice engine-update-message">
            {engineUpdateState.message}
          </div>
        )}

        {engineUpdateState.error && (
          <div className="inline-error engine-update-message">
            {engineUpdateState.error}
          </div>
        )}

      </section>

      <section className="panel-card settings-card virtual-location-card">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">
              {lang === 'fa' ? 'مکان مجازی مرورگر' : 'Browser Virtual Location'}
            </span>
            <h3>
              {t('settings.ext.title')}
            </h3>
          </div>

          <div className="heading-end-row">
            <span className="count-badge">
              Chrome / Edge
            </span>
            <InfoButton
              fa="افزونه همراه فقط هنگام اتصال تأییدشده Manfaz VPN فعال می‌شود و مختصات HTML5 Geolocation را با کشور و شهر IP خروجی هماهنگ می‌کند. با قطع برنامه یا استفاده از VPN دیگر، خودکار غیرفعال می‌شود."
              en="The bundled extension activates only on a verified Manfaz VPN connection, aligning HTML5 Geolocation coordinates with the exit IP country and city. It deactivates automatically when the app disconnects or another VPN is used."
            />
          </div>
        </div>

        <div className="virtual-location-steps">
          <span>
            {t('settings.ext.step1')}
          </span>
          <span>
            {t('settings.ext.step2')}
          </span>
          <span>
            {t('settings.ext.step3')}
          </span>
        </div>

        <div className="extension-install-row">
          <button
            className="primary-button compact-primary"
            type="button"
            disabled={openingExtensionFolder}
            onClick={() => void openExtensionFolder()}
          >
            {openingExtensionFolder ? t('settings.ext.opening') : t('settings.ext.openFolder')}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={downloadingExtensionZip}
            onClick={() => void downloadZip()}
          >
            {downloadingExtensionZip ? t('settings.ext.downloading') : t('settings.ext.downloadZip')}
          </button>
        </div>

        {extensionMessage && (
          <div
            className={
              extensionMessage.type ===
              'success'
                ? 'inline-notice virtual-location-message'
                : 'inline-error virtual-location-message'
            }
          >
            {extensionMessage.text}
          </div>
        )}

      </section>

      <StartupSection />

      <ExportImportSection />


      <ConnectionHistorySection />

      <section className="panel-card">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">
              {lang === 'fa' ? 'ایمنی' : 'Safety'}
            </span>
            <h3>
              {t('settings.fixed.title')}
            </h3>
          </div>
        </div>

        <SettingRow
          title={t('settings.fixed.ipCheck')}
          description={t('settings.fixed.ipCheckDesc')}
          checked
          disabled
        />

        <SettingRow
          title={t('settings.fixed.proxyRestore')}
          description={t('settings.fixed.proxyRestoreDesc')}
          checked
          disabled
        />

        <SettingRow
          title={t('settings.fixed.healthMonitor')}
          description={t('settings.fixed.healthMonitorDesc')}
          checked
          disabled
        />
      </section>
    </div>
  )
}

function ExportImportSection() {
  const t = useT()
  const { lang } = useContext(LangCtx)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  function collectSettings(): Record<string, string> {
    const keys = [
      'hd-theme',
      'hd-lang',
      'hamidsdeutsch:connection-settings:v1',
      'hamidsdeutsch:rescue-settings:v1',
      'hamidsdeutsch:direct-domains:v2',
      'hamidsdeutsch:selected-server:v2',
      'hamidsdeutsch-bpb-config-cache-v1',
      'hamidsdeutsch:ctrl-enter',
    ]
    const out: Record<string, string> = {}
    for (const k of keys) {
      const v = localStorage.getItem(k)
      if (v !== null) out[k] = v
    }
    return out
  }

  function exportSettings() {
    try {
      const data = {
        version: 2,
        exportedAt: new Date().toISOString(),
        settings: collectSettings(),
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `hamids-deutsch-settings-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setMessage({ type: 'success', text: t('settings.exportImport.exported') })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : t('settings.exportImport.exportFailed') })
    }
  }

  function importSettings() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string) as { version: number; settings: Record<string, string> }
          if (!data.settings || typeof data.settings !== 'object') {
            setMessage({ type: 'error', text: t('settings.exportImport.invalidFile') })
            return
          }
          for (const [k, v] of Object.entries(data.settings)) {
            localStorage.setItem(k, v)
          }
          setMessage({ type: 'success', text: t('settings.exportImport.imported') })
          setTimeout(() => window.location.reload(), 800)
        } catch {
          setMessage({ type: 'error', text: t('settings.exportImport.invalidFile') })
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  return (
    <section className="panel-card">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">{lang === 'fa' ? 'تنظیمات' : 'Settings'}</span>
          <h3>{t('settings.exportImport.title')}</h3>
        </div>
        <InfoButton
          fa="تمام تنظیمات برنامه (زبان، تم، حالت اتصال، دامنه‌های مستقیم و تنظیمات Rescue) را در یک فایل JSON ذخیره یا بارگذاری کنید."
          en="Save or load all app settings (language, theme, connection mode, direct domains, rescue settings) in a single JSON file."
        />
      </div>
      <div className="export-import-actions">
        <button className="secondary-button" type="button" onClick={exportSettings}>
          {t('settings.exportImport.export')}
        </button>
        <button className="primary-button compact-primary" type="button" onClick={importSettings}>
          {t('settings.exportImport.import')}
        </button>
      </div>
      {message && (
        <div className={message.type === 'success' ? 'inline-notice' : 'inline-error'} style={{ marginTop: '8px' }}>
          {message.text}
        </div>
      )}
    </section>
  )
}

function StartupSection() {
  const t = useT()
  const { lang } = useContext(LangCtx)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void window.hamidsDeutsch.startup.getLoginItem().then((r) => setEnabled(r.enabled))
  }, [])

  async function toggle() {
    if (busy || enabled === null) return
    setBusy(true)
    setMessage(null)
    const next = !enabled
    const r = await window.hamidsDeutsch.startup.setLoginItem(next)
    setBusy(false)
    if (r.success) {
      setEnabled(r.enabled)
      setMessage(r.enabled ? t('settings.startup.enabled') : t('settings.startup.disabled'))
    } else {
      setMessage(r.error ?? t('settings.startup.failed'))
    }
  }

  return (
    <section className="panel-card">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">{lang === 'fa' ? 'سیستم' : 'System'}</span>
          <h3>{t('settings.startup.title')}</h3>
        </div>
        {enabled !== null && (
          <span className="count-badge">{enabled ? t('settings.startup.on') : t('settings.startup.off')}</span>
        )}
      </div>
      <p className="inline-notice">{t('settings.startup.desc')}</p>
      <button
        className={enabled ? 'secondary-button' : 'primary-button compact-primary'}
        type="button"
        disabled={busy || enabled === null}
        onClick={() => void toggle()}
      >
        {busy ? t('settings.startup.saving') : enabled ? t('settings.startup.disable') : t('settings.startup.enable')}
      </button>
      {message && <div className="inline-notice" style={{ marginTop: '8px' }}>{message}</div>}
    </section>
  )
}

function ConnectionHistorySection() {
  const t = useT()
  const { lang } = useContext(LangCtx)
  const [entries, setEntries] = useState<{
    id: string
    connectedAt: string
    disconnectedAt: string | null
    durationMs: number | null
    mode: string
    serverName: string | null
    protocol: string | null
    latencyMs: number | null
  }[]>([])
  const [loaded, setLoaded] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [undoClearVisible, setUndoClearVisible] = useState(false)
  const [undoClearSnapshot, setUndoClearSnapshot] = useState<typeof entries>([])
  const undoClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void window.hamidsDeutsch.history.get().then((r) => {
      if (r.success) setEntries(r.entries)
      setLoaded(true)
    })
  }, [])

  async function clearHistory() {
    if (clearing) return
    setClearing(true)
    setUndoClearSnapshot(entries)
    setEntries([])
    setUndoClearVisible(true)
    if (undoClearTimer.current) clearTimeout(undoClearTimer.current)
    undoClearTimer.current = setTimeout(async () => {
      setUndoClearVisible(false)
      await window.hamidsDeutsch.history.clear()
      setClearing(false)
    }, 5000)
  }

  async function undoClear() {
    if (undoClearTimer.current) clearTimeout(undoClearTimer.current)
    setUndoClearVisible(false)
    setEntries(undoClearSnapshot)
    setClearing(false)
  }

  function formatDuration(ms: number | null) {
    if (!ms) return '—'
    const s = Math.floor(ms / 1000)
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m ${s % 60}s`
    return `${Math.floor(m / 60)}h ${m % 60}m`
  }

  function fmtTime(iso: string) {
    return new Date(iso).toLocaleTimeString()
  }

  function getDateLabel(iso: string): string {
    const d = new Date(iso)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    const weekAgo = new Date(today)
    weekAgo.setDate(today.getDate() - 7)
    const isSameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
    if (isSameDay(d, today)) return t('history.today')
    if (isSameDay(d, yesterday)) return t('history.yesterday')
    if (d >= weekAgo) return t('history.thisWeek')
    return d.toLocaleDateString()
  }

  const groupedEntries = useMemo(() => {
    const groups: { label: string; entries: typeof entries }[] = []
    const seen = new Map<string, number>()
    for (const e of entries.slice(0, 30)) {
      const label = getDateLabel(e.connectedAt)
      if (!seen.has(label)) {
        seen.set(label, groups.length)
        groups.push({ label, entries: [] })
      }
      groups[seen.get(label)!].entries.push(e)
    }
    return groups
  // The label helper intentionally reads the current locale for this render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries])

  return (
    <section className="panel-card">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">{lang === 'fa' ? 'تاریخچه' : 'History'}</span>
          <h3>{t('settings.history.title')}</h3>
        </div>
        {entries.length > 0 && (
          <button
            className="secondary-button"
            type="button"
            disabled={clearing}
            onClick={() => void clearHistory()}
          >
            {t('settings.history.clear')}
          </button>
        )}
      </div>

      {!loaded ? (
        <p className="inline-notice">{t('settings.history.loading')}</p>
      ) : entries.length === 0 ? (
        <p className="inline-notice">{t('settings.history.empty')}</p>
      ) : (
        <div className="history-list">
          {groupedEntries.map((group) => (
            <div key={group.label} className="history-date-group">
              <div className="history-date-label">{group.label}</div>
              {group.entries.map((e) => (
            <div key={e.id} className="history-entry">
              <div className="history-entry-top">
                <span className="history-mode">{e.mode}</span>
                {e.protocol && <span className="history-protocol">{e.protocol}</span>}
                <span className="history-duration">{formatDuration(e.durationMs)}</span>
              </div>
              <div className="history-entry-bottom">
                <span className="history-server">{e.serverName ?? '—'}</span>
                <span className="history-time">{fmtTime(e.connectedAt)}</span>
              </div>
            </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {undoClearVisible && (
        <div className="undo-bar">
          <span>{t('undo.clearHistory')}</span>
          <button className="secondary-button undo-bar-btn" type="button" onClick={() => void undoClear()}>
            {t('undo.button')}
          </button>
        </div>
      )}
    </section>
  )
}



function SettingRow({
  title,
  description,
  checked = false,
  disabled = false,
  onChange,
}: {
  title: string
  description: string
  checked?: boolean
  disabled?: boolean
  onChange?: (
    checked: boolean,
  ) => void
}) {
  return (
    <div
      className={
        disabled
          ? 'setting-row setting-row-disabled'
          : 'setting-row'
      }
    >
      <div>
        <span className="setting-title-with-info">
          <strong>{title}</strong>
          <InfoButton fa={description} en={description} />
        </span>
      </div>

      <label className="switch">
        <input
          aria-label={title}
          checked={checked}
          disabled={disabled}
          type="checkbox"
          onChange={(event) =>
            onChange?.(
              event.target.checked,
            )
          }
        />
        <span className="switch-track" />
        <span className="switch-state" aria-hidden="true">
          {checked ? 'ON' : 'OFF'}
        </span>
      </label>
    </div>
  )
}

// ── ToolsPage ────────────────────────────────────────────────────────────────

function ToolsPage({
  directDomains: _directDomains,
  onNavigateToSubscriptions,
}: {
  directDomains: string[]
  onNavigateToSubscriptions: () => void
}) {
  return (
    <div className="page-content tools-page">
      <CfScannerSection />
      <SubscriptionConverterSection onNavigateToSubscriptions={onNavigateToSubscriptions} />
      <UpstreamProxySection />
      <UTlsSection />
      <BackupRestoreSection />
    </div>
  )
}

// ── CF Scanner Section ────────────────────────────────────────────────────────

function CfScannerSection() {
  const t = useT()
  const [port, setPort] = useState(443)
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState<CfScanResult | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [autoScanEnabled, setAutoScanEnabled] = useState(true)
  const [scanIntervalHours, setScanIntervalHours] = useState(0)
  const [cachedIp, setCachedIp] = useState<string | null>(null)
  const [cacheDate, setCacheDate] = useState<string | null>(null)

  useEffect(() => {
    void window.hamidsDeutsch.tools.getCfAutoScan().then((r) => {
      setAutoScanEnabled(r.settings.enabled)
      setScanIntervalHours(r.settings.intervalHours ?? 0)
      setCachedIp(r.cache?.bestIp ?? null)
      setCacheDate(r.cache?.scannedAt ?? null)
    }).catch(() => {})
  }, [])

  async function toggleAutoScan(enabled: boolean) {
    setAutoScanEnabled(enabled)
    await window.hamidsDeutsch.tools.setCfAutoScan({ enabled, intervalHours: scanIntervalHours }).catch(() => {})
  }

  async function changeInterval(hours: number) {
    setScanIntervalHours(hours)
    await window.hamidsDeutsch.tools.setCfAutoScan({ enabled: autoScanEnabled, intervalHours: hours }).catch(() => {})
  }

  async function startScan() {
    setScanning(true)
    setResult(null)
    try {
      const r = await window.hamidsDeutsch.tools.cfScan({ port })
      setResult(r)
      if (r.success && r.results?.[0]) {
        setCachedIp(r.results[0].ip)
        setCacheDate(new Date().toISOString())
      }
    } finally {
      setScanning(false)
    }
  }

  function copyIp(ip: string) {
    navigator.clipboard.writeText(ip).catch(() => {})
    setCopied(ip)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="settings-section">
      <div className="section-kicker">{t('tools.cfscanner.kicker')}</div>
      <h3 className="section-title">{t('tools.cfscanner.title')}</h3>
      <p className="section-desc">اسکن خودکار در پس‌زمینه هنگام باز شدن برنامه انجام می‌شود و سریع‌ترین IP کلودفلر برای همه اتصال‌ها به‌طور خودکار اعمال می‌گردد.</p>
      <div className="toggle-row">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={autoScanEnabled}
            onChange={(e) => void toggleAutoScan(e.target.checked)}
          />
          <span>اسکن خودکار هنگام راه‌اندازی</span>
        </label>
      </div>
      <div className="field-row" style={{ marginTop: 10 }}>
        <label className="field-label">تناوب اسکن خودکار</label>
        <select
          className="select-input"
          value={scanIntervalHours}
          onChange={(e) => void changeInterval(Number(e.target.value))}
        >
          <option value={0}>غیرفعال</option>
          <option value={3}>هر ۳ ساعت</option>
          <option value={6}>هر ۶ ساعت</option>
          <option value={12}>هر ۱۲ ساعت</option>
          <option value={24}>هر ۲۴ ساعت</option>
        </select>
      </div>
      {cachedIp && (
        <div className="cf-cached-ip">
          <span>IP فعلی: <strong>{cachedIp}</strong></span>
          {cacheDate && <span className="cf-cache-date">{new Date(cacheDate).toLocaleString(activeLocale())}</span>}
        </div>
      )}
      <div className="field-row">
        <label className="field-label">{t('tools.cfscanner.port')}</label>
        <input
          className="text-input"
          type="number"
          min={1}
          max={65535}
          value={port}
          onChange={(e) => setPort(Number(e.target.value) || 443)}
          style={{ width: 100 }}
          disabled={scanning}
        />
        <button className="action-btn" type="button" onClick={startScan} disabled={scanning}>
          {scanning ? t('tools.cfscanner.scanning') : t('tools.cfscanner.startBtn')}
        </button>
      </div>
      {result && (
        <div className="cf-scan-results">
          <div className="cf-scan-meta">
            {t('tools.cfscanner.results')}: {result.reachable}/{result.total}
          </div>
          {result.results && result.results.length > 0 ? (
            <table className="cf-scan-table">
              <tbody>
                {result.results.map((r: { ip: string; latencyMs: number }) => (
                  <tr key={r.ip} className="cf-scan-row">
                    <td className="cf-scan-ip">{r.ip}</td>
                    <td className="cf-scan-latency">{r.latencyMs} ms</td>
                    <td>
                      <button
                        className="copy-btn"
                        type="button"
                        onClick={() => copyIp(r.ip)}
                      >
                        {copied === r.ip ? '✓' : t('tools.cfscanner.copy')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="section-desc">{t('tools.cfscanner.noResults')}</p>
          )}
        </div>
      )}
      {result && !result.success && (
        <p className="error-text">{result.error}</p>
      )}
    </div>
  )
}

// ── Subscription Converter Section ────────────────────────────────────────────

function SubscriptionConverterSection({ onNavigateToSubscriptions: _onNavigateToSubscriptions }: { onNavigateToSubscriptions: () => void }) {
  const t = useT()
  const [backends, setBackends] = useState<ConverterBackend[]>([])
  const [targets, setTargets] = useState<ConverterTarget[]>([])
  const [subUrl, setSubUrl] = useState('')
  const [backendId, setBackendId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [converting, setConverting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    window.hamidsDeutsch.tools.getConverterBackends().then((r) => {
      setBackends(r.backends)
      setTargets(r.targets)
      if (r.backends.length > 0) setBackendId(r.backends[0].id)
      if (r.targets.length > 0) setTargetId(r.targets[0].id)
    }).catch(() => {})
  }, [])

  async function convert() {
    if (!subUrl.trim()) return
    const approved = window.confirm(
      'این ابزار لینک اشتراک را برای تبدیل به سرویس عمومی انتخاب‌شده می‌فرستد. لینک اشتراک ممکن است محرمانه باشد. ادامه می‌دهید؟',
    )
    if (!approved) return
    setConverting(true)
    setResult(null)
    setError(null)
    const r = await window.hamidsDeutsch.tools.convertSubscription({ subscriptionUrl: subUrl.trim(), backendId, targetId })
    setConverting(false)
    if (r.success && r.convertedContent) {
      setResult(r.convertedContent)
    } else {
      setError(r.error ?? 'Failed')
    }
  }

  function copyResult() {
    if (!result) return
    navigator.clipboard.writeText(result).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="settings-section">
      <div className="section-kicker">{t('tools.converter.kicker')}</div>
      <h3 className="section-title">{t('tools.converter.title')}</h3>
      <p className="section-desc">{t('tools.converter.desc')}</p>
      <p className="inline-notice">لینک اشتراک برای تبدیل به سرویس عمومی انتخاب‌شده ارسال می‌شود؛ فقط با سرویس مورد اعتماد ادامه دهید.</p>
      <div className="field-stack">
        <label className="field-label">{t('tools.converter.urlLabel')}</label>
        <input
          className="text-input full-width"
          type="url"
          value={subUrl}
          onChange={(e) => setSubUrl(e.target.value)}
          placeholder="https://..."
          disabled={converting}
        />
      </div>
      <div className="field-row field-row-gap">
        <div className="field-stack">
          <label className="field-label">{t('tools.converter.backend')}</label>
          <select
            className="select-input"
            value={backendId}
            onChange={(e) => setBackendId(e.target.value)}
            disabled={converting}
          >
            {backends.map((b) => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </select>
        </div>
        <div className="field-stack">
          <label className="field-label">{t('tools.converter.target')}</label>
          <select
            className="select-input"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            disabled={converting}
          >
            {targets.map((t2) => (
              <option key={t2.id} value={t2.id}>{t2.label}</option>
            ))}
          </select>
        </div>
        <button className="action-btn" type="button" onClick={convert} disabled={converting || !subUrl.trim()}>
          {converting ? t('tools.converter.converting') : t('tools.converter.convertBtn')}
        </button>
      </div>
      {result && (
        <div className="field-stack">
          <label className="field-label">{t('tools.converter.result')}</label>
          <div className="result-row">
            <input className="text-input full-width" readOnly value={result} />
            <button className="copy-btn" type="button" onClick={copyResult}>
              {copied ? '✓' : t('tools.cfscanner.copy')}
            </button>
          </div>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  )
}

// ── Upstream Proxy Section ────────────────────────────────────────────────────

function UpstreamProxySection() {
  const t = useT()
  const [settings, setSettings] = useState<UpstreamProxySettings>({
    enabled: false,
    type: 'socks5',
    host: '',
    port: 1080,
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.hamidsDeutsch.tools.getUpstreamProxy().then((r) => {
      if (r.success) setSettings(r.settings)
    }).catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    const r = await window.hamidsDeutsch.tools.setUpstreamProxy(settings)
    setSaving(false)
    if (r.success) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  return (
    <div className="settings-section">
      <div className="section-kicker">{t('tools.upstreamProxy.kicker')}</div>
      <h3 className="section-title">{t('tools.upstreamProxy.title')}</h3>
      <p className="section-desc">{t('tools.upstreamProxy.desc')}</p>
      <div className="toggle-row">
        <span className="toggle-label">{t('tools.upstreamProxy.enabled')}</span>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => setSettings((s) => ({ ...s, enabled: e.target.checked }))}
          />
          <span className="switch-track" />
        </label>
      </div>
      {settings.enabled && (
        <div className="field-row field-row-gap" style={{ marginTop: 12 }}>
          <div className="field-stack">
            <label className="field-label">{t('tools.upstreamProxy.type')}</label>
            <select
              className="select-input"
              value={settings.type}
              onChange={(e) => setSettings((s) => ({ ...s, type: e.target.value as 'socks5' | 'http' }))}
            >
              <option value="socks5">SOCKS5</option>
              <option value="http">HTTP</option>
            </select>
          </div>
          <div className="field-stack">
            <label className="field-label">{t('tools.upstreamProxy.host')}</label>
            <input
              className="text-input"
              type="text"
              value={settings.host}
              onChange={(e) => setSettings((s) => ({ ...s, host: e.target.value }))}
              placeholder="127.0.0.1"
              style={{ width: 160 }}
            />
          </div>
          <div className="field-stack">
            <label className="field-label">{t('tools.upstreamProxy.port')}</label>
            <input
              className="text-input"
              type="number"
              min={1}
              max={65535}
              value={settings.port}
              onChange={(e) => setSettings((s) => ({ ...s, port: Number(e.target.value) || 1080 }))}
              style={{ width: 90 }}
            />
          </div>
        </div>
      )}
      <button className="action-btn" type="button" onClick={save} disabled={saving} style={{ marginTop: 12 }}>
        {saved ? '✓' : saving ? '...' : t('tools.upstreamProxy.saveBtn')}
      </button>
    </div>
  )
}

// ── uTLS / ECH Section ────────────────────────────────────────────────────────

function UTlsSection() {
  const t = useT()
  const [settings, setSettings] = useState<UTlsSettings>({
    globalFingerprint: 'auto',
    echEnabled: false,
    fragmentEnabled: false,
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.hamidsDeutsch.tools.getUTlsSettings().then((r) => {
      if (r.success) setSettings(r.settings)
    }).catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    const r = await window.hamidsDeutsch.tools.setUTlsSettings(settings)
    setSaving(false)
    if (r.success) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  return (
    <div className="settings-section">
      <div className="section-kicker">{t('tools.utls.kicker')}</div>
      <h3 className="section-title">{t('tools.utls.title')}</h3>
      <div className="field-stack" style={{ marginBottom: 14 }}>
        <label className="field-label">{t('tools.utls.fpLabel')}</label>
        <select
          className="select-input"
          value={settings.globalFingerprint}
          onChange={(e) => setSettings((s) => ({ ...s, globalFingerprint: e.target.value as UTlsSettings['globalFingerprint'] }))}
        >
          <option value="auto">{t('tools.utls.fpAuto')}</option>
          <option value="chrome">Chrome</option>
          <option value="firefox">Firefox</option>
          <option value="safari">Safari</option>
          <option value="ios">iOS</option>
          <option value="android">Android</option>
          <option value="randomized">Randomized</option>
        </select>
      </div>
      <div className="toggle-row" style={{ marginBottom: 14 }}>
        <div>
          <span className="toggle-label">{t('tools.utls.echLabel')}</span>
          <p className="section-desc" style={{ margin: '2px 0 0' }}>{t('tools.utls.echDesc')}</p>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.echEnabled}
            onChange={(e) => setSettings((s) => ({ ...s, echEnabled: e.target.checked }))}
          />
          <span className="switch-track" />
        </label>
      </div>
      <div className="toggle-row" style={{ marginBottom: 14 }}>
        <div>
          <span className="toggle-label">{t('tools.utls.fragmentLabel')}</span>
          <p className="section-desc" style={{ margin: '2px 0 0' }}>{t('tools.utls.fragmentDesc')}</p>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.fragmentEnabled ?? false}
            onChange={(e) => setSettings((s) => ({ ...s, fragmentEnabled: e.target.checked }))}
          />
          <span className="switch-track" />
        </label>
      </div>
      <button className="action-btn" type="button" onClick={save} disabled={saving}>
        {saved ? '✓' : saving ? '...' : t('tools.utls.saveBtn')}
      </button>
    </div>
  )
}

// ── QR Code Modal ─────────────────────────────────────────────────────────────

function QrModal({ uri, onClose }: { uri: string; onClose: () => void }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    import('qrcode').then((QRCode) => {
      QRCode.default.toDataURL(uri, { width: 280, margin: 2 })
        .then((url) => setDataUrl(url))
        .catch(() => {})
    }).catch(() => {})
    return () => window.removeEventListener('keydown', handleEscape)
  }, [uri, onClose])

  return (
    <div className="qr-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="qr-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="qr-modal-header">
          <span id="qr-modal-title">QR Code</span>
          <button ref={closeRef} className="qr-modal-close" type="button" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {dataUrl
          ? <img src={dataUrl} alt="QR Code" className="qr-modal-img" />
          : <div className="qr-modal-loading">...</div>
        }
        <div className="qr-modal-uri">{uri.slice(0, 60)}{uri.length > 60 ? '…' : ''}</div>
      </div>
    </div>
  )
}

// ── Settings Backup / Restore Section ────────────────────────────────────────

function BackupRestoreSection() {
  const { lang } = useContext(LangCtx)
  const [status, setStatus] = useState<string | null>(null)
  const rendererKeys = [
    'hd-theme',
    'hd-lang',
    'hamidsdeutsch:connection-settings:v1',
    'hamidsdeutsch:rescue-settings:v1',
    'hamidsdeutsch:direct-domains:v2',
    'hamidsdeutsch:selected-server:v2',
    'hamidsdeutsch:ctrl-enter',
    'hamidsdeutsch:server-sort',
  ] as const

  async function handleExport() {
    const r = await window.hamidsDeutsch.settings.export()
    if (!r.success || !r.data) { setStatus(lang === 'fa' ? 'خطا در صدور' : 'Export failed'); return }
    const rendererSettings: Record<string, string> = {}
    for (const key of rendererKeys) {
      const value = localStorage.getItem(key)
      if (value !== null) rendererSettings[key] = value
    }
    const json = JSON.stringify({
      ...r.data,
      rendererSettings,
    }, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hamidsdeutsch-settings-backup.json`
    a.click()
    URL.revokeObjectURL(url)
    setStatus(lang === 'fa' ? 'پشتیبان ذخیره شد' : 'Backup saved')
    setTimeout(() => setStatus(null), 3000)
  }

  function handleImport() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const backup = JSON.parse(text)
        const r = await window.hamidsDeutsch.settings.import(backup)
        if (r.success && backup.rendererSettings && typeof backup.rendererSettings === 'object') {
          for (const key of rendererKeys) {
            const value = backup.rendererSettings[key]
            if (typeof value === 'string') localStorage.setItem(key, value)
          }
        }
        setStatus(r.success ? (lang === 'fa' ? 'بازیابی انجام شد — برنامه را ری‌استارت کنید' : 'Restored — restart the app') : (r.error ?? 'Import failed'))
      } catch {
        setStatus(lang === 'fa' ? 'فایل نامعتبر' : 'Invalid file')
      }
      setTimeout(() => setStatus(null), 5000)
    }
    input.click()
  }

  return (
    <div className="settings-section">
      <div className="section-kicker">{lang === 'fa' ? 'پشتیبان‌گیری' : 'Backup'}</div>
      <h3 className="section-title">{lang === 'fa' ? 'پشتیبان تنظیمات' : 'Settings Backup & Restore'}</h3>
      <p className="section-desc" style={{ marginBottom: 14 }}>
        {lang === 'fa'
          ? 'تمام تنظیمات برنامه (اشتراک‌ها، سرورها، پروکسی، DNS و...) را به فایل JSON صادر یا وارد کنید.'
          : 'Export or import all app settings (subscriptions, servers, proxy, DNS, etc.) as a JSON file.'
        }
      </p>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="action-btn" type="button" onClick={handleExport}>
          {lang === 'fa' ? 'صدور پشتیبان' : 'Export Backup'}
        </button>
        <button className="action-btn action-btn-secondary" type="button" onClick={handleImport}>
          {lang === 'fa' ? 'بازیابی از فایل' : 'Import from File'}
        </button>
      </div>
      {status && <p className="section-desc" style={{ marginTop: 10, color: 'var(--c-accent)' }}>{status}</p>}
    </div>
  )
}


export default App
