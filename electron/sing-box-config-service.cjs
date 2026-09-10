const {
  createStableNodeId,
} = require('./server-node-id.cjs')

const {
  isCloudflareHost,
} = require('./cf-scan-store.cjs')

const { net } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

const DOWNLOAD_TIMEOUT_MS = 20000
const MAX_RESPONSE_SIZE_BYTES = 5 * 1024 * 1024
const CHECK_TIMEOUT_MS = 15000

const SUPPORTED_PROTOCOLS = [
  'vmess://',
  'vless://',
  'trojan://',
  'ss://',
  'hysteria2://',
  'hy2://',
  'tuic://',
  'anytls://',
]

async function createAndCheckConfig({
  subscriptionUrl,
  nodeId,
  nodeUri,
  enginePath,
  userDataPath,
  directDomains,
  rescueOptions,
  runtimeDirectoryName = 'runtime',
  configFileName = 'config.json',
  localPort = 2080,
  setSystemProxy = false,
  proxyDoH = false,
  vpnDns = null,
  upstreamProxy = null,
  utlsSettings = null,
  cfCleanIp = null,
  clashApiPort = 9090,
}) {
  validateRequest({
    subscriptionUrl,
    nodeId,
    enginePath,
    userDataPath,
  })

  let resolvedUri =
    typeof nodeUri === 'string' &&
    nodeUri.trim()
      ? nodeUri.trim()
      : null

  if (!resolvedUri) {
    const content =
      await downloadSubscriptionContent(
        subscriptionUrl,
      )

    const resolvedNode =
      resolveNodeById(
        content,
        nodeId,
      )

    if (!resolvedNode) {
      throw new Error(
        'سرور انتخاب‌شده در نسخه فعلی اشتراک پیدا نشد.',
      )
    }

    resolvedUri =
      resolvedNode.uri
  }

  const outbound =
    applyRescueOptions(
      applyUtlsSettings(
        buildOutboundFromUri(resolvedUri),
        utlsSettings,
      ),
      rescueOptions,
    )

  const normalizedDirectDomains =
    normalizeDirectDomains(
      directDomains,
    )

  const config = buildConfig(
    applyCfCleanIp(outbound, cfCleanIp, true),
    normalizedDirectDomains,
    localPort,
    setSystemProxy,
    proxyDoH,
    vpnDns,
    upstreamProxy,
    clashApiPort,
  )

  const runtimeDirectory = path.join(
    userDataPath,
    'HamidsDeutsch-Connect',
    runtimeDirectoryName,
  )

  const configPath = path.join(
    runtimeDirectory,
    configFileName,
  )

  await writeConfigAtomically(
    runtimeDirectory,
    configPath,
    config,
  )

  const checkResult =
    await checkConfig(
      enginePath,
      configPath,
    )

  return {
    success: checkResult.success,
    checkedAt:
      new Date().toISOString(),
    nodeId,
    protocol: outbound.type,
    server: outbound.server,
    serverPort:
      outbound.server_port,
    configPath,
    directDomainCount:
      normalizedDirectDomains.length,
    stdout: checkResult.stdout,
    error: checkResult.error,
  }
}

async function createAndCheckTunConfig({
  subscriptionUrl,
  nodeId,
  nodeUri,
  enginePath,
  userDataPath,
  directDomains,
  rescueOptions,
  runtimeDirectoryName = 'runtime',
  configFileName = 'tun-config.json',
  localPort = 2080,
  setSystemProxy = false,
  utlsSettings = null,
  directApps = [],
  vpnDns = null,
  upstreamProxy = null,
  clashApiPort = 9090,
  cfCleanIp = null,
}) {
  validateRequest({
    subscriptionUrl,
    nodeId,
    enginePath,
    userDataPath,
  })

  let resolvedUri =
    typeof nodeUri === 'string' &&
    nodeUri.trim()
      ? nodeUri.trim()
      : null

  if (!resolvedUri) {
    const content =
      await downloadSubscriptionContent(
        subscriptionUrl,
      )

    const resolvedNode =
      resolveNodeById(
        content,
        nodeId,
      )

    if (!resolvedNode) {
      throw new Error(
        'سرور انتخاب‌شده در نسخه فعلی اشتراک پیدا نشد.',
      )
    }

    resolvedUri =
      resolvedNode.uri
  }

  const outbound =
    applyCfCleanIp(
      applyRescueOptions(
        applyUtlsSettings(
          buildOutboundFromUri(resolvedUri),
          utlsSettings,
        ),
        rescueOptions,
      ),
      cfCleanIp,
      true,
    )

  const normalizedDirectDomains =
    normalizeDirectDomains(
      directDomains,
    )

  const config =
    buildTunConfig(
      outbound,
      normalizedDirectDomains,
      localPort,
      setSystemProxy,
      directApps,
      vpnDns,
      upstreamProxy,
      clashApiPort,
    )

  const runtimeDirectory = path.join(
    userDataPath,
    'HamidsDeutsch-Connect',
    runtimeDirectoryName,
  )

  const configPath = path.join(
    runtimeDirectory,
    configFileName,
  )

  await writeConfigAtomically(
    runtimeDirectory,
    configPath,
    config,
  )

  const checkResult =
    await checkConfig(
      enginePath,
      configPath,
    )

  return {
    success: checkResult.success,
    checkedAt:
      new Date().toISOString(),
    mode: 'tun',
    nodeId,
    protocol: outbound.type,
    server: outbound.server,
    serverPort:
      outbound.server_port,
    configPath,
    interfaceName:
      null,
    directDomainCount:
      normalizedDirectDomains.length,
    stdout: checkResult.stdout,
    error: checkResult.error,
  }
}

function validateRequest({
  subscriptionUrl,
  nodeId,
  enginePath,
  userDataPath,
}) {
  if (
    typeof subscriptionUrl !== 'string' ||
    !subscriptionUrl.trim()
  ) {
    throw new Error(
      'لینک اشتراک در دسترس نیست.',
    )
  }

  if (
    typeof nodeId !== 'string' ||
    !nodeId.trim()
  ) {
    throw new Error(
      'شناسه سرور انتخاب‌شده معتبر نیست.',
    )
  }

  if (
    typeof enginePath !== 'string' ||
    !enginePath.trim()
  ) {
    throw new Error(
      'مسیر sing-box معتبر نیست.',
    )
  }

  if (
    typeof userDataPath !== 'string' ||
    !userDataPath.trim()
  ) {
    throw new Error(
      'مسیر داده برنامه معتبر نیست.',
    )
  }
}

