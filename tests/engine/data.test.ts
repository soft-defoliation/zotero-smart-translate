/**
 * data 层停用终闸测试:
 * alive=false(插件已停用/重载中)时 translateText/completeText 必须
 * 在任何引擎解析/密钥读取/网络请求之前抛"插件已停用"(P1-5 最终闸),
 * 杜绝停用后残余入口继续产生 API 计费。
 */

import { describe, it, expect } from "vitest";
import { data, translateText, completeText } from "../../src/data";
import { APIError } from "../../src/engine/retry";

describe("data.alive 停用终闸", () => {
  it("alive=false 时 translateText 抛'插件已停用'且状态码 500", async () => {
    data.alive = false;
    try {
      await expect(translateText("hello")).rejects.toMatchObject({
        message: "插件已停用",
        statusCode: 500,
      });
    } finally {
      // 恢复模块单例状态, 避免污染同文件后续用例
      data.alive = true;
    }
  });

  it("alive=false 时 completeText 同样被拦", async () => {
    data.alive = false;
    try {
      await expect(completeText("summarize this")).rejects.toBeInstanceOf(
        APIError,
      );
      await expect(completeText("summarize this")).rejects.toMatchObject({
        message: "插件已停用",
      });
    } finally {
      data.alive = true;
    }
  });

  it("alive=true 时行为不变(无引擎时抛既有配置错误而非停用错误)", async () => {
    // node 测试环境无引擎配置: 拦截的是"未配置可用引擎"而非"插件已停用",
    // 证明终闸没有误伤正常启动路径
    await expect(translateText("hello")).rejects.not.toMatchObject({
      message: "插件已停用",
    });
  });
});
