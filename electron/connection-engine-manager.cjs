const singBox = require('./sing-box-process-manager.cjs')
const xray = require('./xray-process-manager.cjs')

// Matches the renderer's default for a fresh install.
let selectedEngine = 'xray'
let activeEngine = null

function normalizeEngine(value) {
  return value === 'xray' ? 'xray' : 'sing-box'
}

function setSelectedEngine(value) {
  selectedEngine = normalizeEngine(value)
  return selectedEngine
}

function getSelectedEngine() {
  return selectedEngine
}

function setProcessExitCallback(callback) {
  singBox.setProcessExitCallback(callback)
  xray.setXrayProcessExitCallback(callback)
}

async function stopEveryEngine(userDataPath) {
  const results = await Promise.allSettled([
    singBox.stopLocalProxy({ userDataPath }),
    xray.stopXray({ userDataPath }),
  ])
  return results
}

async function startSelected({ singBoxPath, xrayPath, userDataPath }) {
  if (selectedEngine === 'xray') {
    await singBox.stopLocalProxy({ userDataPath }).catch(() => {})
    const result = await xray.startXray({ enginePath: xrayPath, userDataPath })
    if (result.success) activeEngine = 'xray'
    return result
  }
  await xray.stopXray({ userDataPath }).catch(() => {})
  const result = await singBox.startLocalProxy({ enginePath: singBoxPath, userDataPath })
  if (result.success) activeEngine = 'sing-box'
  return result
}

async function startTunSelected({ singBoxPath, userDataPath }) {
  if (selectedEngine === 'xray') {
    return {
      success: false,
      ...xray.getXrayStatus(),
      error: 'حالت TUN در این نسخه با Xray فعال نیست. برای TUN موتور را به sing-box تغییر بده.',
    }
  }
  await xray.stopXray({ userDataPath }).catch(() => {})
  const result = await singBox.startTunMode({ enginePath: singBoxPath, userDataPath })
  if (result.success) activeEngine = 'sing-box'
  return result
}

async function activateSelectedSystemProxy({ singBoxPath, xrayPath, userDataPath }) {
  if (selectedEngine === 'xray') {
    await singBox.stopLocalProxy({ userDataPath }).catch(() => {})
    const result = await xray.activateXraySystemProxy({ enginePath: xrayPath, userDataPath })
    if (result.success) activeEngine = 'xray'
    return result
  }
  await xray.stopXray({ userDataPath }).catch(() => {})
  const result = await singBox.activateSystemProxy({ enginePath: singBoxPath, userDataPath })
  if (result.success) activeEngine = 'sing-box'
  return result
}

async function deactivateSelectedSystemProxy({ singBoxPath, userDataPath, keepLocalProxy }) {
  if (selectedEngine === 'xray') {
    return xray.deactivateXraySystemProxy({ userDataPath, keepLocalProxy })
  }
  return singBox.deactivateSystemProxy({ enginePath: singBoxPath, userDataPath, keepLocalProxy })
}

async function stopSelected({ userDataPath }) {
  const engine = activeEngine || selectedEngine
  const result = engine === 'xray'
    ? await xray.stopXray({ userDataPath })
    : await singBox.stopLocalProxy({ userDataPath })
  activeEngine = null
  // Also clean an orphan from the other core. This makes Disconnect a hard
  // lifecycle boundary and guarantees its Windows proxy restore path runs.
  if (engine === 'xray') await singBox.stopLocalProxy({ userDataPath }).catch(() => {})
  else await xray.stopXray({ userDataPath }).catch(() => {})
  return result
}

function getSelectedStatus() {
  const status = selectedEngine === 'xray' ? xray.getXrayStatus() : singBox.getProcessStatus()
  return { ...status, engineType: selectedEngine }
}

async function disposeAll({ userDataPath }) {
  await Promise.allSettled([
    singBox.disposeProcessManager({ userDataPath }),
    xray.disposeXray({ userDataPath }),
  ])
}

module.exports = {
  setSelectedEngine, getSelectedEngine, startSelected, startTunSelected,
  activateSelectedSystemProxy, deactivateSelectedSystemProxy, stopSelected,
  stopEveryEngine, getSelectedStatus, disposeAll,
  setProcessExitCallback,
}
