# DSH 应用插件更新

在 DeepSeek Harness 的 **设置 → 应用插件更新** 中重启 DSH，让已经安装或更新的插件生效。服务退出时使用 DSH 自带的清理流程，原服务管理器重新启动同一部署。浏览器识别到新进程就绪后会自动刷新。

## 安装与启用

使用本插件需要通过本机回环地址直接登录 DSH Web，并且已有能在 DSH 正常退出后将其重新启动的服务管理器。Docker 可使用 `restart: unless-stopped` 或 `always`。先确认自动重启有效，再启用下方配置。

1. 在运行 DSH 的环境中将插件安装到 Web profile。支持 URL 安装的插件管理器也可以使用同一个安装包地址。

   ```sh
   dsh plugin --profile web add --ignore-scripts https://github.com/compilink/dsh-apply-updates-plugin/releases/download/v0.1.2/dsh-bundle-apply-updates.tgz
   ```

2. 在 Web profile 的 `cordis.patch.yml` 中添加以下配置，保留已有配置项。

   ```yaml
   - id: apply-plugin-updates
     config:
       supervised: true
   ```

3. 等 DSH 空闲后，通过现有服务管理器重启一次。用本机浏览器登录，打开 **设置 → 应用插件更新**。页面显示「服务空闲，可以重启。」表示按钮可用。

发布页提供固定版本的安装包和 SHA-256 校验文件。[v0.1.2 Release](https://github.com/compilink/dsh-apply-updates-plugin/releases/tag/v0.1.2)

## 让插件更新生效

1. 先通过插件管理器或 DSH CLI 安装或更新目标插件，等待安装完成。
2. 打开 **设置 → 应用插件更新**，点击 **重启服务并应用更新**。插件会再检查一次活跃会话、排队输入、插件安装锁和通道忙碌状态。页面会显示阻止重启的原因。
3. 等待页面自动刷新。如果两分钟内没有确认新进程就绪，请用原来的服务管理器检查 DSH 是否成功启动，再刷新浏览器。

此操作沿用当前 Web profile、插件配置和数据目录。要切换 DSH 主程序的 Docker 镜像，可使用配有宿主升级服务的 [DSH Docker 升级插件](https://github.com/compilink/dsh-docker-upgrade-plugin)。

## 运行条件与通道接入

- Web profile 需要提供 `webServer`、`connection`、`agents` 和 `profileContext`，DSH 进程需有 `SIGTERM` 退出处理器。`supervised` 默认为关闭。停用管理器的自动重启前，请先将其改为 `false` 并加载配置。
- 重启请求只接受已登录的本机浏览器同源操作，并绑定当前服务的启动标识。通过局域网地址或反向代理访问、登录过期、后台任务忙碌、未配置自动重启都可能使按钮置灰。面板会显示当前原因和首次配置步骤。
- 通道插件可监听同步事件 `apply-updates/check-idle`。监听器收到 `{ block(reason) }`，在队列或收发任务仍活跃时调用 `block`。QQ 通道通过此事件报告各实例的忙碌状态。
- 插件只向自己的 DSH 进程发送退出信号。容器可以继续使用现有权限，无需挂载 Docker socket。

## 开发验证

```sh
npm test
```

Web 设置按 DSH 已验证的浏览器身份控制重启。官方桌面客户端不注册重启按钮或重启接口。