async function downloadSubscriptionContent(
  subscriptionUrl,
) {
  let parsedUrl

  try {
    parsedUrl = new URL(
      subscriptionUrl,
    )
  } catch {
    throw new Error(
      'لینک ذخیره‌شده اشتراک معتبر نیست.',
    )
  }

  if (
    parsedUrl.protocol !== 'https:' &&
    parsedUrl.protocol !== 'http:'
  ) {
    throw new Error(
      'پروتکل لینک اشتراک پشتیبانی نمی‌شود.',
    )
  }

  const controller =
    new AbortController()

  const timeout = setTimeout(() => {
    controller.abort()
  }, DOWNLOAD_TIMEOUT_MS)

  try {
    const response = await net.fetch(
      parsedUrl.toString(),
      {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          Accept:
            'text/plain, application/json, application/octet-stream;q=0.9, */*;q=0.8',
          'User-Agent':
            'HamidsDeutsch-Connect/0.1.0',
        },
      },
    )

    if (!response.ok) {
      throw new Error(
        `سرور اشتراک با وضعیت HTTP ${response.status} پاسخ داد.`,
      )
    }

    const declaredSize = Number(
      response.headers.get(
        'content-length',
      ),
    )

    if (
      Number.isFinite(declaredSize) &&
      declaredSize >
        MAX_RESPONSE_SIZE_BYTES
    ) {
      throw new Error(
        'حجم اشتراک بیشتر از محدودیت ۵ مگابایت است.',
      )
    }

    const buffer = Buffer.from(
      await response.arrayBuffer(),
    )

    if (
      buffer.byteLength >
      MAX_RESPONSE_SIZE_BYTES
    ) {
      throw new Error(
        'حجم اشتراک بیشتر از محدودیت ۵ مگابایت است.',
      )
    }

    const content = buffer
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .trim()

    if (!content) {
      throw new Error(
        'پاسخ اشتراک خالی است.',
      )
    }

    return content
  } catch (error) {
    if (
      error?.name === 'AbortError'
    ) {
      throw new Error(
        'زمان دریافت اشتراک بیش از ۲۰ ثانیه شد.',
      )
    }

    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function resolveNodeById(
  content,
  targetNodeId,
) {
  const normalizedContent =
    decodeSubscriptionContent(
      content,
    )

  const lines = normalizedContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    const lowerLine =
      line.toLowerCase()

    if (
      !SUPPORTED_PROTOCOLS.some(
        (protocol) =>
          lowerLine.startsWith(
            protocol,
          ),
      )
    ) {
      continue
    }

    const safeNode =
      parseSafeNode(line)

    const nodeId =
      createStableNodeId(line)

    if (nodeId === targetNodeId) {
      return {
        uri: line,
        safeNode,
      }
    }

  }

  return null
}

function decodeSubscriptionContent(
  content,
) {
  const trimmedContent = content
    .replace(/^\uFEFF/, '')
    .trim()

  if (
    SUPPORTED_PROTOCOLS.some(
      (protocol) =>
        trimmedContent
          .toLowerCase()
          .includes(protocol),
    )
  ) {
    return trimmedContent
  }

  const decoded =
    decodeBase64Value(
      trimmedContent,
    )

  return decoded?.trim() ||
    trimmedContent
}

function parseSafeNode(uri) {
  const protocol = uri
    .slice(0, uri.indexOf('://'))
    .toLowerCase()

  if (protocol === 'vmess') {
    const config =
      parseVmessPayload(uri)

    return {
      name:
        normalizeNodeName(
          config.ps,
        ) ||
        createDefaultName(
          'VMess',
          normalizeHost(
            config.add,
          ),
        ),
      protocol,
      host: normalizeHost(
        config.add,
      ),
      port: normalizePort(
        config.port,
      ),
    }
  }

  if (protocol === 'ss') {
    const parsed =
      parseShadowsocksUri(uri)

    return {
      name:
        parsed.name ||
        createDefaultName(
          'Shadowsocks',
          parsed.host,
        ),
      protocol,
      host: parsed.host,
      port: parsed.port,
    }
  }

  const parsed = new URL(uri)

  return {
    name:
      extractFragmentName(
        parsed.hash,
      ) ||
      createDefaultName(
        formatProtocolName(
          protocol,
        ),
        normalizeHost(
          parsed.hostname,
        ),
      ),
    protocol,
    host: normalizeHost(
      parsed.hostname,
    ),
    port: normalizePort(
      parsed.port,
    ),
  }
}

function buildOutboundFromUri(uri) {
  const protocol = uri
    .slice(0, uri.indexOf('://'))
    .toLowerCase()

  switch (protocol) {
    case 'vless':
      return buildVlessOutbound(uri)

    case 'vmess':
      return buildVmessOutbound(uri)

    case 'trojan':
      return buildTrojanOutbound(uri)

    case 'ss':
      return buildShadowsocksOutbound(uri)

    case 'hysteria2':
    case 'hy2':
      return buildHysteria2Outbound(uri)

    case 'tuic':
      return buildTuicOutbound(uri)

    case 'anytls':
      return buildAnyTlsOutbound(uri)

    default:
      throw new Error(
        `پروتکل ${protocol} هنوز برای ساخت کانفیگ پشتیبانی نمی‌شود.`,
      )
  }
}

function buildVlessOutbound(uri) {
  const parsed = new URL(uri)
  const params = parsed.searchParams

  const uuid = decodeURIComponent(
    parsed.username,
  )

  if (!uuid) {
    throw new Error(
      'UUID کانفیگ VLESS خالی است.',
    )
  }

  const outbound = {
    type: 'vless',
    tag: 'proxy',
    server: requireHost(parsed),
    server_port: requirePort(parsed),
    uuid,
  }

  const flow = params.get('flow')

  if (flow) {
    outbound.flow = flow
  }

  const tls = buildTlsConfig(
    params,
    parsed.hostname,
  )

  if (tls) {
    outbound.tls = tls
  }

  const transport =
    buildTransportConfig(params)

  if (transport) {
    outbound.transport =
      transport
  }

  return outbound
}

