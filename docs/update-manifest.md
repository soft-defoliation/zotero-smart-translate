# Smart Translate for Zotero — Update Manifest Template

```json
{
  "addons": {
    "smart-translate-for-zotero@fengqiu": {
      "version": "0.1.0",
      "xpiDownloadLink": "https://github.com/fengqiu/zotero-smart-translate/releases/download/v0.1.0/smart-translate-for-zotero-0.1.0.xpi",
      "updateLink": "https://raw.githubusercontent.com/fengqiu/zotero-smart-translate/main/update.json",
      "applied": "2026-09-08T00:00:00.000Z"
    }
  }
}
```

## 使用步骤

1. 修改 `version` 为发布版本号
2. 修改 `xpiDownloadLink` 为对应 release 资产链接
3. 提交到 `main` 分支的 `update.json`
4. 在插件设置中开启"自动更新"

## 注意事项

- 自托管更新仅对私有发布有效，公开分发需遵守 AGPL-3.0
- 确保 GitHub release 资产可公开访问
