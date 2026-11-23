import { randomUUID } from 'node:crypto'
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

function loopbackRequest(req, protocol) {
  const host = req.headers.host ?? ''
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i.test(host)) return false
  if (Object.keys(req.headers).some(key => key === 'forwarded' || key.startsWith('x-forwarded-'))) return false
  const origin = req.headers.origin
  if (req.method === 'GET' && origin === undefined) return true
  return origin === protocol + '//' + host
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

/** Mount a local owner-only action. DSH's SIGTERM handler disposes its plugin tree before the supervisor restarts the web process. */
export function apply(ctx, config = {}) {
  if (config.supervised !== undefined && typeof config.supervised !== 'boolean') throw new TypeError('supervised must be true or false')
  let stopping = false
  const handler = (req, res) => {
    if (!loopbackRequest(req, ctx.webServer.protocol)) return send(res, 403, { error: '仅允许本机同源请求' })
    const admission = ctx.connection.admit(req)
    if (admission.rejection || admission.peer !== ctx.connection.browserPeer) return send(res, admission.rejection || 403, { error: '请用本机 DSH 浏览器账号登录' })
    if (req.url?.split('?')[0] !== path || req.url.includes('?')) return send(res, 404, { error: '路径无效' })
    if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { error: '请求方法无效' })
    if (req.method === 'POST' && (req.headers['x-dsh-apply-generation'] !== boot || req.headers['transfer-encoding'] || Number(req.headers['content-length'] || 0) !== 0)) {
      return send(res, 409, { error: '页面状态已过期，请重新打开设置' })
    }
    if (stopping) return send(res, 409, { error: '服务正在重启' })
    let blocker
    try {
      blocker = !config.supervised ? '请先为当前 DSH 配置自动重启，并启用 supervised' :
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