function buildVmessOutbound(uri) {
  const config =
    parseVmessPayload(uri)

  const host = normalizeHost(
    config.add,
  )

  const port = normalizePort(
    config.port,
  )

  const uuid = normalizeText(
    config.id,
  )

  if (!host || !port || !uuid) {
    throw new Error(
      'اطلاعات ضروری کانفیگ VMess ناقص است.',
    )
  }

  const outbound = {
    type: 'vmess',
    tag: 'proxy',
    server: host,
    server_port: port,
    uuid,
    security:
      normalizeText(config.scy) ||
      'auto',
    alter_id:
      Number.isFinite(
        Number(config.aid),
      )
        ? Number(config.aid)
        : 0,
  }

  const params =
    new URLSearchParams()

  if (config.net) {
    params.set(
      'type',
      String(config.net),
    )
  }

  if (config.path) {
    params.set(
      'path',
      String(config.path),
    )
  }

  if (config.host) {
    params.set(
      'host',
      String(config.host),
    )
  }

  if (config.sni) {
    params.set(
      'sni',
      String(config.sni),
    )
  }

  if (config.alpn) {
    params.set(
      'alpn',
      String(config.alpn),
    )
  }

  if (
    String(config.tls)
      .toLowerCase() === 'tls'
  ) {
    params.set(
      'security',
      'tls',
    )
  }

  const tls = buildTlsConfig(
    params,
    host,
  )

  if (tls) {
    outbound.tls = tls
  }

  const transport =
    buildTransportConfig(params)

  if (transport) {
    outbound.transport =
      transport
  }

  return outbound
}

function buildTrojanOutbound(uri) {
  const parsed = new URL(uri)
  const params = parsed.searchParams

  const password = decodeURIComponent(
    parsed.username,
  )

  if (!password) {
    throw new Error(
      'رمز کانفیگ Trojan خالی است.',
    )
  }

  const outbound = {
    type: 'trojan',
    tag: 'proxy',
    server: requireHost(parsed),
    server_port: requirePort(parsed),
    password,
  }

  const tls =
    buildTlsConfig(
      params,
      parsed.hostname,
      true,
    )

  if (tls) {
    outbound.tls = tls
  }

  const transport =
    buildTransportConfig(params)

  if (transport) {
    outbound.transport =
      transport
  }

  return outbound
}

function buildShadowsocksOutbound(uri) {
  const parsed =
    parseShadowsocksUri(uri)

  if (
    !parsed.host ||
    !parsed.port ||
    !parsed.method ||
    !parsed.password
  ) {
    throw new Error(
      'اطلاعات ضروری کانفیگ Shadowsocks ناقص است.',
    )
  }

  const outbound = {
    type: 'shadowsocks',
    tag: 'proxy',
    server: parsed.host,
    server_port: parsed.port,
    method: parsed.method,
    password: parsed.password,
  }

  if (parsed.plugin) {
    outbound.plugin =
      parsed.plugin

    if (parsed.pluginOpts) {
      outbound.plugin_opts =
        parsed.pluginOpts
    }
  }

  return outbound
}

function buildHysteria2Outbound(uri) {
  const parsed = new URL(uri)
  const params = parsed.searchParams

  const password =
    decodeURIComponent(
      parsed.username,
    ) ||
    params.get('auth') ||
    params.get('password')

  if (!password) {
    throw new Error(
      'رمز کانفیگ Hysteria 2 خالی است.',
    )
  }

  const outbound = {
    type: 'hysteria2',
    tag: 'proxy',
    server: requireHost(parsed),
    server_port: requirePort(parsed),
    password,
    tls:
      buildTlsConfig(
        params,
        parsed.hostname,
        true,
      ),
  }

  const obfsType =
    params.get('obfs')

  const obfsPassword =
    params.get(
      'obfs-password',
    ) ||
    params.get('obfsPassword')

  if (
    obfsType &&
    obfsPassword
  ) {
    outbound.obfs = {
      type: obfsType,
      password:
        obfsPassword,
    }
  }

  const upMbps =
    normalizePositiveNumber(
      params.get('upmbps') ||
      params.get('up')
    )

  const downMbps =
    normalizePositiveNumber(
      params.get('downmbps') ||
      params.get('down')
    )

  if (upMbps) {
    outbound.up_mbps = upMbps
  }

  if (downMbps) {
    outbound.down_mbps =
      downMbps
  }

  return outbound
}

function buildTuicOutbound(uri) {
  const parsed = new URL(uri)
  const params = parsed.searchParams

  const uuid = decodeURIComponent(
    parsed.username,
  )

  const password = decodeURIComponent(
    parsed.password,
  )

  if (!uuid || !password) {
    throw new Error(
      'UUID یا رمز کانفیگ TUIC ناقص است.',
    )
  }

  const congestionControl =
    params.get(
      'congestion_control',
    ) ||
    params.get(
      'congestion-control',
    ) ||
    'cubic'

  return {
    type: 'tuic',
    tag: 'proxy',
    server: requireHost(parsed),
    server_port: requirePort(parsed),
    uuid,
    password,
    congestion_control:
      congestionControl,
    udp_relay_mode:
      params.get(
        'udp_relay_mode',
      ) ||
      params.get(
        'udp-relay-mode',
      ) ||
      'native',
    tls:
      buildTlsConfig(
        params,
        parsed.hostname,
        true,
      ),
  }
}

