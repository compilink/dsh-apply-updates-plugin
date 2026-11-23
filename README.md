# DSH 应用插件更新

在 DSH 设置的「应用插件更新」页面点击「重启服务并应用更新」，由受托管的 DSH 主机重新载入磁盘上的插件。浏览器使用当前 DSH 登录状态，观察到新进程就绪后会自动刷新。

## 安装

要求 DSH Web 提供 Connection 的浏览器认证、WebServer、Agents 和 ProfileContext 服务。适用于使用本机回环地址直接访问，并由服务管理器在正常退出后自动重新启动的部署，例如 Docker 的 `restart: unless-stopped` 或 `always`。须先配置并验证服务管理器，再启用按钮。

```sh
dsh plugin --profile web add --ignore-scripts https://raw.githubusercontent.com/compilink/dsh-apply-updates-plugin/v0.1.0/releases/dsh-bundle-apply-updates-0.1.0.tgz
```

在 Web profile 的 `cordis.patch.yml` 中添加以下配置，首次安装后通过现有服务管理器重启 DSH。

```yaml
- id: apply-plugin-updates
  config:
    supervised: true
```

点击按钮时插件复核 DSH 任务、排队输入、profile 包管理锁和其他通道的忙碌状态。正在安装包或处理任务时，设置页显示阻止原因。仅当前已登录的本机浏览器能提交同源操作，请求绑定当前服务启动标识。服务收到 SIGTERM 后执行 DSH 自带的退出清理，服务管理器负责重新启动同一部署。如果自动重启失败或新版插件无法启动，需用原来的服务管理器恢复。停止自动重启前，请先将 `supervised` 设置为 `false`。

通道插件可通过同步事件 `apply-updates/check-idle` 提供活动状态。监听器收到 `{ block(reason) }`，在队列、收发或启动活动仍在进行时调用 `block`。QQ 通道使用这个接口检查其各个实例。此插件不需要 Docker socket 或外部命令权限。

## 验证

```sh
npm test
```
