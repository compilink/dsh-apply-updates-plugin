import { createHash, randomUUID } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'apply-plugin-updates'
export const inject = ['webServer', 'connection', 'agents', 'profileContext']
const path = '/local/apply-plugin-updates'
const boot = randomUUID()

function send(res, status, info) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(info))
}

function requestHeader(req, name) {
  return typeof req.headers.get === 'function' ? req.headers.get(name) ?? undefined : req.headers[name]
}

function requestBlocker(req, protocol) {
  const host = requestHeader(req, 'host')
  if (typeof host !== 'string' || !/^(127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i.test(host) ||
      !URL.canParse(protocol + '//' + host)) {
    return 'DSH 收到的 Host 不是有效的本机回环地址。请从运行容器的电脑直接打开映射到本机的端口。'
  }
  const keys = typeof req.headers.keys === 'function' ? [...req.headers.keys()] : Object.keys(req.headers)
  if (keys.some(key => key.toLowerCase() === 'forwarded' || key.toLowerCase().startsWith('x-forwarded-'))) {
    return '请求带有代理转发头。请通过 Docker 直接映射到本机的端口访问 DSH，绕开反向代理。'
  }
  const origin = requestHeader(req, 'origin')
  if (req.method === 'GET' && origin === undefined) return
  if (origin !== new URL(protocol + '//' + host).origin) {
    return '浏览器来源与 DSH 收到的协议、主机或端口不一致。请在同一个本机直连地址登录并打开设置。'
  }
}

function idleBlocker(ctx) {
  if (ctx.agents.list().some(agent => agent.status !== 'idle' || agent.inbox.nextTurn.length || agent.inbox.nextStep.length)) {
    return 'DSH 有运行中或排队的会话'
  }
  const profile = ctx.profileContext.dir
  for (const file of ['package.json.lock', '.plugin-manager/run.json']) {
    if (lstatSync(join(profile, file), { throwIfNoEntry: false })) return '插件安装或更新尚未结束'
  }
  let blocked
  ctx.emit('apply-updates/check-idle', { block(reason) { blocked ??= String(reason).slice(0, 180) } })
  return blocked
}

function isBrowserOwner(ctx, peer, req) {
  if (!peer) return false
  const browser = ctx.get?.('dshLocalBrowserOwner')
  if (browser) return browser.matches(peer)
  if (peer === ctx.connection.browserPeer) return true
  const auth = ctx.get?.('connection.authentication')
  if (!auth || peer.principal?.kind !== 'owner') return false

  // The stock token provider verifies the signature, audience and signed version.
  // Re-admit the single browser credential in isolation so another provider or
  // a signed API cookie on the original request cannot authorize this operation.
  const host = requestHeader(req, 'host')
  const authority = new URL(ctx.webServer.protocol + '//' + host)
  const audience = authority.protocol === 'https:' ? authority.origin : authority.host
  const cookieName = 'dsh-auth-' + createHash('sha256').update(audience).digest('base64url')
  const cookies = String(requestHeader(req, 'cookie') ?? '').split(';').map(item => item.trim())
    .filter(item => item.startsWith(cookieName + '='))
  if (cookies.length !== 1 || !cookies[0].startsWith(cookieName + '=v1.')) return false
  return auth.authenticate({ headers: { host, cookie: cookies[0] }, signal: req.signal, socket: req.socket }).peer === peer
}

/** Mount a local owner-only action. DSH's SIGTERM handler disposes its plugin tree before the supervisor restarts the web process. */
export function apply(ctx, config = {}) {
  if (ctx.profileContext.name === 'desktop') return
  if (ctx.get?.('connection.authentication') !== undefined) {
    ctx.inject(['connection.authentication'], scoped => mount(scoped, config))
    return
  }
  return mount(ctx, config)
}

function mount(ctx, config) {
  if (config.supervised !== undefined && typeof config.supervised !== 'boolean') throw new TypeError('supervised must be true or false')
  let stopping = false
  const handler = (req, res) => {
    const denied = requestBlocker(req, ctx.webServer.protocol)
    if (denied) return send(res, 403, { error: denied })
    const admission = ctx.connection.admit(req)
    if (admission.rejection || !isBrowserOwner(ctx, admission.peer, req)) return send(res, admission.rejection || 403, { error: '请用本机 DSH 登录入口重新打开 Web 设置。只有已登录的本机浏览器可以重启。' })
    if (req.url?.split('?')[0] !== path || req.url.includes('?')) return send(res, 404, { error: '路径无效' })
    if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { error: '请求方法无效' })
    if (req.method === 'POST' && (requestHeader(req, 'x-dsh-apply-generation') !== boot || requestHeader(req, 'transfer-encoding') || Number(requestHeader(req, 'content-length') || 0) !== 0)) {
      return send(res, 409, { error: '页面状态已过期，请重新打开设置' })
    }
    if (stopping) return send(res, 409, { error: '服务正在重启' })
    let blocker
    try {
      blocker = !config.supervised ? '首次安装默认关闭重启。确认 Docker 使用 unless-stopped 或 always，再在 Web profile 启用 supervised。' :
        !process.listenerCount('SIGTERM') ? '当前 DSH 未注册安全退出处理器' :
        idleBlocker(ctx)
    } catch {
      blocker = '暂时无法核实任务状态，请稍后重试'
    }
    if (req.method === 'GET') return send(res, 200, { boot, blocker: blocker ?? null })
    if (blocker) return send(res, 409, { error: blocker })
    stopping = true
    send(res, 202, { boot, restarting: true })
    // Request graceful shutdown in this turn so another request cannot occupy a delayed restart timer.
    process.kill(process.pid, 'SIGTERM')
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler }))
}