function buildAnyTlsOutbound(uri) {
  const parsed = new URL(uri)
  const params = parsed.searchParams

  const password = decodeURIComponent(parsed.username) || params.get('password')
  if (!password) {
    throw new Error('رمز کانفیگ AnyTLS خالی است.')
  }

  const outbound = {
    type: 'anytls',
    tag: 'proxy',
    server: requireHost(parsed),
    server_port: requirePort(parsed),
    password,
    tls: buildTlsConfig(params, parsed.hostname, true),
  }

  const idleSessionCheckInterval = params.get('idle_session_check_interval') || params.get('idle-session-check-interval')
  if (idleSessionCheckInterval) {
    outbound.idle_session_check_interval = idleSessionCheckInterval
  }

  const idleSessionTimeout = params.get('idle_session_timeout') || params.get('idle-session-timeout')
  if (idleSessionTimeout) {
    outbound.idle_session_timeout = idleSessionTimeout
  }

  return outbound
}

function buildTlsConfig(
  params,
  fallbackServerName,
  forceEnabled = false,
) {
  const security = (
    params.get('security') ||
    params.get('tls') ||
    ''
  ).toLowerCase()

  const enabled =
    forceEnabled ||
    security === 'tls' ||
    security === 'reality'

  if (!enabled) {
    return null
  }

  const serverName =
    params.get('sni') ||
    params.get('serverName') ||
    fallbackServerName

  const tls = {
    enabled: true,
    server_name: serverName,
    insecure:
      parseBoolean(
        params.get(
          'allowInsecure',
        ) ||
        params.get('insecure'),
      ),
  }

  const alpn = splitList(
    params.get('alpn'),
  )

  if (alpn.length > 0) {
    tls.alpn = alpn
  }

  const fingerprint =
    params.get('fp') || 'chrome'  // default to Chrome uTLS for all TLS outbounds

  // uTLS is REQUIRED for all TLS/REALITY outbounds in sing-box 1.13 — the REALITY
  // client refuses to initialize without it ("uTLS is required by reality client").
  tls.utls = {
    enabled: true,
    fingerprint,
  }

  // ECH — hides SNI from DPI; sing-box fetches ECH config via DNS when not provided
  if (parseBoolean(params.get('ech'))) {
    tls.ech = { enabled: true }
  }

  if (security === 'reality') {
    const publicKey =
      params.get('pbk')

    const shortId =
      params.get('sid') ?? ''

    if (!publicKey) {
      throw new Error(
        'کلید عمومی Reality در کانفیگ وجود ندارد.',
      )
    }

    tls.reality = {
      enabled: true,
      public_key: publicKey,
      short_id: shortId,
    }
  }

  return tls
}

function buildTransportConfig(params) {
  const type = (
    params.get('type') ||
    params.get('transport') ||
    'tcp'
  ).toLowerCase()

  const pathValue =
    params.get('path') ||
    '/'

  const hostValue =
    params.get('host') ||
    ''

  if (
    type === 'tcp' ||
    type === 'none' ||
    !type
  ) {
    return null
  }

  if (
    type === 'ws' ||
    type === 'websocket'
  ) {
    const transport = {
      type: 'ws',
      path: pathValue,
    }

    if (hostValue) {
      transport.headers = {
        Host: hostValue,
      }
    }

    const earlyData =
      normalizePositiveNumber(
        params.get('ed'),
      )

    if (earlyData) {
      transport.max_early_data =
        earlyData

      transport.early_data_header_name =
        params.get('eh') ||
        'Sec-WebSocket-Protocol'
    }

    return transport
  }

  if (type === 'grpc') {
    return {
      type: 'grpc',
      service_name:
        params.get(
          'serviceName',
        ) ||
        params.get(
          'service_name',
        ) ||
        pathValue.replace(
          /^\//,
          '',
        ),
    }
  }

  if (
    type === 'httpupgrade' ||
    type === 'http-upgrade'
  ) {
    const transport = {
      type: 'httpupgrade',
      path: pathValue,
    }

    if (hostValue) {
      transport.host =
        hostValue
    }

    return transport
  }

  if (
    type === 'http' ||
    type === 'h2'
  ) {
    const transport = {
      type: 'http',
      path: pathValue,
    }

    if (hostValue) {
      transport.host =
        splitList(hostValue)
    }

    return transport
  }

  if (type === 'quic') {
    return {
      type: 'quic',
    }
  }

  if (type === 'xhttp' || type === 'splithttp') {
    return {
      type: 'splithttp',
      path: pathValue,
    }
  }

  throw new Error(
    `نوع انتقال ${type} هنوز پشتیبانی نمی‌شود.`,
  )
}

