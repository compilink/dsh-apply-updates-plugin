import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'

function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'apply-updates-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  let installed
  const owner = {}
  const ctx = {
    get: name => name === 'dshLocalBrowserOwner' ? options.browser : name === 'connection.authentication' ? options.auth : undefined,
    inject: (names,mount) => {assert.deepEqual(names,['connection.authentication']); return mount(ctx)},
    webServer: { protocol: 'http:', register(route) { installed = route; return () => {} } },
    connection: { browserPeer: owner, admit: () => options.admission || { peer: owner } },
    agents: { list: () => options.agents || [] }, profileContext: { dir },
    emit(event, check) { assert.equal(event, 'apply-updates/check-idle'); options.check?.(check) },
    effect: fn => fn(),
  }
  apply(ctx, options.config || { supervised: true })
  const hold = () => {}
  process.on('SIGTERM', hold)
  t.after(() => process.off('SIGTERM', hold))
  function request(method, headers = {}, extra = {}) {
    const result = {}
    installed.handler({ url: installed.path, method, headers: { host: 'localhost:3080', ...headers }, ...extra }, {
      writeHead(status, responseHeaders) { result.status = status; result.headers = responseHeaders },
      end(text) { result.data = JSON.parse(text) },
    })
    return result
  }
  return { request, dir }
}
test('reports idle only from an authenticated browser and a supervised host', t => {
  assert.equal(fixture(t).request('GET').data.blocker,null)
  assert.match(fixture(t,{config:{}}).request('GET').data.blocker,/supervised/)
  assert.equal(fixture(t,{admission:{peer:{}}}).request('GET').status,403)
  assert.equal(fixture(t,{admission:{rejection:401}}).request('GET').status,401)
})
test('rejects cross-origin posts, forwarded authorities, payloads and stale clicks', t => {
  const {request} = fixture(t)
  const boot = request('GET').data.boot
  const valid = {origin:'http://localhost:3080','x-dsh-apply-generation':boot}
  assert.equal(request('POST').status,403)
  assert.equal(request('POST',{...valid,origin:'https://else.invalid'}).status,403)
  assert.equal(request('POST',{...valid,'x-forwarded-for':'127.0.0.1'}).status,403)
  assert.equal(request('GET',{host:'example.invalid'}).status,403)
  assert.equal(request('POST',{...valid,'content-length':'1'}).status,409)
  assert.equal(request('POST',{...valid,'x-dsh-apply-generation':'old'}).status,409)
})
test('refuses running sessions, queued prompts, busy channels and unknown channel state', t => {
  for (const options of [
    {agents:[{status:'running'}]},
    {agents:[{status:'idle',inbox:{nextTurn:['queued'],nextStep:[]}}]},
    {agents:[{status:'idle',inbox:{nextTurn:[],nextStep:['steering']}}]},
    {check:check=>check.block('QQ queue active')},
    {check:()=>{throw new Error('unreadable')}},
  ]) {
    const {request}=fixture(t,options)
    const state=request('GET').data
    assert.ok(state.blocker)
    assert.equal(request('POST',{origin:'http://localhost:3080','x-dsh-apply-generation':state.boot}).status,409)
  }
})
test('refuses while the active profile is locked', t => {
  const {request,dir}=fixture(t)
  writeFileSync(join(dir,'package.json.lock'),'test')
  assert.match(request('GET').data.blocker,/安装/)
})

test('accepts only the browser identity when the token provider distinguishes owner peers', t => {
  const actual = { principal: {kind: 'owner'} }
  const api = { principal: {kind: 'owner'} }
  const browser = {matches: peer => peer === actual}
  assert.equal(fixture(t,{browser,auth:{},admission:{peer:actual}}).request('GET').status,200)
  assert.equal(fixture(t,{browser,admission:{peer:api}}).request('GET').status,403)
  assert.equal(fixture(t,{browser}).request('GET').status,403)
  assert.equal(fixture(t,{browser,admission:{rejection:401}}).request('GET').status,401)
})

test('stock DSH rechecks the single current-authority browser cookie against the admitted peer', t => {
  const host = 'localhost:3080'
  const cookie = 'dsh-auth-' + createHash('sha256').update(host).digest('base64url')
  const peer = { principal: { kind: 'owner' } }
  const sample = cookie + '=v1.sample.signature'
  const auth = { authenticate({ headers }) {
    assert.deepEqual(Object.keys(headers).sort(), ['cookie','host'])
    return headers.cookie === sample && headers.host === host ? { peer } : { rejection: 401 }
  } }
  const { request } = fixture(t, { auth, admission: { peer } })
  assert.equal(request('GET', {cookie: sample}).status, 200)
  for (const value of [sample + '; ' + sample, cookie + '=v2.sample.signature', cookie + '=v1.invalid.signature', 'other=' + sample, '']) {
    assert.equal(request('GET', {cookie: value}).status, 403)
  }
  assert.equal(request('GET', {host:'localhost:99999', cookie: sample}).status,403)
})
test('desktop profile does not install the Web restart route', () => {
  assert.equal(apply({ profileContext: { name: 'desktop' } }), undefined)
})

test('reports which source check failed and accepts canonical default-port origins', t => {
  const {request}=fixture(t)
  assert.match(request('GET',{host:'dsh.lan'}).data.error,/Host/)
  assert.match(request('GET',{'x-forwarded-proto':'http'}).data.error,/代理转发头/)
  assert.match(request('GET',{origin:'https://localhost:3080'}).data.error,/不一致/)
  assert.equal(request('GET', {host:'127.0.0.1:80',origin:'http://127.0.0.1'}).status,200)
  assert.equal(request('GET', {}, {headers:new Headers({host:'127.0.0.1:80'})}).status,200)
  assert.equal(request('GET', {}, {headers:new Headers({host:'127.0.0.1','Forwarded':'for=localhost'})}).status,403)
})
