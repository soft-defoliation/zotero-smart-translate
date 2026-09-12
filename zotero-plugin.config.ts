import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  // {{owner}}/{{repo}} 由 package.json 的 repository.url 解析而来, 换账号只改一处;
  // update.json 由 release 流程上传到 "release" tag 的预发布资产, Zotero 从这里拉更新清单
  updateURL:
    "https://github.com/{{owner}}/{{repo}}/releases/download/release/{{updateJson}}",
  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
      {
        // 第二入口: 侧栏自定义元素(panel bundle), 输出 content/scripts/panel.js,
        // 由 addon/bootstrap.js 的 onMainWindowLoad loadSubScript 进主窗口;
        // 与主 bundle 是两个独立模块态, 共享状态走 Zotero.SmartTranslate 桥
        entryPoints: ["src/ui/panel/custom-elements.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/content/scripts/panel.js`,
      },
    ],
  },

  test: {
    waitForPlugin: `() => Zotero.${pkg.config.addonInstance}.data.initialized`,
  },

  release: {
    github: {
      // 默认值 "ci" 只在 CI 环境发版; 本地 npm run release 也必须走 GitHub 上传, 故设为 "local"
      enable: "local",
    },
    bumpp: {
      // 提升版本号后、git 提交前重新构建, 保证 xpi 内版本号与 tag 一致
      execute: "npm run build",
    },
  },
});
