# 官网部署说明（md.wangjinding.com）

## 链路

```
访客 ──https://md.wangjinding.com:443──► EdgeOne 边缘（免费 TrustAsia 证书）
                                          │ 回源 HTTPS 8443，Host=加速域名
                                          ▼
                             <回源域名>:8443 ──(光猫映射)──► .8 的 OpenResty
                                                                        │ server_name 分流
                                                                        ▼
                                                              /opt/1panel/www/sites/md.wangjinding.com/index
```

## 各部分落在哪

| 环节 | 位置 / 参数 |
| --- | --- |
| 站点根目录 | `/opt/1panel/www/sites/md.wangjinding.com/index` |
| nginx 配置 | `/opt/1panel/www/conf.d/md.wangjinding.com.conf`（8082 + 8443 ssl）|
| 源站证书 | `/opt/1panel/www/sites/md.wangjinding.com/ssl/`（acme.sh + 阿里云 DNS-01，自动续期）|
| 安装包 | `index/download/XiaoyinMarkdown-win32-x64.zip` |
| EdgeOne | zone `zone-xxxxxxxx`，加速域名 `md.wangjinding.com`，回源 HTTPS/8443 |
| WAF 白名单 | `1pwaf/data/conf/sites.json` + `1pwaf/data/sites/md.wangjinding.com/config.json` |
| DNS | 阿里云 `md` CNAME → `md.wangjinding.com.eo.dnse2.com`（TTL 600）|


## 在 1Panel 面板里可见（重要）

只建 `conf.d/*.conf` + 站点目录，**面板列表里是看不到的** —— 面板的「网站」页读的是
`/opt/1panel/db/agent.db` 的 `websites` 表。要让站点出现在面板里、能用面板的「配置」页管理，
必须往库里登记（本次已登记：`websites.id=11`、`website_domains`、`website_ssls.id=15`）：

```sql
-- websites：type='static'，proxy 留空，site_dir='/'
insert into websites (..., protocol, primary_domain, type, alias, status, http_config, proxy, site_dir, ...)
values (..., 'HTTPS', 'md.wangjinding.com', 'static', 'md.wangjinding.com', 'Running',
        'HTTPToHTTPS', '', '/', ...);
-- website_domains：(website_id, domain, ssl=0, port=8082)
-- website_ssls：(primary_domain, private_key, pem, key_type='EC256', type='YE2',
--                expire_date, start_date, status='ready', auto_renew=1)
-- 再把 websites.website_ssl_id 指过去
```

注意：
- `website_ssls` 的布尔列必须是 0/1（写 `''` 会让面板整页 `sql: Scan error`）。
- 证书内容直接从 `sites/<域名>/ssl/{fullchain,privkey}.pem` 读进去，面板的「证书」页才显示得出来。
- 面板刷新后即可见（Ctrl+F5）；若没出现，`systemctl restart 1panel-agent` 一次。
- ⚠️ **在面板里改这个站点的配置时，nginx conf 会被面板模板重写** ——
  我加的 `Strict-Transport-Security` 头、`/download/` 的 `Content-Disposition: attachment`
  可能会丢，改完记得复查 `conf.d/md.wangjinding.com.conf`。

## 更新页面

```bash
cp site/index.html /opt/1panel/www/sites/md.wangjinding.com/index/
docker exec 1Panel-openresty-npAh nginx -s reload   # 一般不需要，静态文件直接生效
```

## 更新安装包

官网主下载项是 **Tauri 安装包**（1.6 MB，装完 .md 默认用它打开）：

```bash
# 1) 交叉编译 Windows 安装包（详见仓库 README「用 Tauri 打包」）
npx tauri build --target x86_64-pc-windows-gnu --bundles nsis

# 2) 发布
R=src-tauri/target/x86_64-pc-windows-gnu/release
cp $R/bundle/nsis/XiaoyinMarkdown_2.6.1_x64-setup.exe \
   /opt/1panel/www/sites/md.wangjinding.com/index/download/
cp $R/xiaoyin-markdown.exe \
   /opt/1panel/www/sites/md.wangjinding.com/index/download/XiaoyinMarkdown-portable.exe
```

旧版 Electron 构建（`XiaoyinMarkdown-win32-x64.zip`，152 MB）仍保留在 `download/` 里。

## 坑

- **WAF 白名单**：不往 `sites.json` 加 `{"key": "<域名>", "host": ["<域名>:8082"]}`，
  就会**本机 200、公网 403「网站不存在」**（本次踩过）。
- **EdgeOne 过渡期**：新加速域名 `process` 状态下访问会被边缘直接 Reset（curl 显示 000），
  证书 `applying → processing → deployed`，全程约 10–15 分钟，别当成配错了。
- **缓存**：站点级策略是 NoCache，152MB 的安装包每次都回源（走家宽上行）。
  要提速得在 EdgeOne 给 `/download/*` 单独加缓存规则。
- **带宽账**：EO 免费额度 50GB/月，单次下载 152MB → 每月约 330 次。