function buildDirectRules(directDomains) {
  if (!directDomains || directDomains.length === 0) return []
  const protectedProxyDomains = [
    'x.com',
    'twitter.com',
    'twimg.com',
    'instagram.com',
    'cdninstagram.com',
    'facebook.com',
    'fbcdn.net',
    'threads.net',
    'telegram.org',
    't.me',
  ]
  const isProtectedProxyDomain = (value) => {
    const normalized = String(value ?? '').trim().toLowerCase().replace(/^\./, '')
    return protectedProxyDomains.some(
      (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
    )
  }
  const safeDirectDomains = directDomains.filter((value) => !isProtectedProxyDomain(value))
  const ipValues = safeDirectDomains.filter((value) =>
    /^(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?$/.test(value) ||
    /^[0-9a-f:]+(?:\/\d{1,3})?$/i.test(value),
  )
  const domains = safeDirectDomains.filter((value) => !ipValues.includes(value))
  return [
    ...(domains.length > 0 ? [{ domain: domains, outbound: 'direct' }] : []),
    ...(domains.length > 0 ? [{
      domain_suffix: domains.map((domain) => `.${domain}`),
      outbound: 'direct',
    }] : []),
    ...(ipValues.length > 0 ? [{ ip_cidr: ipValues, outbound: 'direct' }] : []),
  ]
}

function buildDnsRules(directDomains) {
  if (!directDomains || directDomains.length === 0) return []
  const protectedProxyDomains = [
    'x.com',
    'twitter.com',
    'twimg.com',
    'instagram.com',
    'cdninstagram.com',
    'facebook.com',
    'fbcdn.net',
    'threads.net',
    'telegram.org',
    't.me',
  ]
  const domains = directDomains.filter((value) =>
    !/^(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?$/.test(value) &&
    !/^[0-9a-f:]+(?:\/\d{1,3})?$/i.test(value) &&
    !protectedProxyDomains.some((domain) => {
      const normalized = String(value ?? '').trim().toLowerCase().replace(/^\./, '')
      return normalized === domain || normalized.endsWith(`.${domain}`)
    }),
  )
  if (domains.length === 0) return []
  return [
    {
      domain: domains,
      action: 'route',
      server: 'dns-direct',
    },
    {
      domain_suffix: domains.map((domain) => `.${domain}`),
      action: 'route',
      server: 'dns-direct',
    },
  ]
}

function buildProxyDnsBlock(directDomains = [], vpnDns = null) {
  const encryptedDnsServers = {
    '1.1.1.1': 'cloudflare-dns.com',
    '1.0.0.1': 'cloudflare-dns.com',
    '8.8.8.8': 'dns.google',
    '8.8.4.4': 'dns.google',
    '94.140.14.14': 'dns.adguard-dns.com',
    '94.140.15.15': 'dns.adguard-dns.com',
  }
  const selectedAddress = vpnDns?.primary || '1.1.1.1'
  const tlsServerName = encryptedDnsServers[selectedAddress]
  // Derive the DoH SNI from the template URL. Hardcoding cloudflare-dns.com
  // handed a Cloudflare SNI to whatever resolver the user picked, so the TLS
  // handshake failed and no name resolved inside the tunnel.
  const templateUrl = (() => {
    if (!vpnDns?.template) return null
    try {
      return new URL(String(vpnDns.template))
    } catch {
      return null
    }
  })()
  const templateHost = templateUrl?.hostname || null
  const selectedDns = vpnDns?.template
    ? {
        tag: 'dns-proxy',
        type: 'https',
        server: selectedAddress,
        server_port: 443,
        path: templateUrl?.pathname || '/dns-query',
        detour: 'proxy',
        tls: {
          enabled: true,
          server_name: templateHost ?? tlsServerName ?? 'cloudflare-dns.com',
        },
      }
    : tlsServerName
    ? {
        tag: 'dns-proxy',
        type: 'tls',
        server: selectedAddress,
        server_port: 853,
        detour: 'proxy',
        tls: {
          enabled: true,
          server_name: tlsServerName,
        },
      }
    : {
        tag: 'dns-proxy',
        type: 'udp',
        server: selectedAddress,
        server_port: 53,
        detour: 'proxy',
      }
  return {
    servers: [
      selectedDns,
      {
        tag: 'dns-direct',
        type: 'local',
        // Pinned to the direct outbound on purpose. With auto_route capturing
        // everything, an undetoured bootstrap query is dialled through
        // route.final and deadlocks against the tunnel it is meant to bring up.
        detour: 'direct',
      },
    ],
    rules: buildDnsRules(directDomains),
    final: 'dns-proxy',
    independent_cache: true,
  }
}

function buildConfig(
  proxyOutbound,
  directDomains,
  localPort = 2080,
  setSystemProxy = false,
  proxyDoH = false,
  vpnDns = null,
  upstreamProxy = null,
  clashApiPort = 9090,
) {
  const rules = buildDirectRules(directDomains)
  const outbounds = []
  const useInternalDns = proxyDoH || Boolean(vpnDns?.primary)

  // If upstream proxy chaining is enabled, route the main proxy outbound through it
  // The server address must be bootstrapped outside the tunnel. Pointing the
  // proxy outbound at dns-proxy creates a dependency cycle: dns-proxy itself
  // is configured to use that same proxy.
  const resolvedProxyOutbound = upstreamProxy?.enabled && upstreamProxy?.host
    ? { ...(useInternalDns ? { ...proxyOutbound, domain_resolver: 'dns-direct' } : proxyOutbound), detour: 'upstream-proxy' }
    : (useInternalDns ? { ...proxyOutbound, domain_resolver: 'dns-direct' } : proxyOutbound)

  outbounds.push(resolvedProxyOutbound)
  outbounds.push(
    useInternalDns
      ? { type: 'direct', tag: 'direct', domain_resolver: 'dns-direct' }
      : { type: 'direct', tag: 'direct' },
  )

  if (upstreamProxy?.enabled && upstreamProxy?.host) {
    outbounds.push(buildUpstreamProxyOutbound(upstreamProxy))
  }

  const config = {
    log: {
      level: 'warn',
      timestamp: true,
    },

    inbounds: [
      {
        type: 'mixed',
        tag: 'mixed-in',
        listen: '127.0.0.1',
        listen_port: localPort,
        set_system_proxy:
          setSystemProxy,
      },
    ],

    outbounds,

    route: {
      rules,
      final: 'proxy',
      auto_detect_interface: true,
    },
  }

  if (useInternalDns) {
    config.dns = buildProxyDnsBlock(directDomains, vpnDns)
  }

  config.experimental = { clash_api: { external_controller: `127.0.0.1:${clashApiPort}` } }

  return config
}

function buildUpstreamProxyOutbound(upstreamProxy) {
  const type = upstreamProxy.type === 'http' ? 'http' : 'socks'
  const outbound = {
    type,
    tag: 'upstream-proxy',
    server: upstreamProxy.host,
    server_port: upstreamProxy.port,
  }
  if (type === 'socks') {
    outbound.version = '5'
  }
  return outbound
}

function buildTunConfig(
  proxyOutbound,
  directDomains,
  localPort = 2080,
  setSystemProxy = false,
  directApps = [],
  vpnDns = null,
  upstreamProxy = null,
  clashApiPort = 9090,
) {
  const appEntries = Array.isArray(directApps) ? directApps : []
  const appNames = Array.from(new Set(appEntries.map((entry) =>
    typeof entry === 'string' ? entry : entry?.processName,
  ).map((value) => String(value ?? '').trim()).filter(Boolean))).slice(0, 500)
  const appPaths = Array.from(new Set(appEntries.map((entry) =>
    typeof entry === 'object' ? entry?.path : '',
  ).map((value) => String(value ?? '').trim()).filter(Boolean))).slice(0, 500)

  const rules = [
    // Sniff first. `protocol` is only known once a connection has been sniffed,
    // so a hijack rule placed above this one never matches, and DNS escapes as
    // plain UDP to whatever resolver Windows was using. On a VLESS outbound
    // with the vision flow that UDP has nowhere to go, which leaves a tunnel
    // that reports itself up while resolving nothing.
    {
      action: 'sniff',
    },
    // Capture DNS before routing domain rules. Without this, Windows resolves a
    // bypass host outside sing-box and TUN only sees the resulting IP, so the
    // Direct Sites domain rule can never match.
    {
      protocol: 'dns',
      action: 'hijack-dns',
    },
    // Belt and braces for queries that arrive unsniffable.
    {
      port: 53,
      action: 'hijack-dns',
    },
    {
      ip_is_private: true,
      outbound: 'direct',
    },
    ...(appNames.length > 0 ? [{ process_name: appNames, outbound: 'direct' }] : []),
    ...(appPaths.length > 0 ? [{ process_path: appPaths, outbound: 'direct' }] : []),
    ...buildDirectRules(directDomains),
  ]

  return {
    log: {
      level: 'warn',
      timestamp: true,
    },

    inbounds: [
      {
        type: 'tun',
        tag: 'tun-in',
        address: [
          '172.19.0.1/30',
          'fdfe:dcba:9876::1/126',
        ],
        mtu: 1400,
        auto_route: true,
        strict_route: false,
        stack: 'mixed',
      },
      {
        type: 'mixed',
        tag: 'mixed-in',
        listen: '127.0.0.1',
        listen_port: localPort,
        set_system_proxy:
          setSystemProxy,
      },
    ],

    outbounds: [
      {
        ...proxyOutbound,
        domain_resolver: 'dns-direct',
        ...(upstreamProxy?.enabled && upstreamProxy?.host ? { detour: 'upstream-proxy' } : {}),
      },
      {
        type: 'direct',
        tag: 'direct',
        domain_resolver: 'dns-direct',
      },
      ...(upstreamProxy?.enabled && upstreamProxy?.host ? [buildUpstreamProxyOutbound(upstreamProxy)] : []),
    ],

    dns: buildProxyDnsBlock(directDomains, vpnDns),

    route: {
      rules,
      final: 'proxy',
      auto_detect_interface: true,
      default_domain_resolver: 'dns-direct',
    },

    experimental: { clash_api: { external_controller: `127.0.0.1:${clashApiPort}` } },
  }
}

function applyUtlsSettings(outbound, utlsSettings) {
  if (!utlsSettings || !outbound?.tls?.enabled) return outbound
  const { globalFingerprint, echEnabled } = utlsSettings
  if (!globalFingerprint || globalFingerprint === 'auto') {
    if (!echEnabled) return outbound
    // Only ECH, no fingerprint override
    return { ...outbound, tls: { ...outbound.tls, ech: { enabled: true } } }
  }
  const tls = { ...outbound.tls }
  if (tls.utls) {
    tls.utls = { ...tls.utls, fingerprint: globalFingerprint }
  } else {
    tls.utls = { enabled: true, fingerprint: globalFingerprint }
  }
  if (echEnabled) {
    tls.ech = { enabled: true }
  }
  return { ...outbound, tls }
}

function buildWarpConfig(warpOutbound, directDomains, localPort = 2080, setSystemProxy = false) {
  const rules = buildDirectRules(directDomains)
  return {
    log: { level: 'warn', timestamp: true },
    inbounds: [
      {
        type: 'mixed',
        tag: 'mixed-in',
        listen: '127.0.0.1',
        listen_port: localPort,
        set_system_proxy: setSystemProxy,
      },
    ],
    // sing-box 1.13: WireGuard lives in `endpoints`, not `outbounds`.
    endpoints: [
      warpOutbound,
    ],
    outbounds: [
      { type: 'direct', tag: 'direct' },
    ],
    route: {
      rules,
      final: 'proxy',
      auto_detect_interface: true,
    },
    experimental: { clash_api: { external_controller: '127.0.0.1:9090' } },
  }
}

async function createAndCheckWarpConfig({
  warpOutbound,
  enginePath,
  userDataPath,
  directDomains,
  runtimeDirectoryName = 'runtime',
  configFileName = 'config.json',
  localPort = 2080,
  setSystemProxy = false,
}) {
  const normalizedDirectDomains = normalizeDirectDomains(directDomains)
  const config = buildWarpConfig(warpOutbound, normalizedDirectDomains, localPort, setSystemProxy)

  const runtimeDirectory = path.join(userDataPath, 'HamidsDeutsch-Connect', runtimeDirectoryName)
  const configPath = path.join(runtimeDirectory, configFileName)

  await writeConfigAtomically(runtimeDirectory, configPath, config)
  const checkResult = await checkConfig(enginePath, configPath)

  return {
    success: checkResult.success,
    checkedAt: new Date().toISOString(),
    protocol: 'wireguard',
    configPath,
    directDomainCount: normalizedDirectDomains.length,
    stdout: checkResult.stdout,
    error: checkResult.error,
  }
}

/**
 * Point the outbound at a scanned clean Cloudflare address while keeping every
 * name the edge needs to route the request.
 *
 * The caller decides whether the host is really behind Cloudflare (it resolves
 * the name and checks the answers against Cloudflare's ranges). The old
 * suffix-only re-check here rejected every custom domain, which is how almost
 * every real configuration is written, so scanned addresses were collected and
 * then silently discarded. `trusted` lets the caller's verdict stand.
 */
function applyCfCleanIp(outbound, cfCleanIp, trusted = false) {
  if (!cfCleanIp || !outbound?.server) return outbound
  if (!trusted && !isCloudflareHost(outbound.server)) return outbound

  const originalHost = outbound.server
  // Replacing the address with a literal IP strips the name the edge routes on,
  // so pin it explicitly wherever the protocol carries one.
  const tls = outbound.tls ? { ...outbound.tls } : null
  if (tls && !tls.server_name) {
    tls.server_name = originalHost
  }

  let transport = outbound.transport
  if (transport && (transport.type === 'ws' || transport.type === 'httpupgrade')) {
    const headers = { ...(transport.headers ?? {}) }
    const hasHost = Object.keys(headers).some((key) => key.toLowerCase() === 'host')
    if (!hasHost) headers.Host = originalHost
    transport = { ...transport, headers }
  } else if (transport && transport.type === 'http') {
    const hosts = Array.isArray(transport.host) ? transport.host : []
    if (hosts.length === 0) transport = { ...transport, host: [originalHost] }
  }

  return {
    ...outbound,
    server: cfCleanIp,
    ...(tls ? { tls } : {}),
    ...(transport ? { transport } : {}),
  }
}

function applyRescueOptions(
  outbound,
  rescueOptions,
) {
  const options =
    normalizeRescueOptions(
      rescueOptions,
    )

  if (
    !options.enabled ||
    !outbound?.tls?.enabled
  ) {
    return outbound
  }

  const tls = {
    ...outbound.tls,
  }

  if (
    options.customSni
  ) {
    tls.server_name =
      options.customSni
  }

  // sing-box 1.12+ supports both lightweight TLS-record fragmentation and
  // full handshake fragmentation directly on outbound TLS. Keep the lighter
  // option independent so users do not pay the performance cost of full
  // fragmentation unless they explicitly enabled it.
  tls.record_fragment =
    options.recordFragment

  tls.fragment =
    options.handshakeFragment

  if (options.handshakeFragment) {
    tls.fragment_fallback_delay =
      options.fragmentFallbackDelay
  }

  // Preserve an explicitly configured fingerprint. DPI retry uses Chrome;
  // normal rescue mode uses a randomized fingerprint as a secondary measure.
  if (!tls.utls) {
    if (options.dpiBypass) {
      // Chrome fingerprint is the most widely accepted and hardest to block
      tls.utls = { enabled: true, fingerprint: 'chrome' }
    } else if (options.handshakeFragment || options.recordFragment) {
      // Even light rescue enables randomized uTLS
      tls.utls = { enabled: true, fingerprint: 'randomized' }
    }
  }

  if (options.echEnabled) {
    tls.ech = { enabled: true }
  }

  return {
    ...outbound,
    tls,
  }
}

function normalizeRescueOptions(
  value,
) {
  const enabled =
    Boolean(
      value?.enabled,
    )

  const customSni =
    normalizeServerName(
      value?.customSni,
    )

  const delay =
    normalizeDuration(
      value?.fragmentFallbackDelay,
      '500ms',
    )

  return {
    enabled,
    recordFragment:
      enabled &&
      value?.recordFragment !==
        false,
    handshakeFragment:
      enabled &&
      Boolean(
        value?.handshakeFragment,
      ),
    fragmentFallbackDelay:
      delay,
    customSni,
    dpiBypass:
      enabled &&
      Boolean(value?.dpiBypass),
    echEnabled:
      enabled &&
      Boolean(value?.echEnabled),
  }
}

function normalizeServerName(
  value,
) {
  if (
    typeof value !== 'string'
  ) {
    return ''
  }

  const normalized =
    value
      .trim()
      .toLowerCase()
      .replace(/\.$/, '')

  if (!normalized) {
    return ''
  }

  if (
    normalized.length > 253 ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
      normalized,
    )
  ) {
    throw new Error(
      'SNI سفارشی معتبر نیست.',
    )
  }

  return normalized
}

function normalizeDuration(
  value,
  fallback,
) {
  if (
    typeof value !== 'string'
  ) {
    return fallback
  }

  const normalized =
    value.trim()

  if (
    !/^\d+(?:\.\d+)?(?:ms|s)$/.test(
      normalized,
    )
  ) {
    return fallback
  }

  return normalized
}

function normalizeDirectDomains(values) {
  if (!Array.isArray(values)) {
    return []
  }

  return Array.from(
    new Set(
      values
        .filter(
          (value) =>
            typeof value ===
            'string',
        )
        .map((value) =>
          value
            .trim()
            .toLowerCase()
            .replace(/^\./, '')
            .replace(/\.$/, ''),
        )
        .filter(Boolean)
        .slice(0, 5000),
    ),
  )
}

async function writeConfigAtomically(
  runtimeDirectory,
  configPath,
  config,
) {
  await fs.mkdir(
    runtimeDirectory,
    {
      recursive: true,
    },
  )

  const temporaryPath =
    `${configPath}.tmp`

  await fs.writeFile(
    temporaryPath,
    JSON.stringify(
      config,
      null,
      2,
    ),
    'utf8',
  )

  await fs.rm(
    configPath,
    {
      force: true,
    },
  )

  await fs.rename(
    temporaryPath,
    configPath,
  )
}

async function checkConfig(
  enginePath,
  configPath,
) {
  try {
    const {
      stdout,
      stderr,
    } = await execFileAsync(
      enginePath,
      [
        'check',
        '-c',
        configPath,
      ],
      {
        windowsHide: true,
        timeout:
          CHECK_TIMEOUT_MS,
        encoding: 'utf8',
      },
    )

    return {
      success: true,
      stdout:
        `${stdout}\n${stderr}`
          .trim(),
      error: null,
    }
  } catch (error) {
    const stdout =
      typeof error?.stdout ===
      'string'
        ? error.stdout
        : ''

    const stderr =
      typeof error?.stderr ===
      'string'
        ? error.stderr
        : ''

    const message =
      `${stdout}\n${stderr}`
        .trim() ||
      (error instanceof Error
        ? error.message
        : 'اعتبارسنجی کانفیگ ناموفق بود.')

    return {
      success: false,
      stdout: '',
      error: sanitizeEngineError(
        message,
      ),
    }
  }
}

function sanitizeEngineError(message) {
  return String(message)
    .replace(
      /[A-Za-z0-9+/=_-]{32,}/g,
      '[hidden]',
    )
    .slice(0, 2000)
}

function parseVmessPayload(uri) {
  const encoded = uri.slice(
    'vmess://'.length,
  )

  const decoded =
    decodeBase64Value(encoded)

  if (!decoded) {
    throw new Error(
      'رمزگشایی VMess ناموفق بود.',
    )
  }

  try {
    return JSON.parse(decoded)
  } catch {
    throw new Error(
      'ساختار JSON کانفیگ VMess معتبر نیست.',
    )
  }
}

function parseShadowsocksUri(uri) {
  const withoutScheme = uri.slice(
    'ss://'.length,
  )

  const hashIndex =
    withoutScheme.indexOf('#')

  const rawName =
    hashIndex >= 0
      ? withoutScheme.slice(
          hashIndex + 1,
        )
      : ''

  const withoutHash =
    hashIndex >= 0
      ? withoutScheme.slice(
          0,
          hashIndex,
        )
      : withoutScheme

  const queryIndex =
    withoutHash.indexOf('?')

  const query =
    queryIndex >= 0
      ? withoutHash.slice(
          queryIndex + 1,
        )
      : ''

  let mainPart =
    queryIndex >= 0
      ? withoutHash.slice(
          0,
          queryIndex,
        )
      : withoutHash

  if (!mainPart.includes('@')) {
    mainPart =
      decodeBase64Value(
        mainPart,
      ) || mainPart
  }

  const atIndex =
    mainPart.lastIndexOf('@')

  if (atIndex < 0) {
    throw new Error(
      'ساختار Shadowsocks معتبر نیست.',
    )
  }

  let userInfo =
    mainPart.slice(0, atIndex)

  const address =
    mainPart.slice(atIndex + 1)

  if (!userInfo.includes(':')) {
    userInfo =
      decodeBase64Value(
        userInfo,
      ) || userInfo
  }

  const separator =
    userInfo.indexOf(':')

  if (separator < 0) {
    throw new Error(
      'روش رمزنگاری یا رمز Shadowsocks ناقص است.',
    )
  }

  const {
    host,
    port,
  } = parseHostAndPort(address)

  const params =
    new URLSearchParams(query)

  const pluginValue =
    params.get('plugin')

  let plugin = null
  let pluginOpts = null

  if (pluginValue) {
    const [
      pluginName,
      ...pluginOptions
    ] = pluginValue.split(';')

    plugin = pluginName
    pluginOpts =
      pluginOptions.join(';') ||
      null
  }

  return {
    name:
      decodeText(rawName),
    host,
    port,
    method:
      decodeURIComponent(
        userInfo.slice(
          0,
          separator,
        ),
      ),
    password:
      decodeURIComponent(
        userInfo.slice(
          separator + 1,
        ),
      ),
    plugin,
    pluginOpts,
  }
}

function parseHostAndPort(value) {
  const trimmed = value.trim()

  if (trimmed.startsWith('[')) {
    const closingBracket =
      trimmed.indexOf(']')

    if (closingBracket < 0) {
      return {
        host: null,
        port: null,
      }
    }

    return {
      host: normalizeHost(
        trimmed.slice(
          1,
          closingBracket,
        ),
      ),
      port: normalizePort(
        trimmed
          .slice(
            closingBracket + 1,
          )
          .replace(/^:/, ''),
      ),
    }
  }

  const separator =
    trimmed.lastIndexOf(':')

  if (separator < 0) {
    return {
      host: normalizeHost(
        trimmed,
      ),
      port: null,
    }
  }

  return {
    host: normalizeHost(
      trimmed.slice(
        0,
        separator,
      ),
    ),
    port: normalizePort(
      trimmed.slice(
        separator + 1,
      ),
    ),
  }
}

function requireHost(parsedUrl) {
  const host = normalizeHost(
    parsedUrl.hostname,
  )

  if (!host) {
    throw new Error(
      'آدرس سرور خالی است.',
    )
  }

  return host
}

function requirePort(parsedUrl) {
  const port = normalizePort(
    parsedUrl.port,
  )

  if (!port) {
    throw new Error(
      'پورت سرور معتبر نیست.',
    )
  }

  return port
}

function normalizeHost(value) {
  if (
    typeof value !== 'string'
  ) {
    return null
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^\[/, '')
    .replace(/\]$/, '')

  return normalized || null
}

function normalizePort(value) {
  const number = Number(value)

  if (
    !Number.isInteger(number) ||
    number < 1 ||
    number > 65535
  ) {
    return null
  }

  return number
}

function normalizeNodeName(value) {
  if (
    typeof value !== 'string'
  ) {
    return null
  }

  const normalized = value
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 120)

  return normalized || null
}

function normalizeText(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return null
  }

  const normalized =
    String(value).trim()

  return normalized || null
}

