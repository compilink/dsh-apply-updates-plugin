window.__ModuleLoader__.load({
  id: 'dsh-bundle-apply-updates',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const endpoint = () => new URL('local/apply-plugin-updates', document.baseURI)
    async function read(method = 'GET', boot, signal) {
      const response = await fetch(endpoint(), {
        method, credentials: 'same-origin', cache: 'no-store', signal,
        headers: boot ? { 'X-DSH-Apply-Generation': boot } : {},
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '无法读取服务状态')
      return result
    }
    function Panel() {
      const [state, setState] = React.useState({ boot: null, blocker: '正在检查服务状态' })
      const [message, setMessage] = React.useState('')
      const [waiting, setWaiting] = React.useState(false)
      const alive = React.useRef(false)
      const submitted = React.useRef(false)
      React.useEffect(() => {
        alive.current = true
        const abort = new AbortController()
        async function check() {
          if (submitted.current) return
          try {
            const next = await read('GET', null, abort.signal)
            if (alive.current && !submitted.current) setState(next)
          } catch (err) {
            if (alive.current && !submitted.current) setState({ boot: null, blocker: err.message })
          }
        }
        void check()
        const timer = setInterval(check, 5000)
        return () => { alive.current = false; abort.abort(); clearInterval(timer) }
      }, [])
      async function restart() {
        if (submitted.current || !state.boot || state.blocker) return
        submitted.current = true
        setWaiting(true)
        setMessage('正在重新启动 DSH，页面将在服务就绪后刷新。')
        try {
          await read('POST', state.boot, AbortSignal.timeout(10000))
        } catch (err) {
          // A response can be lost when the server exits. Only network failures need a boot check.
          if (!(err instanceof TypeError) && err.name !== 'TimeoutError') {
            if (alive.current) { setMessage(err.message); setWaiting(false) }
            submitted.current = false
            return
          }
        }
        const deadline = Date.now() + 120000
        let newBoot
        while (alive.current && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 1500))
          if (!alive.current) return
          try {
            const next = await read('GET', null, AbortSignal.timeout(3000))
            if (next.boot !== state.boot && next.boot) {
              if (newBoot === next.boot) { window.location.reload(); return }
              newBoot = next.boot
            }
          } catch { newBoot = undefined }
        }
        if (alive.current) {
          setMessage('两分钟内未确认服务重新启动。请检查 DSH 服务状态后刷新页面。')
          setWaiting(false)
          submitted.current = false
        }
      }
      return h('section', { style: { maxWidth: '42rem', padding: '1rem', display: 'grid', gap: '0.8rem' } },
        h('h2', null, '应用插件更新'),
        h('p', null, '安装或更新插件后，重新启动 DSH 以加载已安装的版本。'),
        h('button', { type: 'button', disabled: waiting || !state.boot || !!state.blocker, onClick: restart, style: { justifySelf: 'start' } }, '重启服务并应用更新'),
        h('p', { role: 'status' }, message || state.blocker || '服务空闲，可以重启。'))
    }
    return {
      name: 'dsh-bundle-apply-updates', inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'apply-plugin-updates', order: 49, label: () => '应用插件更新',
          inject: () => ({}),
        }, Panel)))
      },
    }
  },
})