function normalizePositiveNumber(value) {
  const number = Number(value)

  if (
    !Number.isFinite(number) ||
    number <= 0
  ) {
    return null
  }

  return number
}

function extractFragmentName(hash) {
  if (!hash) {
    return null
  }

  return decodeText(
    hash.replace(/^#/, ''),
  )
}

function decodeText(value) {
  if (!value) {
    return null
  }

  try {
    return normalizeNodeName(
      decodeURIComponent(value),
    )
  } catch {
    return normalizeNodeName(
      value,
    )
  }
}

function createDefaultName(
  protocolName,
  host,
) {
  if (host) {
    return `${protocolName} – ${host}`
  }

  return protocolName
}

function formatProtocolName(protocol) {
  const names = {
    vmess: 'VMess',
    vless: 'VLESS',
    trojan: 'Trojan',
    ss: 'Shadowsocks',
    hysteria2: 'Hysteria 2',
    hy2: 'Hysteria 2',
    tuic: 'TUIC',
    anytls: 'AnyTLS',
  }

  return names[protocol] ??
    protocol
}

function decodeBase64Value(value) {
  try {
    const normalized = String(value)
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .replace(/\s+/g, '')

    if (!normalized) {
      return null
    }

    const padding =
      (4 -
        (normalized.length % 4)) %
      4

    return Buffer.from(
      normalized +
        '='.repeat(padding),
      'base64',
    ).toString('utf8')
  } catch {
    return null
  }
}

function parseBoolean(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return false
  }

  return [
    '1',
    'true',
    'yes',
  ].includes(
    String(value)
      .toLowerCase(),
  )
}

function splitList(value) {
  if (!value) {
    return []
  }

  return String(value)
    .split(/[,|]/)
    .map((item) =>
      item.trim(),
    )
    .filter(Boolean)
}

module.exports = {
  createAndCheckConfig,
  createAndCheckTunConfig,
  createAndCheckWarpConfig,
}
